import type { Page } from "playwright";

export interface Pace {
  minDelaySec: number;
  maxDelaySec: number;
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Случайна пауза между minDelaySec и maxDelaySec (по подразбиране 5–20 с). */
export async function humanPause(pace: Pace): Promise<void> {
  await sleep(Math.round(randomBetween(pace.minDelaySec, pace.maxDelaySec) * 1000));
}

/** Плавно скролване надолу на малки стъпки с колелцето на мишката. */
export async function smoothScroll(page: Page, rounds: number, pace: Pace): Promise<void> {
  for (let r = 0; r < rounds; r++) {
    const total = randomBetween(600, 1400);
    const steps = Math.round(randomBetween(8, 16));
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, total / steps);
      await sleep(randomBetween(60, 180));
    }
    // кратко „четене“ между екраните; пълната пауза е между страниците
    await sleep(randomBetween(Math.min(1500, pace.minDelaySec * 1000), Math.max(2000, (pace.minDelaySec * 1000) / 2 + 1500)));
  }
}
