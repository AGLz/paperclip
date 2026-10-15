import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  companySkills,
  companySkillVersions,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companySkillService } from "../services/company-skills.ts";
import {
  resolveCompanySkillVersionsRoot,
  runVersionSnapshotFlight,
  skillVersionRetentionService,
} from "../services/skill-version-retention.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres skill version retention tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const HOUR_MS = 60 * 60 * 1000;

async function exists(target: string) {
  return fs.lstat(target).then(() => true, () => false);
}

async function makeWritable(target: string): Promise<void> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory()) return;
  await fs.chmod(target, 0o755);
  for (const entry of await fs.readdir(target)) await makeWritable(path.join(target, entry));
}

describeEmbeddedPostgres("skill version snapshot retention", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let oldPaperclipHome: string | undefined;
  let oldPaperclipInstanceId: string | undefined;
  let paperclipHome: string | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-skill-version-retention-");
    oldPaperclipHome = process.env.PAPERCLIP_HOME;
    oldPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skill-version-retention-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "default";
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
    if (paperclipHome) {
      const skillsRoot = path.join(paperclipHome, "instances", "default", "skills");
      await makeWritable(skillsRoot);
      await fs.rm(skillsRoot, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (oldPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = oldPaperclipHome;
    if (oldPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = oldPaperclipInstanceId;
    if (paperclipHome) await fs.rm(paperclipHome, { recursive: true, force: true });
    await tempDb?.cleanup();
  });

  async function createCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Retention", issuePrefix: `R${companyId.slice(0, 6)}` });
    return companyId;
  }

  async function createSkill(companyId: string, versionCount: number, currentIndex = versionCount - 1) {
    const skillId = randomUUID();
    const key = `company/${companyId}/retained-${skillId.slice(0, 8)}`;
    await db.insert(companySkills).values({
      id: skillId, companyId, key, slug: `retained-${skillId.slice(0, 8)}`, name: "Retained",
      markdown: "# Retained", sourceType: "github", sourceLocator: "https://github.com/acme/retained",
      sourceRef: "a".repeat(40), trustLevel: "markdown_only", compatibility: "compatible",
      metadata: {}, fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    });
    const versionIds: string[] = [];
    for (let index = 0; index < versionCount; index++) {
      const [version] = await db.insert(companySkillVersions).values({
        companyId, companySkillId: skillId, revisionNumber: index + 1, label: `v${index + 1}`,
        fileInventory: [
          { path: "SKILL.md", kind: "skill", content: `---\nname: retained\n---\n\n# Revision ${index + 1}\n` },
          { path: "references/notes.md", kind: "reference", content: `notes ${index + 1}` },
        ],
      }).returning({ id: companySkillVersions.id });
      versionIds.push(version!.id);
    }
    if (versionCount > 0) {
      await db.update(companySkills).set({ currentVersionId: versionIds[currentIndex]! })
        .where(eq(companySkills.id, skillId));
    }
    return { skillId, key, versionIds };
  }

  /** Writes a read-only snapshot directory like materializeVersionSnapshot does, aged by `ageMs`. */
  async function writeSnapshot(companyId: string, skillId: string, name: string, ageMs = 3 * HOUR_MS) {
    const dir = path.join(resolveCompanySkillVersionsRoot(companyId), skillId, name);
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Snapshot", { mode: 0o444 });
    await fs.writeFile(path.join(dir, "references", "notes.md"), "notes", { mode: 0o444 });
    await fs.chmod(path.join(dir, "references"), 0o555);
    const when = new Date(Date.now() - ageMs);
    await fs.utimes(dir, when, when);
    return dir;
  }

  it("keeps current, pinned, live-run, newest, and recent versions and removes superseded ones", async () => {
    const companyId = await createCompany();
    const { skillId, key, versionIds: v } = await createSkill(companyId, 7);
    const [agent] = await db.insert(agents).values({
      companyId, name: "Pinned agent",
      adapterConfig: { paperclipSkillSync: { desiredSkills: [{ key, versionId: v[0] }] } },
    }).returning({ id: agents.id });
    await db.insert(heartbeatRuns).values([
      { companyId, agentId: agent!.id, status: "running", contextSnapshot: { skillVersions: { [key]: v[1] } } },
      { companyId, agentId: agent!.id, status: "succeeded", contextSnapshot: { skillVersions: { [key]: v[2] } } },
    ]);
    const dirs = await Promise.all(v.map((id, index) => writeSnapshot(companyId, skillId, id, index === 3 ? 0 : 3 * HOUR_MS)));

    const result = await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 2 });

    // v1 pinned, v2 live run, v4 recent, v6 + v7 newest (v7 current).
    expect(await Promise.all(dirs.map(exists))).toEqual([true, true, false, true, false, true, true]);
    expect(result).toMatchObject({ removed: 2, removedOrphans: 0, skippedRecent: 1, failed: 0, truncated: false });
    // Rows are never deleted.
    expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, skillId))).toHaveLength(7);
  });

  it("removes orphan version folders, orphan skill folders, and stale staging folders", async () => {
    const companyId = await createCompany();
    const { skillId, versionIds } = await createSkill(companyId, 1);
    const root = resolveCompanySkillVersionsRoot(companyId);
    const current = await writeSnapshot(companyId, skillId, versionIds[0]!);
    const orphanVersion = await writeSnapshot(companyId, skillId, randomUUID());
    const orphanSkillId = randomUUID();
    const orphanSkillVersion = await writeSnapshot(companyId, orphanSkillId, randomUUID());
    const staleStaging = await writeSnapshot(companyId, skillId, `.${versionIds[0]}-abc123`);
    const freshStaging = await writeSnapshot(companyId, skillId, `.${versionIds[0]}-def456`, 0);
    const leftoverTrash = await writeSnapshot(companyId, skillId, ".trash-leftover", 0);
    const unknown = await writeSnapshot(companyId, skillId, "operator-notes");

    const result = await skillVersionRetentionService(db).pruneCompany(companyId);

    expect(await exists(current)).toBe(true);
    expect(await exists(orphanVersion)).toBe(false);
    expect(await exists(orphanSkillVersion)).toBe(false);
    expect(await exists(path.join(root, orphanSkillId))).toBe(false);
    expect(await exists(staleStaging)).toBe(false);
    expect(await exists(freshStaging)).toBe(true);
    expect(await exists(leftoverTrash)).toBe(false);
    expect(await exists(unknown)).toBe(true);
    expect(result).toMatchObject({ removedOrphans: 2, removedStaging: 2, failed: 0 });
    expect((await fs.readdir(path.join(root, skillId))).filter(name => name.startsWith(".trash-"))).toEqual([]);
  });

  it("re-materializes a pruned version from its row on the next resolve", async () => {
    const companyId = await createCompany();
    const { key, versionIds } = await createSkill(companyId, 5);
    const svc = companySkillService(db);
    const selections = new Map([[key, versionIds[0]!]]);
    const first = (await svc.listRuntimeSkillEntries(companyId, { versionSelections: selections }))
      .find(entry => entry.key === key)!;
    expect(first.sourceStatus).toBe("available");
    const old = new Date(Date.now() - 3 * HOUR_MS);
    await fs.utimes(first.source, old, old);

    await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 1 });
    expect(await exists(first.source)).toBe(false);

    const again = (await svc.listRuntimeSkillEntries(companyId, { versionSelections: selections }))
      .find(entry => entry.key === key)!;
    expect(again).toMatchObject({ sourceStatus: "available", source: first.source });
    expect(await fs.readFile(path.join(again.source, "SKILL.md"), "utf8")).toContain("# Revision 1");
  });

  it("refreshes the age of a reused snapshot so the grace window protects it", async () => {
    const companyId = await createCompany();
    const { key, versionIds } = await createSkill(companyId, 5);
    const svc = companySkillService(db);
    const selections = new Map([[key, versionIds[0]!]]);
    const first = (await svc.listRuntimeSkillEntries(companyId, { versionSelections: selections }))
      .find(entry => entry.key === key)!;
    const old = new Date(Date.now() - 3 * HOUR_MS);
    await fs.utimes(first.source, old, old);
    await svc.listRuntimeSkillEntries(companyId, { versionSelections: selections });

    const result = await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 1 });
    expect(result.skippedRecent).toBe(1);
    expect(await exists(first.source)).toBe(true);
  });

  it("skips a version folder while a materialization holds it", async () => {
    const companyId = await createCompany();
    const { skillId, versionIds } = await createSkill(companyId, 3);
    const dir = await writeSnapshot(companyId, skillId, versionIds[0]!);
    let release!: () => void;
    const held = runVersionSnapshotFlight(dir, () => new Promise<string>(resolve => { release = () => resolve(dir); }));

    await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 1 });
    expect(await exists(dir)).toBe(true);
    release();
    await held;
    await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 1 });
    expect(await exists(dir)).toBe(false);
  });

  it("removes the skill's versions folder when the skill is deleted", async () => {
    const companyId = await createCompany();
    const { skillId, versionIds } = await createSkill(companyId, 2);
    await writeSnapshot(companyId, skillId, versionIds[0]!);
    await writeSnapshot(companyId, skillId, versionIds[1]!, 0);

    await companySkillService(db).deleteSkill(companyId, skillId);

    const root = resolveCompanySkillVersionsRoot(companyId);
    expect(await exists(path.join(root, skillId))).toBe(false);
    expect((await fs.readdir(root)).filter(name => name.startsWith(".trash-"))).toEqual([]);
  });

  it("never removes anything outside the company's versions root", async () => {
    const companyId = await createCompany();
    const otherCompanyId = await createCompany();
    const { skillId, versionIds } = await createSkill(companyId, 3);
    const other = await createSkill(otherCompanyId, 3);
    const otherDirs = await Promise.all(other.versionIds.map(id => writeSnapshot(otherCompanyId, other.skillId, id)));
    const outside = await fs.mkdtemp(path.join(paperclipHome!, "outside-"));
    await fs.writeFile(path.join(outside, "keep.txt"), "keep");
    const root = resolveCompanySkillVersionsRoot(companyId);
    const victim = await writeSnapshot(companyId, skillId, versionIds[0]!);
    await fs.chmod(victim, 0o755);
    await fs.symlink(outside, path.join(victim, "escape"));
    const old = new Date(Date.now() - 3 * HOUR_MS);
    await fs.utimes(victim, old, old);
    await fs.mkdir(root, { recursive: true });
    await fs.symlink(outside, path.join(root, randomUUID()));
    await fs.symlink(outside, path.join(root, skillId, randomUUID()));

    await skillVersionRetentionService(db).pruneCompany(companyId, { keepNewest: 1 });

    expect(await exists(victim)).toBe(false);
    expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("keep");
    expect(await Promise.all(otherDirs.map(exists))).toEqual([true, true, true]);
  });

  it("bounds removals per tick and continues on the next tick", async () => {
    const companyId = await createCompany();
    const { skillId, versionIds } = await createSkill(companyId, 6);
    await Promise.all(versionIds.map(id => writeSnapshot(companyId, skillId, id)));
    const retention = skillVersionRetentionService(db, { keepNewest: 1, maxRemovals: 2 });

    expect(await retention.tick()).toMatchObject({ removed: 2, truncated: true });
    expect(await retention.tick()).toMatchObject({ removed: 2, truncated: true });
    expect(await retention.tick()).toMatchObject({ removed: 1, truncated: false });
    expect(await fs.readdir(path.join(resolveCompanySkillVersionsRoot(companyId), skillId))).toEqual([versionIds[5]]);
  });
});
