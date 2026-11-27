function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Дали часът е в работния прозорец. Поддържа и прозорец през полунощ (22:00–06:00). */
export function inWorkHours(now: Date, start: string, end: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return true;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** cron израз „на всеки N часа“ в началото на часа. */
export function cronEveryHours(n: number): string {
  return n >= 24 ? "0 9 * * *" : `0 */${n} * * *`;
}
