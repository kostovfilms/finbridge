import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runForums, parseHtmlListing } from "../src/sources/forums.js";
import { parseFeed } from "../src/sources/rss.js";
import { Budget } from "../src/sources/types.js";
import { runUpwork } from "../src/sources/upwork.js";
import { classifyByKeywords } from "../src/classify.js";
import { testConfig } from "./helpers.js";

const read = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("RSS / Atom", () => {
  it("RSS 2.0: заглавие + текст без HTML, автор, дата", () => {
    const items = parseFeed(read("feed.rss"));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ link: "https://www.reddit.com/r/forhire/comments/abc/", author: "/u/maker" });
    expect(items[0]!.text).toBe("[Hiring] 3D product animation for kickstarter\nNeed a 3D product animation , 30 seconds. Based in Denver.");
  });
  it("Atom: връзка от href", () => {
    const [e] = parseFeed(read("feed.atom"));
    expect(e).toMatchObject({ link: "https://www.reddit.com/r/bulgaria/comments/xyz/", author: "/u/ivan" });
    expect(e!.text).toContain("Варна");
  });
  it("HTML страница със селектори", () => {
    const items = parseHtmlListing(read("listing.html"), { name: "x", market: "bg", type: "html", url: "https://example.bg/q", itemSelector: ".card" });
    expect(items.map((i) => i.link)).toEqual(["https://example.bg/ad/1", "https://example.bg/ad/2"]);
  });
});

describe("публични източници (без мрежа)", () => {
  it("форуми: чете, класифицира и пропуска източник с грешка", async () => {
    const cfg = testConfig();
    cfg.sources.forums.feeds = [
      { name: "RSS", market: "us", type: "rss", url: "https://example.com/a.rss" },
      { name: "Блокиран", market: "bg", type: "rss", url: "https://blocked.example/b.rss" },
      { name: "Atom", market: "bg", type: "rss", url: "https://example.com/c.atom" },
    ];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("blocked")) return new Response("no", { status: 403 });
      return new Response(read(url.endsWith(".atom") ? "feed.atom" : "feed.rss"));
    });
    const posts = await runForums({ cfg, state: { cursors: {} }, budget: new Budget(200), fast: true });
    expect(posts).toHaveLength(3);
    const leads = classifyByKeywords(posts, cfg);
    expect(leads.map((l) => [l.market, l.niche, l.location])).toEqual([
      ["us", "3D Product Animation", "Denver"],
      ["bg", "Снимачен екип", "Варна"],
    ]);
  });

  it("Upwork: без адреси се пропуска, с адреси обявите са „търсещи“", async () => {
    const cfg = testConfig();
    expect(await runUpwork({ cfg, state: { cursors: {} }, budget: new Budget(10), fast: true })).toEqual([]);
    cfg.sources.upwork.feeds = ["https://example.com/up.rss"];
    vi.stubGlobal("fetch", async () => new Response(read("feed.rss").replace("[For Hire] 3D artist", "3D render of a watch").replace("My portfolio", "photoreal product render")));
    const posts = await runUpwork({ cfg, state: { cursors: {} }, budget: new Budget(10), fast: true });
    expect(posts).toHaveLength(2);
    expect(classifyByKeywords(posts, cfg)).toHaveLength(2);
  });
});
