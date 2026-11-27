import { log } from "../logger.js";
import type { RawPost } from "../types.js";
import { parseVisibleDate } from "../util/dates.js";
import { eachSafe, pause } from "./common.js";
import { fetchText, parseFeed } from "./rss.js";
import type { SourceRunner } from "./types.js";

/**
 * Upwork без вход. Публичните RSS на Upwork са спрени (2024), затова
 * източникът чете само адресите в sources.upwork.feeds. Без адреси се пропуска.
 * Обявите в Upwork са поръчки от клиенти, т.е. всички са „търсещи“.
 */
export const runUpwork: SourceRunner = async (ctx) => {
  const feeds = ctx.cfg.sources.upwork.feeds;
  if (feeds.length === 0) {
    log.info("Upwork: няма адреси в config.yaml (sources.upwork.feeds); пропуснато");
    return [];
  }
  const out: RawPost[] = [];
  const us = ctx.cfg.markets.find((m) => m.language === "en")?.id;
  await eachSafe(feeds, (f) => `Upwork ${f}`, async (url) => {
    if (ctx.budget.empty) return;
    const items = parseFeed(await fetchText(url));
    const posts = items
      .filter((i) => i.link && i.text)
      .map<RawPost>((i) => ({
        source: "upwork",
        sourceDetail: "Upwork RSS",
        url: i.link,
        // Upwork обявите не казват „търся“: добавяме го, за да мине филтърът по ключови думи
        text: `Looking for: ${i.text}`,
        postedAt: parseVisibleDate(i.date) || undefined,
        marketHint: us,
      }));
    log.info(`Upwork: ${posts.length} обяви`);
    out.push(...posts.slice(0, ctx.budget.take(posts.length)));
    await pause(ctx.cfg, ctx.fast);
  });
  return out;
};
