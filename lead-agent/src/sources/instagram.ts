import type { Page } from "playwright";
import { checkPage, gotoAndCheck } from "../browser.js";
import { log } from "../logger.js";
import { instagram as S } from "../selectors/instagram.js";
import { rotate } from "../store.js";
import type { RawPost } from "../types.js";
import { absoluteUrl, eachSafe, pause, scroll } from "./common.js";
import type { SourceRunner } from "./types.js";

const guards = { site: S.site, ...S.guards };

export async function extractInstagramLinks(page: Page, max: number): Promise<string[]> {
  const hrefs = await page.locator(S.postLink).evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const urls = [...new Set(hrefs.map((h) => absoluteUrl(h, page.url())).filter(Boolean))];
  return urls.slice(0, max);
}

/** Чете една публикация: текст, автор, дата. Ползва meta таговете, ако няма видим текст. */
export async function extractInstagramPost(page: Page): Promise<{ text: string; author: string; postedAt: string }> {
  return page.evaluate((sel) => {
    const meta = (q: string) => document.querySelector(q)?.getAttribute("content") ?? "";
    const captionEl = document.querySelector(sel.caption) as HTMLElement | null;
    let text = (captionEl?.innerText ?? "").trim();
    let author = (document.querySelector(sel.author)?.textContent ?? "").trim();
    const desc = meta(sel.metaDescription);
    if (!text && desc) {
      // формат: "123 likes, 4 comments - user on May 1, 2026: \"текст\""
      const m = desc.match(/:\s*"([\s\S]*)"\s*\.?$/);
      text = (m?.[1] ?? desc).trim();
    }
    if (!author) {
      const m = desc.match(/-\s*([\w.]+)\s+on\s/) ?? meta(sel.metaTitle).match(/^(.+?)\s+on Instagram/);
      author = (m?.[1] ?? "").trim();
    }
    const postedAt = document.querySelector(sel.time)?.getAttribute("datetime") ?? "";
    return { text, author, postedAt };
  }, { caption: S.caption, author: S.author, time: S.time, metaDescription: S.metaDescription, metaTitle: S.metaTitle });
}

export const runInstagram: SourceRunner = async (ctx) => {
  const { cfg, browser } = ctx;
  if (!browser) throw new Error("няма браузър");
  const out: RawPost[] = [];
  const page = await browser.newPage();
  try {
    const n = Math.min(cfg.limits.maxSearchesPerSource, ctx.only?.searches ?? Infinity);
    const tags = rotate(cfg.sources.instagram.hashtags, n, ctx.state, "instagram.tags");
    await eachSafe(tags, (t) => `Instagram #${t}`, async (tag) => {
      if (ctx.budget.empty) return;
      await gotoAndCheck(page, S.tagUrl(tag), guards);
      await scroll(page, cfg, ctx.fast);
      const links = await extractInstagramLinks(page, ctx.budget.take(cfg.sources.instagram.maxPostsPerTag));
      log.info(`Instagram #${tag}: ${links.length} публикации`);
      for (const link of links) {
        await pause(cfg, ctx.fast);
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(1500);
        await checkPage(page, guards);
        const p = await extractInstagramPost(page);
        if (!p.text) continue;
        const market = /\p{Script=Cyrillic}/u.test(tag) ? cfg.markets.find((m) => m.language === "bg")?.id : undefined;
        out.push({
          source: "instagram",
          sourceDetail: `#${tag.replace(/^#/, "")}`,
          url: link,
          text: p.text,
          author: p.author || undefined,
          postedAt: p.postedAt || undefined,
          marketHint: market,
        });
      }
      await pause(cfg, ctx.fast);
    });
  } finally {
    await page.close().catch(() => undefined);
  }
  return out;
};
