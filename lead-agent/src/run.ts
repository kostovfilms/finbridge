import "dotenv/config";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext } from "playwright";
import { CaptchaError, LoginRequiredError, openContext } from "./browser.js";
import { classifyPosts, type LlmClassifier } from "./classify.js";
import { loadConfig, resolveFromRoot, type Config } from "./config.js";
import { dedupe } from "./dedupe.js";
import { exportAll } from "./export.js";
import { log } from "./logger.js";
import { maybeNotify } from "./notify.js";
import { runFacebook } from "./sources/facebook.js";
import { shortError } from "./sources/common.js";
import { runForums } from "./sources/forums.js";
import { runInstagram } from "./sources/instagram.js";
import { runLinkedin } from "./sources/linkedin.js";
import { Budget, type SourceContext, type SourceRunner } from "./sources/types.js";
import { runUpwork } from "./sources/upwork.js";
import { applyRetention, loadLeads, loadState, saveLeads, saveState, sortNewestFirst } from "./store.js";
import type { RawPost, SourceName } from "./types.js";

export type SourceStatus = "ok" | "login_required" | "captcha" | "error" | "disabled";

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  read: number;
  matched: number;
  added: number;
  duplicates: number;
  removedByRetention: number;
  total: number;
  sources: Record<string, { status: SourceStatus; posts: number; message?: string }>;
}

export interface RunOptions {
  cfg?: Config;
  /** Подменя източниците (тестове) */
  runners?: Partial<Record<SourceName, SourceRunner>>;
  /** Подменя браузъра (тестове) */
  openBrowser?: (cfg: Config) => Promise<BrowserContext>;
  classifier?: LlmClassifier;
  fast?: boolean;
  only?: SourceContext["only"];
  /** Само тези източници */
  sources?: SourceName[];
  now?: Date;
}

const ORDER: { name: SourceName; browser: boolean }[] = [
  { name: "upwork", browser: false },
  { name: "forums", browser: false },
  { name: "facebook", browser: true },
  { name: "linkedin", browser: true },
  { name: "instagram", browser: true },
];

const DEFAULT_RUNNERS: Record<SourceName, SourceRunner> = {
  facebook: runFacebook,
  linkedin: runLinkedin,
  instagram: runInstagram,
  upwork: runUpwork,
  forums: runForums,
};

const LOCK_STALE_MS = 3 * 3600 * 1000;

function acquireLock(outDir: string): string | undefined {
  mkdirSync(outDir, { recursive: true });
  const lock = path.join(outDir, ".run.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) {
    const pid = readFileSync(lock, "utf8");
    log.warn(`Друго пускане още работи (pid ${pid}); това се пропуска`);
    return undefined;
  }
  writeFileSync(lock, String(process.pid));
  return lock;
}

/** Едно пускане: чете източниците един по един, класифицира, маха дубликати, експортира. */
export async function runOnce(opts: RunOptions = {}): Promise<RunSummary | undefined> {
  const cfg = opts.cfg ?? loadConfig();
  const outDir = resolveFromRoot(cfg.output.dir);
  const lock = acquireLock(outDir);
  if (!lock) return undefined;
  try {
    return await runLocked(cfg, outDir, opts);
  } finally {
    rmSync(lock, { force: true });
  }
}

async function runLocked(cfg: Config, outDir: string, opts: RunOptions): Promise<RunSummary> {
  const startedAt = (opts.now ?? new Date()).toISOString();
  const runners = { ...DEFAULT_RUNNERS, ...opts.runners };
  const state = loadState(outDir);
  const budget = new Budget(cfg.limits.maxPostsPerRun);
  const sources: RunSummary["sources"] = {};
  const raw: RawPost[] = [];
  let browser: BrowserContext | undefined;
  let browserFailed = false;

  try {
    log.info(`Начало на пускане (лимит ${cfg.limits.maxPostsPerRun} публикации)`);
    for (const { name, browser: needsBrowser } of ORDER) {
      if (!cfg.sources[name].enabled || (opts.sources && !opts.sources.includes(name))) {
        sources[name] = { status: "disabled", posts: 0 };
        continue;
      }
      if (budget.empty) {
        sources[name] = { status: "ok", posts: 0, message: "лимитът за публикации е достигнат" };
        continue;
      }
      try {
        if (needsBrowser && !browser) {
          if (browserFailed) throw new Error("браузърът не стартира");
          try {
            browser = await (opts.openBrowser ?? ((c) => openContext(c)))(cfg);
          } catch (e) {
            browserFailed = true;
            throw new Error(`браузърът не стартира: ${(e as Error).message}`, { cause: e });
          }
        }
        const posts = await runners[name]({ cfg, state, budget, browser: needsBrowser ? browser : undefined, fast: opts.fast, only: opts.only });
        raw.push(...posts);
        sources[name] = { status: "ok", posts: posts.length };
      } catch (e) {
        if (e instanceof LoginRequiredError) {
          log.warn(`${e.site}: нужен е нов вход. Пуснете npm run login. Продължавам с останалите източници.`);
          sources[name] = { status: "login_required", posts: 0, message: "нужен е нов вход" };
        } else if (e instanceof CaptchaError) {
          log.warn(`${e.site}: captcha/проверка — източникът е пропуснат. Влезте ръчно с npm run login.`);
          sources[name] = { status: "captcha", posts: 0, message: "captcha, пропуснато" };
        } else {
          const msg = shortError(e);
          log.error(`${name}: ${msg}`);
          sources[name] = { status: "error", posts: 0, message: msg };
        }
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const now = opts.now ?? new Date();
  const before = loadLeads(outDir);
  const existing = applyRetention(before, cfg.privacy.retentionDays, now);
  const matched = await classifyPosts(raw, cfg, { classifier: opts.classifier, now });
  const { unique, duplicates } = dedupe(matched, existing, cfg.dedupe.similarity);
  const all = sortNewestFirst([...unique, ...existing]);
  saveLeads(outDir, all);
  await exportAll(all, outDir);
  state.lastRun = now.toISOString();
  maybeNotify(cfg.notifications.dailySummary, all, state, now);
  saveState(outDir, state);

  const summary: RunSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    read: raw.length,
    matched: matched.length,
    added: unique.length,
    duplicates,
    removedByRetention: before.length - existing.length,
    total: all.length,
    sources,
  };
  writeFileSync(path.join(outDir, "last-run.json"), JSON.stringify(summary, null, 2));
  log.info(
    `Край: прочетени ${summary.read}, заявки ${summary.matched}, нови ${summary.added}, дубликати ${summary.duplicates}, изтрити (над ${cfg.privacy.retentionDays} дни) ${summary.removedByRetention}, общо ${summary.total}`,
  );
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runOnce().then(
    () => process.exit(0),
    (e: unknown) => {
      log.error(`Пускането спря: ${(e as Error).stack ?? String(e)}`);
      process.exit(1);
    },
  );
}
