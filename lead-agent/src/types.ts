export type SourceName = "facebook" | "linkedin" | "instagram" | "upwork" | "forums";

/** Публикация, както е прочетена от източника, преди обработка. */
export interface RawPost {
  source: SourceName;
  /** Група, заявка, хаштаг или име на форума */
  sourceDetail: string;
  url: string;
  text: string;
  /** Само ако е публично видимо на страницата */
  author?: string;
  /** ISO дата, ако страницата я показва */
  postedAt?: string;
  /** Пазарът на заявката, с която е намерена */
  marketHint?: string;
}

export interface Lead {
  id: string;
  postedAt: string;
  collectedAt: string;
  source: SourceName;
  sourceDetail: string;
  market: string;
  niche: string;
  location: string;
  summary: string;
  url: string;
  author: string;
  classifiedBy: "llm" | "keywords";
  /** Нормализиран текст (без контакти) само за махане на дубликати; не се експортира */
  dedupeText: string;
}
