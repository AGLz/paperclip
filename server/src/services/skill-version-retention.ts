import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { agents, companies, companySkills, companySkillVersions, heartbeatRuns, type Db } from "@paperclipai/db";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { logger } from "../middleware/logger.js";

/**
 * Retention for materialized skill version directories.
 *
 * `materializeVersionSnapshot` writes each selected skill version to
 * `<instance>/skills/<companyId>/__versions__/<skillId>/<versionId>/` from the
 * version row's stored file inventory. A directory is a cache: when it is
 * removed while its row survives, the next resolve writes it again. Nothing
 * removed these directories before, so they grew with every new version.
 *
 * The prune keeps a directory when it is the skill's current version, an agent
 * pins it, a non-terminal heartbeat run captured it, it is among the newest
 * versions of its skill, or it was materialized or reused within the grace
 * window. It removes every other version directory, directories whose version
 * or skill row is gone, and abandoned staging directories. Version rows are
 * never deleted here.
 */

export const SKILL_VERSION_RETENTION_DEFAULT_KEEP_NEWEST = 3;
export const SKILL_VERSION_RETENTION_DEFAULT_GRACE_MS = 2 * 60 * 60 * 1000;
export const SKILL_VERSION_RETENTION_DEFAULT_MAX_REMOVALS = 500;
export const SKILL_VERSION_RETENTION_INTERVAL_MS = 30 * 60 * 1000;
export const SKILL_VERSION_RETENTION_STARTUP_DELAY_MS = 60 * 1000;

/** A run in one of these states can still read (or re-read) its captured skill versions. */
export const SKILL_VERSION_LIVE_RUN_STATUSES = ["queued", "scheduled_retry", "running", "interrupted"] as const;

const VERSIONS_DIR = "__versions__";
const TRASH_PREFIX = ".trash-";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY_BATCH = 500;

// In-process coordination between materialization and pruning, keyed by the
// absolute version directory. A materialization waits for a pending removal of
// its directory; a prune skips a directory that a materialization is writing.
const versionSnapshotFlights = new Map<string, Promise<string>>();
const versionSnapshotRemovals = new Map<string, Promise<unknown>>();
// Trash directories this process is deleting right now; a concurrent prune skips them.
const activeTrash = new Set<string>();

export function resolveCompanySkillVersionsRoot(companyId: string) {
  return path.resolve(resolvePaperclipInstanceRoot(), "skills", companyId, VERSIONS_DIR);
}

export function resolveSkillVersionSnapshotDir(companyId: string, skillId: string, versionId: string) {
  return path.join(resolveCompanySkillVersionsRoot(companyId), skillId, versionId);
}

/**
 * Runs one materialization per version directory at a time. Concurrent callers
 * share the in-flight promise. A pending prune of the same directory finishes
 * first, so a caller never receives a path that a prune is about to remove.
 */
export async function runVersionSnapshotFlight(skillDir: string, work: () => Promise<string>): Promise<string> {
  for (;;) {
    const removal = versionSnapshotRemovals.get(skillDir);
    if (!removal) break;
    await removal.catch(() => undefined);
  }
  const existing = versionSnapshotFlights.get(skillDir);
  if (existing) return existing;
  const flight = work();
  versionSnapshotFlights.set(skillDir, flight);
  try { return await flight; } finally {
    if (versionSnapshotFlights.get(skillDir) === flight) versionSnapshotFlights.delete(skillDir);
  }
}

/** Marks a reused version directory as recently used, so the grace window protects it. */
export async function touchVersionSnapshot(skillDir: string) {
  const now = new Date();
  await fs.utimes(skillDir, now, now).catch(() => undefined);
}

function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code;
}

async function makeTreeWritable(target: string): Promise<void> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o700).catch(() => undefined);
    const entries = await fs.readdir(target).catch(() => [] as string[]);
    for (const entry of entries) await makeTreeWritable(path.join(target, entry));
  } else {
    await fs.chmod(target, 0o600).catch(() => undefined);
  }
}

/**
 * Removes a snapshot tree. Snapshot files are read-only, and some platforms
 * refuse to unlink read-only entries, so a permission failure makes the tree
 * writable and retries. Symbolic links are removed, never followed.
 */
async function removeSnapshotTree(target: string) {
  if (activeTrash.has(target)) return;
  activeTrash.add(target);
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EACCES" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
    await makeTreeWritable(target);
    await fs.rm(target, { recursive: true, force: true });
  } finally {
    activeTrash.delete(target);
  }
}

/**
 * Moves a directory out of its readable name in one atomic rename, then
 * deletes it. Returns false when a materialization holds the directory or the
 * directory is already gone.
 */
async function removeVersionDirectory(parent: string, name: string): Promise<boolean> {
  const target = path.join(parent, name);
  if (path.dirname(target) !== parent) return false;
  if (versionSnapshotFlights.has(target) || versionSnapshotRemovals.has(target)) return false;
  const trash = path.join(parent, `${TRASH_PREFIX}${randomUUID()}`);
  const rename = fs.rename(target, trash);
  versionSnapshotRemovals.set(target, rename);
  try {
    await rename;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  } finally {
    versionSnapshotRemovals.delete(target);
  }
  await removeSnapshotTree(trash);
  return true;
}

