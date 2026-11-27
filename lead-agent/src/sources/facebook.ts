import type { Page } from "playwright";
import { gotoAndCheck } from "../browser.js";
import { log } from "../logger.js";
import { facebook as S } from "../selectors/facebook.js";
import { rotate } from "../store.js";
import type { RawPost } from "../types.js";
import { parseVisibleDate } from "../util/dates.js";
import { absoluteUrl, eachSafe, expandSeeMore, pause, scroll } from "./common.js";
import type { SourceContext, SourceRunner } from "./types.js";

const guards = { site: S.site, ...S.guards };

interface Extracted {
  text: string;
  author: string;
  href: string;
  timeLabel: string;
}

/** Чете публикациите, които са заредени на страницата (група или търсене). */
export async function extractFacebookPosts(page: Page): Promise<Extracted[]> {
  const posts = page.locator(S.post);
  const n = await posts.count();
  for (let i = 0; i < Math.min(n, 40); i++) await expandSeeMore(posts.nth(i), S.seeMoreTexts);
  return posts.evaluateAll(
    (all, sel) =>
      // вложени съвпадения (обвивка + статия) се броят веднъж: пази най-външния елемент
      all.filter((el) => !all.some((o) => o !== el && o.contains(el))).map((el) => {
        const pick = (q: string) => el.querySelector(q);
        let textEl = pick(sel.text);
        if (!textEl) {
          const all = Array.from(el.querySelectorAll(sel.textFallback));
          textEl = all.sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0] ?? null;
        }
        const link = pick(sel.permalink) as HTMLAnchorElement | null;
        const time = pick(sel.time);
        return {
          text: ((textEl as HTMLElement | null)?.innerText ?? textEl?.textContent ?? "").trim(),
          author: (pick(sel.author)?.textContent ?? "").trim(),
          href: link?.getAttribute("href") ?? "",
          timeLabel:
            time?.getAttribute("datetime") ??
            link?.getAttribute("aria-label") ??
            (link?.textContent ?? "").trim(),
        };
      }),
    { text: S.text, textFallback: S.textFallback, author: S.author, permalink: S.permalink, time: S.time },
  );
}

function toRaw(items: Extracted[], base: string, detail: string, marketHint: string | undefined, now: Date): RawPost[] {
  const out: RawPost[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const url = absoluteUrl(it.href, base);
    if (!it.text || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      source: "facebook",
      sourceDetail: detail,
      url,
      text: it.text,
      author: it.author || undefined,
      postedAt: parseVisibleDate(it.timeLabel, now) || undefined,
      marketHint,
    });
  }
  return out;
}

async function readPage(page: Page, ctx: SourceContext, url: string, detail: string, marketHint?: string): Promise<RawPost[]> {
  await gotoAndCheck(page, url, guards);
  await scroll(page, ctx.cfg, ctx.fast);
  const items = await extractFacebookPosts(page);
  const posts = toRaw(items, page.url(), detail, marketHint, new Date());
  const allowed = ctx.budget.take(posts.length);
  log.info(`Facebook ${detail}: ${posts.length} публикации`);
  return posts.slice(0, allowed);
}

export const runFacebook: SourceRunner = async (ctx) => {
  const { cfg, browser } = ctx;
  if (!browser) throw new Error("няма браузър");
  const out: RawPost[] = [];
  const page = await browser.newPage();
  try {
    const maxGroups = Math.min(cfg.limits.maxGroups, ctx.only?.groups ?? Infinity);
    const groups = rotate(cfg.sources.facebook.groups, maxGroups, ctx.state, "facebook.groups");
    await eachSafe(groups, (g) => `Facebook група ${g}`, async (g) => {
      if (ctx.budget.empty) return;
      out.push(...(await readPage(page, ctx, S.groupUrl(g), g)));
      await pause(cfg, ctx.fast);
    });
    if (cfg.sources.facebook.search) {
      const queries = cfg.markets.flatMap((m) => m.searchQueries.map((q) => ({ q, market: m.id })));
      const n = Math.min(cfg.limits.maxSearchesPerSource, ctx.only?.searches ?? Infinity);
      await eachSafe(rotate(queries, n, ctx.state, "facebook.search"), (q) => `Facebook търсене „${q.q}“`, async (q) => {
        if (ctx.budget.empty) return;
        out.push(...(await readPage(page, ctx, S.searchUrl(q.q), `търсене: ${q.q}`, q.market)));
        await pause(cfg, ctx.fast);
      });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return out;
};
