import { existsSync, mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveFromRoot, type Config } from "./config.js";

/** Сесията е изтекла: източникът спира, нужен е нов `npm run login`. */
export class LoginRequiredError extends Error {
  constructor(public readonly site: string) {
    super(`${site}: нужен е нов вход (npm run login)`);
    this.name = "LoginRequiredError";
  }
}

/** Captcha или проверка за сигурност: източникът се пропуска, нищо не се заобикаля. */
export class CaptchaError extends Error {
  constructor(public readonly site: string) {
    super(`${site}: captcha или проверка за сигурност; източникът е пропуснат`);
    this.name = "CaptchaError";
  }
}

export function executablePath(cfg: Config): string | undefined {
  const p = cfg.browser.executablePath || process.env.CHROME_PATH || "";
  return p && existsSync(p) ? p : undefined;
}

/** Отваря браузъра с постоянния профил (там са бисквитките от ръчния вход). */
export async function openContext(cfg: Config, opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  const dir = resolveFromRoot(cfg.browser.profileDir);
  mkdirSync(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, {
    headless: opts.headless ?? cfg.browser.headless,
    executablePath: executablePath(cfg),
    viewport: { width: 1280, height: 860 },
    locale: "bg-BG",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

export interface PageGuards {
  site: string;
  /** Части от адреса, които значат „не сте влезли“ */
  loginUrl: RegExp;
  /** Селектори, които значат „не сте влезли“ */
  loginSelectors: readonly string[];
  /** Части от адреса или селектори за captcha/проверка */
  captchaUrl: RegExp;
  captchaSelectors: readonly string[];
}

/** Проверява страницата след зареждане: вход или captcha → грешка, която спира само този източник. */
export async function checkPage(page: Page, g: PageGuards): Promise<void> {
  const url = page.url();
  if (g.captchaUrl.test(url)) throw new CaptchaError(g.site);
  for (const sel of g.captchaSelectors) {
    if ((await page.locator(sel).count()) > 0) throw new CaptchaError(g.site);
  }
  if (g.loginUrl.test(url)) throw new LoginRequiredError(g.site);
  for (const sel of g.loginSelectors) {
    if ((await page.locator(sel).count()) > 0) throw new LoginRequiredError(g.site);
  }
}

/**
 * Отваря адрес само за четене. Агентът не пише, не харесва и не натиска бутони
 * освен „Виж още“ (разгъване на текст), което е изрично в селекторите.
 */
export async function gotoAndCheck(page: Page, url: string, g: PageGuards): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2500);
  await checkPage(page, g);
}
