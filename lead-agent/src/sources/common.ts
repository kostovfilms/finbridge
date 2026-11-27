import type { Locator, Page } from "playwright";
import type { Config } from "../config.js";
import { CaptchaError, LoginRequiredError } from "../browser.js";
import { log } from "../logger.js";
import { humanPause, smoothScroll, sleep } from "../util/human.js";

export function pace(cfg: Config, fast?: boolean) {
  return fast ? { minDelaySec: 0, maxDelaySec: 0.05 } : { minDelaySec: cfg.limits.minDelaySec, maxDelaySec: cfg.limits.maxDelaySec };
}

export async function pause(cfg: Config, fast?: boolean): Promise<void> {
  await humanPause(pace(cfg, fast));
}

export async function scroll(page: Page, cfg: Config, fast?: boolean): Promise<void> {
  await smoothScroll(page, fast ? 1 : cfg.limits.scrollRounds, pace(cfg, fast));
}

/**
 * Разгъва „Виж още“ в една публикация. Натиска само бутон, чийто текст е
 * точно от списъка; нищо друго не се натиска.
 */
export async function expandSeeMore(post: Locator, texts: readonly string[]): Promise<void> {
  const allowed = new Set(texts.map((t) => t.toLowerCase()));
  const buttons = post.locator('[role="button"], button');
  const n = Math.min(await buttons.count(), 15);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const label = ((await b.innerText({ timeout: 1000 }).catch(() => "")) || "").trim().toLowerCase();
    if (allowed.has(label)) {
      await b.click({ timeout: 2000 }).catch(() => undefined);
      await sleep(300);
      return;
    }
  }
}

/** Първият ред от съобщението за грешка (Playwright добавя дълъг „Call log“). */
export function shortError(e: unknown): string {
  return ((e as Error)?.message ?? String(e)).split("\n")[0]!.trim();
}

/**
 * Пуска fn за всеки елемент и пише грешките в лога, без да спира останалите.
 * Вход/captcha спират целия източник. Ако всички опити паднат, източникът е с грешка.
 */
export async function eachSafe<T>(items: readonly T[], label: (t: T) => string, fn: (t: T) => Promise<void>): Promise<void> {
  let failed = 0;
  let last = "";
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      if (e instanceof LoginRequiredError || e instanceof CaptchaError) throw e;
      failed++;
      last = `${label(item)}: ${shortError(e)}`;
      log.warn(last);
    }
  }
  if (items.length > 0 && failed === items.length) throw new Error(`всички ${failed} опита не успяха; последно: ${last}`);
}

export function absoluteUrl(href: string | null | undefined, base: string): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}
