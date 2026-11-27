import { describe, expect, it } from "vitest";
import { dedupe, normalizeUrl, similarity } from "../src/dedupe.js";
import { lead } from "./helpers.js";

describe("адреси", () => {
  it("маха следящи параметри, www/m., # и / накрая", () => {
    expect(normalizeUrl("https://m.facebook.com/groups/1/posts/2/?__cft__[0]=abc&__tn__=R#x")).toBe(
      "https://facebook.com/groups/1/posts/2",
    );
    expect(normalizeUrl("https://www.instagram.com/p/ABC/?igsh=zz&utm_source=x")).toBe("https://instagram.com/p/ABC");
  });

  it("пази значимите параметри (story_fbid, id) и ги подрежда", () => {
    expect(normalizeUrl("https://www.facebook.com/permalink.php?story_fbid=5&id=9&ref=bookmarks")).toBe(
      normalizeUrl("https://facebook.com/permalink.php?id=9&story_fbid=5"),
    );
  });
});

describe("дубликати", () => {
  it("сходство на текстове", () => {
    expect(similarity("Търся видеограф за сватба в София", "търся ВИДЕОГРАФ за сватба в София!!")).toBe(1);
    expect(similarity("Търся видеограф за сватба", "Need 3D animation")).toBe(0);
  });

  it("маха същия адрес и сходен текст, пази различните", () => {
    const existing = [lead({ url: "https://facebook.com/groups/1/posts/2" })];
    const incoming = [
      lead({ url: "https://www.facebook.com/groups/1/posts/2/?ref=x" }), // същият адрес
      lead({ url: "https://facebook.com/groups/9/posts/9", dedupeText: existing[0]!.dedupeText + "!" }), // същият текст в друга група
      lead({ url: "https://linkedin.com/feed/update/urn:li:activity:1", dedupeText: "Need a CGI commercial for a beverage brand launch in Miami" }),
      lead({ url: "https://linkedin.com/feed/update/urn:li:activity:2", dedupeText: "Need a CGI commercial for a beverage brand launch in Miami" }), // дубликат вътре в новите
    ];
    const r = dedupe(incoming, existing, 0.8);
    expect(r.unique.map((l) => l.url)).toEqual(["https://linkedin.com/feed/update/urn:li:activity:1"]);
    expect(r.duplicates).toBe(3);
  });

  it("кратки текстове се сравняват само по адрес", () => {
    const a = lead({ url: "https://a.com/1", dedupeText: "Търся оператор" });
    const b = lead({ url: "https://a.com/2", dedupeText: "Търся оператор" });
    expect(dedupe([b], [a], 0.8).unique).toHaveLength(1);
  });
});
