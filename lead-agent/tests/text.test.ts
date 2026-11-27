import { describe, expect, it } from "vitest";
import { parseVisibleDate } from "../src/util/dates.js";
import { redactContacts, summarize } from "../src/util/text.js";

describe("лични данни", () => {
  it("маха телефони и имейли", () => {
    const t = redactContacts("Пишете на ivan.petrov@abv.bg или 0888 123 456, +359 2 987 6543");
    expect(t).toBe("Пишете на [имейл] или [телефон], [телефон]");
  });
  it("не пипа години и суми", () => {
    expect(redactContacts("Бюджет 1500 лв, 2026 г.")).toBe("Бюджет 1500 лв, 2026 г.");
  });
});

describe("резюме", () => {
  it("1–2 изречения от изречението с търсенето", () => {
    const t = "Здравейте на всички! Благодаря за приемането. Търсим оператор за концерт. Плащаме добре. Пишете на лични.";
    expect(summarize(t, t.indexOf("Търсим"))).toBe("Търсим оператор за концерт. Плащаме добре.");
  });
  it("реже дълъг текст", () => {
    const s = summarize("Търся " + "много ".repeat(100), 0, 100);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("дати", () => {
  const now = new Date("2026-11-27T12:00:00Z");
  it.each([
    ["2h", "2026-11-27T10:00:00.000Z"],
    ["5 ч.", "2026-11-27T07:00:00.000Z"],
    ["3d •", "2026-11-24T12:00:00.000Z"],
    ["1w", "2026-11-20T12:00:00.000Z"],
    ["15 мин", "2026-11-27T11:45:00.000Z"],
    ["Вчера в 14:00", "2026-11-26T12:00:00.000Z"],
    ["2026-11-01T08:00:00Z", "2026-11-01T08:00:00.000Z"],
    ["", ""],
    ["Sponsored", ""],
  ])("%s", (label, iso) => {
    expect(parseVisibleDate(label, now)).toBe(iso);
  });
});
