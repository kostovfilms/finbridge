import * as cheerio from "cheerio";
import type { FeedConfig } from "../config.js";
import { log } from "../logger.js";
import type { RawPost } from "../types.js";
import { parseVisibleDate } from "../util/dates.js";
import { absoluteUrl, eachSafe, pause } from "./common.js";
import { fetchText, parseFeed } from "./rss.js";
import type { SourceRunner } from "./types.js";

/** Чете обяви от HTML страница по селекторите от config.yaml. */
export function parseHtmlListing(html: string, feed: FeedConfig): { link: string; text: string }[] {
  if (!feed.itemSelector) return [];
  const $ = cheerio.load(html);
  const out: { link: string; text: string }[] = [];
  $(feed.itemSelector).each((_, el) => {
    const item = $(el);
    const linkEl = feed.linkSelector ? item.find(feed.linkSelector).first() : item.is("a") ? item : item.find("a").first();
    const href = linkEl.attr("href") ?? "";
    const text = (feed.textSelector ? item.find(feed.textSelector).text() : item.text()).replace(/\s+/g, " ").trim();
    const link = absoluteUrl(href, feed.url);
    if (link && text) out.push({ link, text });
  });
  return out;
}

export const runForums: SourceRunner = async (ctx) => {
  const out: RawPost[] = [];
  await eachSafe(ctx.cfg.sources.forums.feeds, (f) => `Форум ${f.name}`, async (feed) => {
    if (ctx.budget.empty) return;
    const body = await fetchText(feed.url);
    const posts: RawPost[] =
      feed.type === "rss"
        ? parseFeed(body)
            .filter((i) => i.link && i.text)
            .map((i) => ({
              source: "forums",
              sourceDetail: feed.name,
              url: i.link,
              text: i.text,
              author: i.author || undefined,
              postedAt: parseVisibleDate(i.date) || undefined,
              marketHint: feed.market,
            }))
        : parseHtmlListing(body, feed).map((i) => ({
            source: "forums",
            sourceDetail: feed.name,
            url: i.link,
            text: i.text,
            marketHint: feed.market,
          }));
    log.info(`Форум ${feed.name}: ${posts.length} публикации`);
    out.push(...posts.slice(0, ctx.budget.take(posts.length)));
    await pause(ctx.cfg, ctx.fast);
  });
  return out;
};