/** Removes every materialized version of one skill. Used after the skill row is deleted. */
export async function removeSkillVersionSnapshots(companyId: string, skillId: string) {
  if (!UUID_PATTERN.test(skillId)) return;
  const root = resolveCompanySkillVersionsRoot(companyId);
  const skillRoot = path.join(root, skillId);
  if (path.dirname(skillRoot) !== root) return;
  const stat = await fs.lstat(skillRoot).catch(() => null);
  if (!stat?.isDirectory()) return;
  const trash = path.join(root, `${TRASH_PREFIX}${randomUUID()}`);
  try {
    await fs.rename(skillRoot, trash);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  await removeSnapshotTree(trash);
}

export type SkillVersionPruneOptions = {
  /** Versions to keep per skill, newest first by revision. */
  keepNewest?: number;
  /** Directories modified (materialized or reused) within this window stay. */
  graceMs?: number;
  /** Upper bound on directories removed by this call. */
  maxRemovals?: number;
  now?: Date;
  /** Checked between removals; returning false stops the prune early. */
  shouldContinue?: () => boolean;
};

export type SkillVersionPruneResult = {
  removed: number;
  removedOrphans: number;
  removedStaging: number;
  kept: number;
  skippedRecent: number;
  failed: number;
  truncated: boolean;
};

type DirEntry = { name: string; mtimeMs: number };

async function listDirectories(root: string): Promise<DirEntry[] | null> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw error;
  }
  const out: DirEntry[] = [];
  for (const name of names) {
    const stat = await fs.lstat(path.join(root, name)).catch(() => null);
    // Never follow a symbolic link out of the versions root.
    if (!stat?.isDirectory()) continue;
    out.push({ name, mtimeMs: stat.mtimeMs });
  }
  return out;
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function collectVersionIds(value: unknown, into: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const versionId of Object.values(value as Record<string, unknown>)) {
    if (typeof versionId === "string" && versionId) into.add(versionId);
  }
}

