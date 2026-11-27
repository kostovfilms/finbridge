import type { Config, Market } from "./config.js";
import { cyrillicRatio, findPhrases, type PhraseMatch } from "./util/text.js";

export interface IntentResult {
  /** Човекът търси услугата */
  seeker: boolean;
  /** Индекс на първата фраза „търся…“ (за резюмето) */
  seekerIndex?: number;
  seekerPhrase?: string;
  offerPhrase?: string;
}

/**
 * Търсещ или предлагащ? Фраза за търсене, която е част от фраза за предлагане
 * („търся работа“, „looking for clients“), не се брои. Ако има и двете,
 * решава коя е по-рано в текста.
 */
export function detectIntent(text: string, seekerPhrases: readonly string[], offerPhrases: readonly string[]): IntentResult {
  const offers = findPhrases(text, offerPhrases);
  const seekers = findPhrases(text, seekerPhrases).filter(
    (s) => !offers.some((o) => s.index >= o.index && s.index < o.end),
  );
  const firstSeeker = seekers[0];
  const firstOffer = offers[0];
  if (!firstSeeker) return { seeker: false, offerPhrase: firstOffer?.phrase };
  if (firstOffer && firstOffer.index < firstSeeker.index) {
    return { seeker: false, offerPhrase: firstOffer.phrase, seekerPhrase: firstSeeker.phrase };
  }
  return { seeker: true, seekerIndex: firstSeeker.index, seekerPhrase: firstSeeker.phrase, offerPhrase: firstOffer?.phrase };
}

export interface NicheMatch {
  market: Market;
  niche: string;
  keyword: string;
  index: number;
}

/**
 * Намира пазар и ниша по ключовите думи. Нишите се проверяват в реда от config.yaml,
 * така че по-конкретните (по-горе) печелят пред общите. При съвпадение в два пазара
 * решава подсказката от източника, после азбуката на текста.
 */
export function detectNiche(text: string, markets: readonly Market[], marketHint?: string): NicheMatch | undefined {
  const candidates: NicheMatch[] = [];
  for (const market of markets) {
    for (const [niche, keywords] of Object.entries(market.niches)) {
      const m: PhraseMatch | undefined = findPhrases(text, keywords)[0];
      if (m) {
        candidates.push({ market, niche, keyword: m.phrase, index: m.index });
        break; // първата (най-конкретна) ниша за този пазар
      }
    }
  }
  if (candidates.length <= 1) return candidates[0];
  const isCyr = cyrillicRatio(text) > 0.3;
  const byLang = candidates.find((c) => (isCyr ? c.market.language === "bg" : c.market.language !== "bg"));
  const byHint = candidates.find((c) => c.market.id === marketHint);
  return byLang ?? byHint ?? candidates[0];
}

export function detectLocation(text: string, cfg: Config, market: Market): string {
  const list = cfg.locations[market.id] ?? [];
  const found = findPhrases(text, list, { wholeWord: true })[0];
  return found ? found.phrase : market.country;
}

export interface KeywordAnalysis {
  isLead: boolean;
  reason: string;
  intent: IntentResult;
  niche?: NicheMatch;
}

/** Пълна проверка по ключови думи: търсещ + поне една ключова дума от нишите. */
export function analyzeByKeywords(text: string, cfg: Config, marketHint?: string): KeywordAnalysis {
  const intent = detectIntent(text, cfg.seekerPhrases, cfg.offerPhrases);
  const niche = detectNiche(text, cfg.markets, marketHint);
  if (!intent.seeker) {
    return { isLead: false, reason: intent.offerPhrase ? `предлага („${intent.offerPhrase}“)` : "няма фраза за търсене", intent, niche };
  }
  if (!niche) return { isLead: false, reason: "няма ключова дума за услугата", intent };
  return { isLead: true, reason: `търси („${intent.seekerPhrase}“), ниша ${niche.niche}`, intent, niche };
}
