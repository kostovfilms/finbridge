import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { cronEveryHours, inWorkHours } from "../src/hours.js";
import { dailySummaryText } from "../src/notify.js";
import { applyRetention, rotate, sortNewestFirst } from "../src/store.js";
import { lead, testConfig } from "./helpers.js";

describe("конфигурация", () => {
  it("config.yaml се чете и има стойностите от заданието", () => {
    const cfg = testConfig();
    expect(cfg.limits).toMatchObject({ maxGroups: 30, maxPostsPerRun: 200, minDelaySec: 5, maxDelaySec: 20 });
    expect(cfg.schedule.everyHours).toBe(6);
    expect(cfg.privacy.retentionDays).toBe(90);
    expect(cfg.markets.map((m) => m.id)).toEqual(["bg", "us"]);
  });
  it("грешка с път до полето", () => {
    expect(() => parseConfig("markets: []\nseekerPhrases: [a]\nsources: {}\nlimits: {}")).toThrow(/markets/);
  });
});

describe("съхранение", () => {
  it("трие записи по-стари от 90 дни", () => {
    const now = new Date("2026-11-27T00:00:00Z");
    const kept = applyRetention(
      [lead({ url: "a", collectedAt: "2026-08-01T00:00:00Z" }), lead({ url: "b", collectedAt: "2026-09-01T00:00:00Z" })],
      90,
      now,
    );
    expect(kept.map((l) => l.url)).toEqual(["b"]);
  });
  it("без дата на публикуване се подрежда по дата на събиране", () => {
    const s = sortNewestFirst([lead({ url: "a", postedAt: "", collectedAt: "2026-01-01T00:00:00Z" }), lead({ url: "b", postedAt: "2026-02-01T00:00:00Z" })]);
    expect(s.map((l) => l.url)).toEqual(["b", "a"]);
  });
  it("заявките се въртят между пусканията", () => {
    const st = { cursors: {} };
    expect(rotate(["a", "b", "c"], 2, st, "k")).toEqual(["a", "b"]);
    expect(rotate(["a", "b", "c"], 2, st, "k")).toEqual(["c", "a"]);
  });
});

describe("график и известие", () => {
  it("работни часове", () => {
    const at = (h: number) => new Date(2026, 10, 27, h, 0);
    expect(inWorkHours(at(9), "09:00", "21:00")).toBe(true);
    expect(inWorkHours(at(21), "09:00", "21:00")).toBe(false);
    expect(inWorkHours(at(23), "22:00", "06:00")).toBe(true);
    expect(cronEveryHours(6)).toBe("0 */6 * * *");
  });
  it("текст на дневното резюме", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    expect(dailySummaryText([lead({ collectedAt: "2026-11-27T10:00:00Z" }), lead({ market: "us", collectedAt: "2026-11-27T11:00:00Z" })], now)).toMatch(/^2 нови заявки.*BG: 1, US: 1/);
  });
});
