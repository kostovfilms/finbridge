import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "../dashboard/server.js";
import { exportAll } from "../src/export.js";
import { saveLeads } from "../src/store.js";
import { lead, testConfig } from "./helpers.js";

describe("табло", () => {
  it("връща заявките без вътрешния текст, страницата и файловете", async () => {
    const dir = testConfig().output.dir;
    const leads = [lead({ url: "https://a/1" }), lead({ url: "https://a/2", postedAt: "2026-11-25T00:00:00Z" })];
    saveLeads(dir, leads);
    await exportAll(leads, dir);
    const server = createApp(dir).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const data = (await (await fetch(`${base}/api/leads`)).json()) as Record<string, unknown>[];
      expect(data.map((d) => d.url)).toEqual(["https://a/2", "https://a/1"]);
      expect(data[0]).not.toHaveProperty("dedupeText");
      const html = await (await fetch(base + "/")).text();
      expect(html).toContain("Заявки за клиенти");
      expect((await fetch(`${base}/download/leads.xlsx`)).status).toBe(200);
      expect((await fetch(`${base}/download/..%2Fconfig.yaml`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
