import type { Lead } from "./types.js";
import { tokens } from "./util/text.js";

const TRACKING_PARAM = /^(utm_.*|__.*|fbclid|gclid|igsh|igshid|mibextid|rdid|ref|refid|ref_src|ref_url|trk|trackingid|lipi|sk|notif_id|notif_t|comment_id|reply_comment_id|acontext|hoisted_section_header_type|paipv|eav|_rdr|share_url)$/i;

/** Нормализира адрес: без www/m., без следящи параметри, без # и наклонена черта накрая. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  url.hash = "";
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile|mbasic|web)\./, "");
  const keep = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of keep) url.searchParams.append(k, v);
  let s = url.toString();
  s = s.replace(/\/(\?|$)/, "$1");
  return s;
}

/** Сходство на два текста (Jaccard по думи), 0..1. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface DedupeResult {
  unique: Lead[];
  duplicates: number;
}

/**
 * Маха дубликати спрямо вече събраните и вътре в новите: еднакъв адрес
 * или текст със сходство >= threshold. Кратките текстове (под 5 думи)
 * се сравняват само по адрес, за да не се слепят различни заявки.
 */
export function dedupe(incoming: readonly Lead[], existing: readonly Lead[], threshold: number): DedupeResult {
  const seenUrls = new Set(existing.map((l) => normalizeUrl(l.url)));
  const kept: Lead[] = [];
  const compareWith: Lead[] = [...existing];
  let duplicates = 0;
  for (const lead of incoming) {
    const url = normalizeUrl(lead.url);
    if (seenUrls.has(url)) {
      duplicates++;
      continue;
    }
    const long = tokens(lead.dedupeText).length >= 5;
    if (long && compareWith.some((o) => similarity(o.dedupeText, lead.dedupeText) >= threshold)) {
      duplicates++;
      continue;
    }
    seenUrls.add(url);
    kept.push(lead);
    compareWith.push(lead);
  }
  return { unique: kept, duplicates };
}
