import "dotenv/config";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { runOnce } from "./run.js";
import type { SourceName } from "./types.js";

/**
 * Ръчна проверка: 1 група и 1 търсене на източник, видим браузър.
 * По желание само някои източници: npm run check -- facebook linkedin
 */
const cfg = loadConfig();
cfg.browser.headless = false;
cfg.limits.maxPostsPerRun = Math.min(cfg.limits.maxPostsPerRun, 40);
const valid: SourceName[] = ["facebook", "linkedin", "instagram", "upwork", "forums"];
const picked = process.argv.slice(2).filter((a): a is SourceName => (valid as string[]).includes(a));
const summary = await runOnce({ cfg, only: { groups: 1, searches: 1 }, sources: picked.length ? picked : undefined });
if (summary) {
  log.info("Резултат от проверката:");
  for (const [name, s] of Object.entries(summary.sources)) {
    log.info(`  ${name.padEnd(10)} ${s.status.padEnd(15)} публикации: ${s.posts}${s.message ? `  (${s.message})` : ""}`);
  }
  log.info(`  Нови заявки: ${summary.added}. Файлове: output/leads.csv, output/leads.xlsx`);
}
