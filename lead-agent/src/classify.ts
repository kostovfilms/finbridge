import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Config } from "./config.js";
import { analyzeByKeywords, detectLocation } from "./filter.js";
import { log } from "./logger.js";
import type { Lead, RawPost } from "./types.js";
import { normalizeSpace, redactContacts, summarize } from "./util/text.js";

export interface LlmInput {
  index: number;
  text: string;
  marketHint?: string;
}

const llmItemSchema = z.object({
  index: z.number().int(),
  is_request: z.boolean(),
  market: z.string(),
  niche: z.string(),
  location: z.string(),
  summary: z.string(),
});
const llmResultSchema = z.object({ items: z.array(llmItemSchema) });
export type LlmItem = z.infer<typeof llmItemSchema>;

/** Функция, която класифицира партида текстове. В тестовете се подменя. */
export type LlmClassifier = (batch: LlmInput[]) => Promise<LlmItem[]>;

function leadId(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function prepareText(text: string, cfg: Config): string {
  const t = normalizeSpace(text);
  return cfg.privacy.keepContactsFromPost ? t : redactContacts(t);
}

function baseLead(post: RawPost, cfg: Config, now: Date): Omit<Lead, "market" | "niche" | "location" | "summary" | "classifiedBy"> {
  return {
    id: leadId(post.url),
    postedAt: post.postedAt ?? "",
    collectedAt: now.toISOString(),
    source: post.source,
    sourceDetail: post.sourceDetail,
    url: post.url,
    author: post.author ? normalizeSpace(post.author).slice(0, 80) : "",
    dedupeText: redactContacts(normalizeSpace(post.text)).slice(0, 600),
  };
}

/** Класификация само по ключови думи (без мрежа). */
export function classifyByKeywords(posts: readonly RawPost[], cfg: Config, now = new Date()): Lead[] {
  const out: Lead[] = [];
  for (const post of posts) {
    const text = prepareText(post.text, cfg);
    const a = analyzeByKeywords(text, cfg, post.marketHint);
    if (!a.isLead || !a.niche) continue;
    out.push({
      ...baseLead(post, cfg, now),
      market: a.niche.market.id,
      niche: a.niche.niche,
      location: detectLocation(text, cfg, a.niche.market),
      summary: summarize(text, a.intent.seekerIndex),
      classifiedBy: "keywords",
    });
  }
  return out;
}

function systemPrompt(cfg: Config): string {
  const markets = cfg.markets
    .map((m) => `- ${m.id} (${m.name}, ${m.country}): ниши: ${Object.keys(m.niches).join("; ")}`)
    .join("\n");
  return [
    "Класифицираш публикации от социални мрежи и форуми за видео продуцентски агенции.",
    "За всяка публикация реши дали авторът ТЪРСИ да наеме някого за видео, снимане, 3D анимация, CGI или рендери (is_request=true),",
    "или ПРЕДЛАГА такива услуги, търси работа, рекламира се, или темата е друга (is_request=false).",
    "Пазари и ниши:",
    markets,
    "Полета: market е id на пазара; niche е една от изброените ниши за този пазар (или \"Друго\");",
    "location е град или държава, ако личи от текста, иначе държавата на пазара;",
    "summary е 1–2 кратки изречения на езика на публикацията: какво точно търси човекът. Без телефони, имейли и имена.",
    "Върни по един елемент за всяка публикация, със същия index.",
  ].join("\n");
}

/** Класификатор чрез Claude API. Ключът се чете от ANTHROPIC_API_KEY. */
export function anthropicClassifier(cfg: Config, client = new Anthropic()): LlmClassifier {
  return async (batch) => {
    const body = batch.map((b) => `<post index="${b.index}" hint="${b.marketHint ?? ""}">\n${b.text.slice(0, 2500)}\n</post>`).join("\n");
    const response = await client.messages.parse({
      model: cfg.llm.model,
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(llmResultSchema) },
      system: systemPrompt(cfg),
      messages: [{ role: "user", content: body }],
    });
    if (response.stop_reason === "refusal") throw new Error("моделът отказа партидата");
    if (!response.parsed_output) throw new Error(`неочакван отговор (stop_reason=${response.stop_reason})`);
    return response.parsed_output.items;
  };
}

/**
 * Класифицира публикациите. С ключ и llm.enabled праща на Claude само
 * публикациите, в които има ключова дума за услугата или фраза за търсене.
 * При грешка в партида тя се класифицира по ключови думи и работата продължава.
 */
export async function classifyPosts(
  posts: readonly RawPost[],
  cfg: Config,
  opts: { classifier?: LlmClassifier; apiKey?: string; now?: Date } = {},
): Promise<Lead[]> {
  const now = opts.now ?? new Date();
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const classifier = opts.classifier ?? (cfg.llm.enabled && apiKey ? anthropicClassifier(cfg) : undefined);
  if (!classifier) return classifyByKeywords(posts, cfg, now);

  const candidates = posts.filter((p) => {
    const a = analyzeByKeywords(prepareText(p.text, cfg), cfg, p.marketHint);
    return a.niche !== undefined || a.intent.seeker;
  });
  const out: Lead[] = [];
  const marketIds = new Set(cfg.markets.map((m) => m.id));
  for (let i = 0; i < candidates.length; i += cfg.llm.batchSize) {
    const chunk = candidates.slice(i, i + cfg.llm.batchSize);
    const inputs = chunk.map((p, j) => ({ index: j, text: prepareText(p.text, cfg), marketHint: p.marketHint }));
    let items: LlmItem[];
    try {
      items = await classifier(inputs);
    } catch (e) {
      log.warn(`Класификация с Claude не успя (${(e as Error).message}); тази партида е по ключови думи`);
      out.push(...classifyByKeywords(chunk, cfg, now));
      continue;
    }
    for (const item of items) {
      const post = chunk[item.index];
      if (!post || !item.is_request) continue;
      const market = marketIds.has(item.market) ? item.market : (post.marketHint ?? cfg.markets[0]!.id);
      const summary = cfg.privacy.keepContactsFromPost ? item.summary : redactContacts(item.summary);
      out.push({
        ...baseLead(post, cfg, now),
        market,
        niche: item.niche || "Друго",
        location: item.location,
        summary: normalizeSpace(summary).slice(0, 400),
        classifiedBy: "llm",
      });
    }
  }
  return out;
}
