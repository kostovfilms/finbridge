import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoginRequiredError, CaptchaError } from "../src/browser.js";
import { runOnce } from "../src/run.js";
import type { SourceRunner } from "../src/sources/types.js";
import { loadLeads } from "../src/store.js";
import type { RawPost } from "../src/types.js";
import { testConfig } from "./helpers.js";

const fbPost: RawPost = { source: "facebook", sourceDetail: "група", url: "https://facebook.com/groups/1/posts/1", text: "Търсим оператор за живо снимане на концерт в Бургас." };
const fakeBrowser = { close: async () => undefined } as never;

describe("едно пускане", () => {
  it("грешка за вход или captcha в един източник не спира другите; файловете се записват", async () => {
    const cfg = testConfig();
    const runners: Record<string, SourceRunner> = {
      facebook: async ({ budget }) => [fbPost].slice(0, budget.take(1)),
      linkedin: async () => { throw new LoginRequiredError("LinkedIn"); },
      instagram: async () => { throw new CaptchaError("Instagram"); },
      upwork: async () => { throw new Error("мрежа"); },
      forums: async () => [],
    };
    const s = await runOnce({ cfg, runners, openBrowser: async () => fakeBrowser, fast: true });
    expect(s!.sources).toMatchObject({
      facebook: { status: "ok", posts: 1 },
      linkedin: { status: "login_required", message: "нужен е нов вход" },
      instagram: { status: "captcha" },
      upwork: { status: "error" },
      forums: { status: "ok" },
    });
    expect(s!.added).toBe(1);
    const out = cfg.output.dir;
    for (const f of ["leads.json", "leads.csv", "leads.xlsx", "last-run.json", "state.json"]) expect(existsSync(path.join(out, f))).toBe(true);
    expect(existsSync(path.join(out, ".run.lock"))).toBe(false);
    expect(readFileSync(path.join(out, "leads.csv"), "utf8")).toContain("Живо снимане");

    // второ пускане: същата публикация е дубликат
    const s2 = await runOnce({ cfg, runners, openBrowser: async () => fakeBrowser, fast: true });
    expect(s2!.added).toBe(0);
    expect(s2!.duplicates).toBe(1);
    expect(loadLeads(out)).toHaveLength(1);
  });

  it("ако браузърът не стартира, публичните източници пак работят", async () => {
    const cfg = testConfig();
    const forumPost: RawPost = { source: "forums", sourceDetail: "r", url: "https://reddit.com/1", text: "Looking for someone to make a 3D explainer video for our app" };
    const s = await runOnce({
      cfg,
      runners: { forums: async () => [forumPost], upwork: async () => [] },
      openBrowser: async () => { throw new Error("няма Chrome"); },
      fast: true,
    });
    expect(s!.sources.facebook!.status).toBe("error");
    expect(s!.sources.linkedin!.message).toContain("браузърът не стартира");
    expect(s!.added).toBe(1);
  });

  it("изключен източник не се пуска", async () => {
    const cfg = testConfig();
    cfg.sources.linkedin.enabled = false;
    let called = false;
    const s = await runOnce({ cfg, runners: { linkedin: async () => { called = true; return []; }, facebook: async () => [], instagram: async () => [], upwork: async () => [], forums: async () => [] }, openBrowser: async () => fakeBrowser, fast: true });
    expect(called).toBe(false);
    expect(s!.sources.linkedin!.status).toBe("disabled");
  });
});
