/**
 * Превръща видимата дата от сайтовете в ISO: относителни („2h“, „5 ч.“, „3d“, „вчера“)
 * или абсолютни. Връща "" ако не може да се разчете.
 */
export function parseVisibleDate(label: string | undefined | null, now = new Date()): string {
  if (!label) return "";
  const s = label.toLowerCase().replace(/[•·]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^(just now|now|току-що|сега)/.test(s)) return now.toISOString();
  const units: [RegExp, number][] = [
    [/^(\d+)\s*(s|sec|secs|second|seconds|сек|секунди?)\b/u, 1],
    [/^(\d+)\s*(m|min|mins|minute|minutes|мин|минути?|минута)(?![\p{L}])/u, 60],
    [/^(\d+)\s*(h|hr|hrs|hour|hours|ч|час|часа)(?![\p{L}])/u, 3600],
    [/^(\d+)\s*(d|day|days|д|ден|дни|дена)(?![\p{L}])/u, 86400],
    [/^(\d+)\s*(w|wk|wks|week|weeks|седм|седмица|седмици)(?![\p{L}])/u, 7 * 86400],
    [/^(\d+)\s*(mo|mos|month|months|мес|месец|месеца)(?![\p{L}])/u, 30 * 86400],
    [/^(\d+)\s*(y|yr|yrs|year|years|г|год|година|години)(?![\p{L}])/u, 365 * 86400],
  ];
  const rel = s.replace(/^(преди|ago)\s+/, "");
  for (const [re, sec] of units) {
    const m = rel.match(re);
    if (m) return new Date(now.getTime() - Number(m[1]) * sec * 1000).toISOString();
  }
  if (/^(yesterday|вчера)/.test(s)) return new Date(now.getTime() - 86400 * 1000).toISOString();
  const t = Date.parse(label);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return "";
}
