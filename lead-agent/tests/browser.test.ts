import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaptchaError, LoginRequiredError, checkPage } from "../src/browser.js";
import { facebook } from "../src/selectors/facebook.js";
import { extractFacebookPosts, runFacebook } from "../src/sources/facebook.js";
import { runInstagram } from "../src/sources/instagram.js";
import { extractLinkedinPosts, linkedinPostUrl } from "../src/sources/linkedin.js";
import { Budget } from "../src/sources/types.js";
import { testConfig } from "./helpers.js";

const fx = (f: string) => pathToFileURL(path.join(import.meta.dirname, "fixtures", f)).href;
const exe = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));

let browser: Browser | undefined;
let ctx: BrowserContext;
beforeAll(async () => {
  try {
    browser = await chromium.launch({ executablePath: exe });
    ctx = await browser.newContext();
  } catch {
    browser = undefined;
  }
});
afterAll(async () => {
  await browser?.close();
});

describe("извличане от страници (Chromium)", () => {
  it("Facebook група: текст, автор, дата, връзка; „Виж още“ се разгъва, „Харесвам“ не се натиска", async (t) => {
    if (!browser) return t.skip();
    const cfg = testConfig();
    cfg.sources.facebook.groups = [fx("fb-group.html")];
    cfg.sources.facebook.search = false;
    const posts = await runFacebook({ cfg, state: { cursors: {} }, budget: new Budget(200), browser: ctx, fast: true });
    expect(posts).toHaveLength(3);
    const [first] = posts;
    expect(first!.author).toBe("Мария Петрова");
    expect(first!.url).toContain("/groups/111/posts/222/");
    expect(first!.text).toContain("Снимките са през декември"); // разгънат текст
    expect(first!.postedAt).toBeTruthy();
    // на същата страница: след извличането „Виж още“ е натиснат, „Харесвам“ не е
    const page = await ctx.newPage();
    await page.goto(fx("fb-group.html"));
    await extractFacebookPosts(page);
    expect(await page.locator("#see1").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __liked: boolean }).__liked)).toBe(false);
    await page.close();
  });

  it("лимитът за публикации се спазва", async (t) => {
    if (!browser) return t.skip();
    const cfg = testConfig();
    cfg.sources.facebook.groups = [fx("fb-group.html")];
    cfg.sources.facebook.search = false;
    const budget = new Budget(2);
    const posts = await runFacebook({ cfg, state: { cursors: {} }, budget, browser: ctx, fast: true });
    expect(posts).toHaveLength(2);
    expect(budget.empty).toBe(true);
  });

  it("LinkedIn търсене: URN → връзка към публикацията", async (t) => {
    if (!browser) return t.skip();
    const page = await ctx.newPage();
    await page.goto(fx("li-search.html"));
    const items = await extractLinkedinPosts(page);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ urn: "urn:li:activity:7001", author: "Jane Smith" });
    expect(items[0]!.text).toContain("looking for a 3D artist");
    expect(linkedinPostUrl(items[0]!.urn, "", page.url())).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7001/");
    await page.close();
  });

  it("Instagram хаштаг: връзки и текст от описанието", async (t) => {
    if (!browser) return t.skip();
    const cfg = testConfig();
    cfg.sources.instagram.hashtags = ["cgi"];
    // подменяме адреса на хаштага с примерната страница
    const S = (await import("../src/selectors/instagram.js")).instagram as { tagUrl: (t: string) => string };
    const orig = S.tagUrl;
    S.tagUrl = () => fx("ig-tag.html");
    try {
      const posts = await runInstagram({ cfg, state: { cursors: {} }, budget: new Budget(200), browser: ctx, fast: true });
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ author: "brandco", postedAt: "2026-11-01T10:00:00.000Z", sourceDetail: "#cgi" });
      expect(posts[0]!.text).toBe("Need a CGI ad for our sneaker drop in Miami");
    } finally {
      S.tagUrl = orig;
    }
  });

  it("страница за вход → нужен е нов вход; checkpoint → captcha", async (t) => {
    if (!browser) return t.skip();
    const page = await ctx.newPage();
    const g = { site: "Facebook", ...facebook.guards };
    await page.goto(fx("login.html"));
    await expect(checkPage(page, g)).rejects.toBeInstanceOf(LoginRequiredError);
    await page.goto(fx("checkpoint/index.html"));
    await expect(checkPage(page, g)).rejects.toBeInstanceOf(CaptchaError);
    await page.goto(fx("fb-group.html"));
    await expect(checkPage(page, g)).resolves.toBeUndefined();
    await page.close();
  });
});
