import { createRequire } from "node:module";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve("express/package.json"));
const proxyAddr = expressRequire("proxy-addr");

describe("critical dependency security boundaries", () => {
  it("does not trust arbitrary IPv4 clients through a short mapped IPv6 subnet", () => {
    // GHSA-jqcg-44mw-7w3h: a short IPv6 prefix must not trust all IPv4 clients.
    expect(proxyAddr.compile("::ffff:10.0.0.0/8")("203.0.113.8", 0)).toBe(false);
    const privateSubnet = proxyAddr.compile("10.0.0.0/8");
    expect(privateSubnet("10.0.0.8", 0)).toBe(true);
    expect(privateSubnet("203.0.113.8", 0)).toBe(false);
  });

  it("removes template expressions joined by sanitization inside an attached shadow root", () => {
    // GHSA-cg2g-xh64-v4q7: removing a forbidden separator joins two benign fragments.
    const dom = new JSDOM("");
    try {
      const document = dom.window.document;
      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(
        document.createTextNode("safe $"),
        document.createElement("object"),
        document.createTextNode("{unsafeTemplateValue}"),
      );
      const purifier = createDOMPurify(dom.window as unknown as Parameters<typeof createDOMPurify>[0]);
      purifier.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
      shadow.normalize();
      expect(shadow.textContent).toContain("safe ");
      expect(shadow.textContent).not.toContain("${unsafeTemplateValue}");
    } finally {
      dom.window.close();
    }
  });
});
