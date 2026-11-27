import { describe, expect, it, vi } from "vitest";
import { classifyPosts } from "../src/classify.js";
import type { RawPost } from "../src/types.js";
import { testConfig } from "./helpers.js";

const posts: RawPost[] = [
  { source: "facebook", sourceDetail: "Група Видео", url: "https://facebook.com/groups/1/posts/1", text: "Здравейте! Търсим видеограф за фирмено видео в Пловдив. Звънете 0888 123 456.", author: "Мария" },
  { source: "facebook", sourceDetail: "Група Видео", url: "https://facebook.com/groups/1/posts/2", text: "Предлагам заснемане на фирмено видео, цени от 200 лв." },
  { source: "linkedin", sourceDetail: "търсене: CGI ad", url: "https://linkedin.com/feed/update/urn:li:activity:3", text: "We are looking for a studio to produce a CGI ad for our launch in Austin.", marketHint: "us" },
  { source: "forums", sourceDetail: "Reddit", url: "https://reddit.com/r/x/1", text: "What a nice day" },
];

describe("класификация по ключови думи", () => {
  it("пази само търсещите, с пазар, ниша, място и резюме без телефон", async () => {
    const leads = await classifyPosts(posts, testConfig(), { apiKey: "" });
    expect(leads.map((l) => l.url)).toEqual([posts[0]!.url, posts[2]!.url]);
    const [bg, us] = leads;
    expect(bg).toMatchObject({ market: "bg", niche: "Фирмено видео", location: "Пловдив", author: "Мария", classifiedBy: "keywords" });
    expect(bg!.summary).toContain("Търсим видеограф");
    expect(bg!.summary).not.toContain("0888");
    expect(bg!.dedupeText).not.toContain("0888");
    expect(us).toMatchObject({ market: "us", niche: "CGI Ad", location: "Austin" });
  });
});

describe("класификация с Claude", () => {
  it("праща само кандидатите, без телефони, и ползва отговора", async () => {
    const cfg = testConfig();
    cfg.llm.enabled = true;
    const classifier = vi.fn(async (batch: { index: number; text: string }[]) =>
      batch.map((b) => ({ index: b.index, is_request: b.text.includes("Търсим") || b.text.includes("looking"), market: b.text.includes("Търсим") ? "bg" : "us", niche: "X", location: "Y", summary: "Нужда: видео. Тел. 0888 123 456" })),
    );
    const leads = await classifyPosts(posts, cfg, { classifier });
    const sent = classifier.mock.calls[0]![0];
    expect(sent).toHaveLength(3); // „What a nice day“ не се праща
    expect(sent.map((s) => s.text).join(" ")).not.toContain("0888");
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ classifiedBy: "llm", niche: "X", location: "Y" });
    expect(leads[0]!.summary).toContain("[телефон]");
  });

  it("при грешка от API партидата минава по ключови думи", async () => {
    const cfg = testConfig();
    const leads = await classifyPosts(posts, cfg, { classifier: async () => { throw new Error("429"); } });
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.classifiedBy === "keywords")).toBe(true);
  });
});
