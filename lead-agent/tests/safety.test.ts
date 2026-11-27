import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(import.meta.dirname, "..", "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/**
 * Агентът само чете. Този тест пада, ако в кода се появи действие, което пише
 * в сайт: попълване на поле, натискане на клавиш, качване на файл, POST заявка.
 */
describe("само четене", () => {
  const all = files(SRC).map((f) => ({ f: path.relative(SRC, f), code: readFileSync(f, "utf8") }));

  it.each([/\.fill\(/, /\.type\(/, /\.press\(/, /keyboard\./, /setInputFiles/, /\.check\(/, /selectOption/, /method:\s*["']POST/i, /\.dblclick\(/, /dispatchEvent/])(
    "няма %s",
    (re) => {
      expect(all.filter(({ code }) => re.test(code)).map(({ f }) => f)).toEqual([]);
    },
  );

  it("натискане (.click) има само в разгъването на „Виж още“", () => {
    const withClick = all.filter(({ code }) => /\.click\(/.test(code)).map(({ f }) => f);
    expect(withClick).toEqual([path.join("sources", "common.ts")]);
  });
});
