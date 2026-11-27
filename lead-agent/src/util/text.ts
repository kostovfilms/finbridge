/** Помощни функции за текст: нормализиране, търсене на фрази, лични данни, резюме. */

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PhraseMatch {
  phrase: string;
  index: number;
  end: number;
}

/**
 * Намира всички срещания на фразите. Лявата граница трябва да е край на дума,
 * дясната не: така "видеограф" хваща и "видеографа" (кирилицата няма \b в JS).
 * Фраза, която започва и завършва с буква, изисква граница отляво.
 */
export function findPhrases(text: string, phrases: readonly string[], opts: { wholeWord?: boolean } = {}): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  const lower = text.toLowerCase();
  for (const raw of phrases) {
    const phrase = raw.toLowerCase().trim();
    if (!phrase) continue;
    const startsWithLetter = /^[\p{L}\p{N}]/u.test(phrase);
    const endsWithLetter = /[\p{L}\p{N}]$/u.test(phrase);
    const re = new RegExp(
      (startsWithLetter ? "(?<![\\p{L}\\p{N}])" : "") +
        escapeRe(phrase).replace(/ /g, "\\s+") +
        (opts.wholeWord && endsWithLetter ? "(?![\\p{L}\\p{N}])" : ""),
      "gu",
    );
    for (const m of lower.matchAll(re)) {
      out.push({ phrase: raw, index: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.index - b.index || b.end - a.end);
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// Телефон: поне 8 цифри с интервали, тирета, скоби; по желание +
const PHONE_RE = /(?<![\p{L}\p{N}])\+?\d[\d\s\-().]{6,}\d(?![\p{L}\p{N}])/gu;

export function redactContacts(text: string): string {
  return text
    .replace(EMAIL_RE, "[имейл]")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[телефон]" : m));
}

export function cyrillicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  return cyr / letters.length;
}

/** Разделя на изречения, като пази знака в края. */
export function sentences(text: string): string[] {
  return normalizeSpace(text)
    .split(/(?<=[.!?…])\s+|\s*\n+\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 1–2 изречения около първата фраза за търсене; до maxLen знака. */
export function summarize(text: string, anchorIndex: number | undefined, maxLen = 280): string {
  const clean = normalizeSpace(text);
  if (!clean) return "";
  let source = text;
  if (anchorIndex !== undefined && anchorIndex > 0) {
    // от началото на изречението, в което е фразата
    const before = text.slice(0, anchorIndex);
    let cut = 0;
    for (const m of before.matchAll(/[.!?…]+\s+|\n+/gu)) cut = m.index + m[0].length;
    source = text.slice(cut);
  }
  const parts = sentences(source);
  let out = parts.slice(0, 2).join(" ");
  if (!out) out = clean;
  if (out.length > maxLen) out = out.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}

/** Думи за сравнение на текстове (без препинателни знаци, малки букви). */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 2);
}
