import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const marketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  language: z.string().min(2),
  country: z.string().min(1),
  searchQueries: z.array(z.string()).default([]),
  niches: z.record(z.string(), z.array(z.string()).min(1)),
});

const feedSchema = z.object({
  name: z.string(),
  market: z.string(),
  type: z.enum(["rss", "html"]),
  url: z.string().url(),
  itemSelector: z.string().optional(),
  linkSelector: z.string().optional(),
  textSelector: z.string().optional(),
});

const timeRe = /^\d{1,2}:\d{2}$/;

export const configSchema = z.object({
  markets: z.array(marketSchema).min(1),
  seekerPhrases: z.array(z.string()).min(1),
  offerPhrases: z.array(z.string()).default([]),
  locations: z.record(z.string(), z.array(z.string())).default({}),
  sources: z.object({
    facebook: z
      .object({
        enabled: z.boolean().default(true),
        groups: z.array(z.string().url()).nullable().default([]).transform((v) => v ?? []),
        search: z.boolean().default(true),
      })
      .default({ enabled: true, groups: [], search: true }),
    linkedin: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    instagram: z
      .object({
        enabled: z.boolean().default(true),
        hashtags: z.array(z.string()).default([]),
        maxPostsPerTag: z.number().int().min(1).max(50).default(9),
      })
      .default({ enabled: true, hashtags: [], maxPostsPerTag: 9 }),
    upwork: z
      .object({ enabled: z.boolean().default(true), feeds: z.array(z.string().url()).nullable().default([]).transform((v) => v ?? []) })
      .default({ enabled: true, feeds: [] }),
    forums: z
      .object({ enabled: z.boolean().default(true), feeds: z.array(feedSchema).nullable().default([]).transform((v) => v ?? []) })
      .default({ enabled: true, feeds: [] }),
  }),
  limits: z
    .object({
      maxGroups: z.number().int().min(0).default(30),
      maxPostsPerRun: z.number().int().min(1).default(200),
      maxSearchesPerSource: z.number().int().min(0).default(4),
      minDelaySec: z.number().min(0).default(5),
      maxDelaySec: z.number().min(0).default(20),
      scrollRounds: z.number().int().min(0).default(6),
    })
    .refine((l) => l.maxDelaySec >= l.minDelaySec, "maxDelaySec трябва да е >= minDelaySec"),
  schedule: z
    .object({
      everyHours: z.number().int().min(1).max(24).default(6),
      workHours: z
        .object({ start: z.string().regex(timeRe), end: z.string().regex(timeRe) })
        .default({ start: "09:00", end: "21:00" }),
    })
    .default({ everyHours: 6, workHours: { start: "09:00", end: "21:00" } }),
  browser: z
    .object({
      profileDir: z.string().default("./browser-profile"),
      headless: z.boolean().default(false),
      executablePath: z.string().default(""),
    })
    .default({ profileDir: "./browser-profile", headless: false, executablePath: "" }),
  llm: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default("claude-opus-5-5"),
      batchSize: z.number().int().min(1).max(50).default(15),
    })
    .default({ enabled: true, model: "claude-opus-5-5", batchSize: 15 }),
  privacy: z
    .object({
      retentionDays: z.number().int().min(1).default(90),
      keepContactsFromPost: z.boolean().default(false),
    })
    .default({ retentionDays: 90, keepContactsFromPost: false }),
  dedupe: z.object({ similarity: z.number().min(0).max(1).default(0.8) }).default({ similarity: 0.8 }),
  notifications: z.object({ dailySummary: z.boolean().default(false) }).default({ dailySummary: false }),
  output: z.object({ dir: z.string().default("./output") }).default({ dir: "./output" }),
});

export type Config = z.infer<typeof configSchema>;
export type Market = Config["markets"][number];
export type FeedConfig = z.infer<typeof feedSchema>;

/** Коренът на проекта (папката lead-agent). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseConfig(yamlText: string): Config {
  const data: unknown = parse(yamlText);
  const result = configSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Грешка в config.yaml:\n${issues}`);
  }
  return result.data;
}

export function loadConfig(file = path.join(ROOT, "config.yaml")): Config {
  return parseConfig(readFileSync(file, "utf8"));
}

/** Път спрямо папката на проекта. */
export function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
