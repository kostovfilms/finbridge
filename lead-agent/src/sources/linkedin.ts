import type { Page } from "playwright";
import { gotoAndCheck } from "../browser.js";
import { log } from "../logger.js";
import { linkedin as S } from "../selectors/linkedin.js";
import { rotate } from "../store.js";
import type { RawPost } from "../types.js";
import { parseVisibleDate } from "../util/dates.js";
import { absoluteUrl, eachSafe, expandSeeMore, pause, scroll } from "./common.js";
import type { SourceRunner } from "./types.js";

const guards = { site: S.site, ...S.guards };

interface Extracted {
  urn: string;
  text: string;
  author: string;
  timeLabel: string;
  href: string;
}

export async function extractLinkedinPosts(page: Page): Promise<Extracted[]> {
  const posts = page.locator(S.post);
  const n = await posts.count();
  for (let i = 0; i < Math.min(n, 30); i++) await expandSeeMore(posts.nth(i), S.seeMoreTexts);
  const items = await posts.evaluateAll(
    (els, sel) =>
      els.map((el) => {
        const urnEl = el.getAttribute(sel.urnAttr) ? el : el.querySelector(`[${sel.urnAttr}]`);
        const textEl = el.querySelector(sel.text) as HTMLElement | null;
        return {
          urn: urnEl?.getAttribute(sel.urnAttr) ?? "",
          text: (textEl?.innerText ?? textEl?.textContent ?? "").trim(),
          author: (el.querySelector(sel.author)?.textContent ?? "").trim(),
          timeLabel: (el.querySelector(sel.time)?.textContent ?? "").trim(),
          href: el.querySelector(sel.permalink)?.getAttribute("href") ?? "",
        };
      }),
    { urnAttr: S.urnAttr, text: S.text, author: S.author, time: S.time, permalink: S.permalink },
  );
  // вложени елементи с един и същ URN се броят веднъж
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = it.urn || it.href || it.text.slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function linkedinPostUrl(urn: string, href: string, base: string): string {
  if (/^urn:li:(activity|share|ugcPost):/.test(urn)) return S.postUrl(urn);
  return absoluteUrl(href, base);
}

export const runLinkedin: SourceRunner = async (ctx) => {
  const { cfg, browser } = ctx;
  if (!browser) throw new Error("няма браузър");
  const out: RawPost[] = [];
  const page: Page = await browser.newPage();
  try {
    const queries = cfg.markets.flatMap((m) => m.searchQueries.map((q) => ({ q, market: m.id })));
    const n = Math.min(cfg.limits.maxSearchesPerSource, ctx.only?.searches ?? Infinity);
    await eachSafe(rotate(queries, n, ctx.state, "linkedin.search"), (q) => `LinkedIn търсене „${q.q}“`, async (q) => {
      if (ctx.budget.empty) return;
      await gotoAndCheck(page, S.searchUrl(q.q), guards);
      await scroll(page, cfg, ctx.fast);
      const now = new Date();
      const posts: RawPost[] = [];
      for (const it of await extractLinkedinPosts(page)) {
        const url = linkedinPostUrl(it.urn, it.href, page.url());
        if (!it.text || !url) continue;
        posts.push({
          source: "linkedin",
          sourceDetail: `търсене: ${q.q}`,
          url,
          text: it.text,
          author: it.author || undefined,
          postedAt: parseVisibleDate(it.timeLabel, now) || undefined,
          marketHint: q.market,
        });
      }
      log.info(`LinkedIn „${q.q}“: ${posts.length} публикации`);
      out.push(...posts.slice(0, ctx.budget.take(posts.length)));
      await pause(cfg, ctx.fast);
    });
  } finally {
    await page.close().catch(() => undefined);
  }
  return out;
};