export function skillVersionRetentionService(db: Db, defaults: SkillVersionPruneOptions = {}) {
  async function protectedVersionIds(companyId: string, skillIds: string[], keepNewest: number) {
    const keep = new Set<string>();
    if (skillIds.length === 0) return keep;
    for (const batch of chunks(skillIds, QUERY_BATCH)) {
      const rows = await db.select({ currentVersionId: companySkills.currentVersionId }).from(companySkills)
        .where(and(eq(companySkills.companyId, companyId), inArray(companySkills.id, batch)));
      for (const row of rows) if (row.currentVersionId) keep.add(row.currentVersionId);
      if (keepNewest > 0) {
        const ranked = db.select({
          id: companySkillVersions.id,
          rank: sql<number>`row_number() over (partition by ${companySkillVersions.companySkillId} order by ${companySkillVersions.revisionNumber} desc)`.as("rank"),
        }).from(companySkillVersions)
          .where(and(eq(companySkillVersions.companyId, companyId), inArray(companySkillVersions.companySkillId, batch)))
          .as("ranked");
        for (const row of await db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rank, keepNewest))) keep.add(row.id);
      }
    }
    for (const agent of await db.select({ adapterConfig: agents.adapterConfig }).from(agents).where(eq(agents.companyId, companyId))) {
      for (const entry of readPaperclipSkillSyncPreference(agent.adapterConfig ?? {}).desiredSkillEntries) {
        if (entry.versionId) keep.add(entry.versionId);
      }
    }
    const liveRuns = await db.select({ skillVersions: sql<unknown>`${heartbeatRuns.contextSnapshot} -> 'skillVersions'` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, [...SKILL_VERSION_LIVE_RUN_STATUSES])));
    for (const run of liveRuns) collectVersionIds(run.skillVersions, keep);
    return keep;
  }

  async function pruneCompany(companyId: string, options: SkillVersionPruneOptions = {}): Promise<SkillVersionPruneResult> {
    const keepNewest = Math.max(0, Math.floor(options.keepNewest ?? defaults.keepNewest ?? SKILL_VERSION_RETENTION_DEFAULT_KEEP_NEWEST));
    const graceMs = Math.max(0, options.graceMs ?? defaults.graceMs ?? SKILL_VERSION_RETENTION_DEFAULT_GRACE_MS);
    const maxRemovals = Math.max(0, options.maxRemovals ?? defaults.maxRemovals ?? Number.POSITIVE_INFINITY);
    const shouldContinue = options.shouldContinue ?? defaults.shouldContinue ?? (() => true);
    const cutoffMs = (options.now ?? new Date()).getTime() - graceMs;
    const result: SkillVersionPruneResult = {
      removed: 0, removedOrphans: 0, removedStaging: 0, kept: 0, skippedRecent: 0, failed: 0, truncated: false,
    };
    const root = resolveCompanySkillVersionsRoot(companyId);
    const rootEntries = await listDirectories(root) ?? [];
    const skillDirs = rootEntries.filter(entry => UUID_PATTERN.test(entry.name));
    const trashDirs = rootEntries.filter(entry => entry.name.startsWith(TRASH_PREFIX)
      && !activeTrash.has(path.join(root, entry.name)));
    if (skillDirs.length === 0 && trashDirs.length === 0) return result;

    const skillIds = skillDirs.map(entry => entry.name);
    const liveSkillIds = new Set<string>();
    for (const batch of chunks(skillIds, QUERY_BATCH)) {
      for (const row of await db.select({ id: companySkills.id }).from(companySkills)
        .where(and(eq(companySkills.companyId, companyId), inArray(companySkills.id, batch)))) liveSkillIds.add(row.id);
    }
    const keep = await protectedVersionIds(companyId, [...liveSkillIds], keepNewest);

    const budgetLeft = () => result.removed < maxRemovals;
    const tryRemove = async (parent: string, name: string, kind: "version" | "orphan" | "staging") => {
      if (!budgetLeft() || !shouldContinue()) {
        result.truncated = true;
        return;
      }
      try {
        if (!await removeVersionDirectory(parent, name)) return;
        result.removed++;
        if (kind === "orphan") result.removedOrphans++;
        if (kind === "staging") result.removedStaging++;
      } catch (error) {
        result.failed++;
        logger.warn({ err: error, companyId, kind }, "skill version snapshot removal failed");
      }
    };

    for (const trash of trashDirs) {
      if (!budgetLeft() || !shouldContinue()) { result.truncated = true; break; }
      try {
        await removeSnapshotTree(path.join(root, trash.name));
        result.removed++;
        result.removedStaging++;
      } catch (error) {
        result.failed++;
        logger.warn({ err: error, companyId }, "skill version snapshot trash removal failed");
      }
    }

    for (const skillDir of skillDirs) {
      if (result.truncated) break;
      const skillRoot = path.join(root, skillDir.name);
      const entries = await listDirectories(skillRoot);
      if (!entries) continue;
      const versionEntries = entries.filter(entry => UUID_PATTERN.test(entry.name));
      const existingVersions = new Set<string>();
      if (liveSkillIds.has(skillDir.name)) {
        for (const batch of chunks(versionEntries.map(entry => entry.name), QUERY_BATCH)) {
          for (const row of await db.select({ id: companySkillVersions.id }).from(companySkillVersions).where(and(
            eq(companySkillVersions.companyId, companyId),
            eq(companySkillVersions.companySkillId, skillDir.name),
            inArray(companySkillVersions.id, batch),
          ))) existingVersions.add(row.id);
        }
      }
      for (const entry of entries) {
        if (result.truncated) break;
        if (entry.name.startsWith(TRASH_PREFIX)) {
          // Left behind by a removal that crashed between rename and delete.
          if (!activeTrash.has(path.join(skillRoot, entry.name))) await tryRemove(skillRoot, entry.name, "staging");
          continue;
        }
        if (entry.name.startsWith(".")) {
          // A staging directory from an interrupted materialization.
          if (entry.mtimeMs < cutoffMs) await tryRemove(skillRoot, entry.name, "staging");
          continue;
        }
        if (!UUID_PATTERN.test(entry.name)) continue;
        if (keep.has(entry.name)) { result.kept++; continue; }
        if (entry.mtimeMs >= cutoffMs) { result.skippedRecent++; continue; }
        await tryRemove(skillRoot, entry.name, existingVersions.has(entry.name) ? "version" : "orphan");
      }
      if (!liveSkillIds.has(skillDir.name) && !result.truncated) {
        // The skill row is gone. Drop the per-skill folder once it is empty.
        await fs.rmdir(skillRoot).catch(() => undefined);
      }
    }
    return result;
  }

  /** Prunes every company, bounded by one shared removal budget per tick. */
  async function tick(options: SkillVersionPruneOptions = {}) {
    const maxRemovals = options.maxRemovals ?? defaults.maxRemovals ?? SKILL_VERSION_RETENTION_DEFAULT_MAX_REMOVALS;
    const shouldContinue = options.shouldContinue ?? defaults.shouldContinue ?? (() => true);
    const totals = { companies: 0, removed: 0, removedOrphans: 0, removedStaging: 0, failed: 0, truncated: false };
    for (const company of await db.select({ id: companies.id }).from(companies)) {
      if (totals.removed >= maxRemovals || !shouldContinue()) { totals.truncated = true; break; }
      const result = await pruneCompany(company.id, { ...options, maxRemovals: maxRemovals - totals.removed, shouldContinue });
      totals.companies++;
      totals.removed += result.removed;
      totals.removedOrphans += result.removedOrphans;
      totals.removedStaging += result.removedStaging;
      totals.failed += result.failed;
      if (result.truncated) { totals.truncated = true; break; }
    }
    return totals;
  }

  return { pruneCompany, tick };
}
