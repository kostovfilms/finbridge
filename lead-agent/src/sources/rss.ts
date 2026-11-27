import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  link: string;
  text: string;
  author: string;
  date: string;
}

const UA = "Mozilla/5.0 (compatible; lead-agent/1.0; local reader)";

export async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, text/xml, text/html;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 429) throw new Error(`достъпът е отказан (HTTP ${res.status}); пропуснато`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o["#text"] ?? o["@_href"] ?? o.name ?? "");
  }
  return "";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Чете RSS 2.0, Atom и RSS 1.0. */
export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const get = (o: unknown, p: string): unknown =>
    p.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
  let items: unknown = get(doc, "rss.channel.item") ?? get(doc, "feed.entry") ?? get(doc, "rdf:RDF.item");
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];
  return (items as Record<string, unknown>[]).map((it) => {
    let link: string;
    const l = it.link;
    if (Array.isArray(l)) {
      const alt = (l as Record<string, unknown>[]).find((x) => !x["@_rel"] || x["@_rel"] === "alternate");
      link = str(alt?.["@_href"] ?? l[0]);
    } else link = str(l);
    const title = stripHtml(str(it.title));
    const body = stripHtml(str(it["content:encoded"] ?? it.content ?? it.description ?? it.summary ?? ""));
    return {
      title,
      link: link.trim(),
      text: body.startsWith(title) ? body : [title, body].filter(Boolean).join("\n"),
      author: stripHtml(str(it.author ?? it["dc:creator"] ?? "")),
      date: str(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"] ?? ""),
    };
  });
}
