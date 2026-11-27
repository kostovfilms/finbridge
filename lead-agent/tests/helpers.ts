import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type Config } from "../src/config.js";
import { setSilent } from "../src/logger.js";
import type { Lead } from "../src/types.js";

setSilent(true);

export function testConfig(): Config {
  const cfg = loadConfig();
  cfg.output.dir = mkdtempSync(path.join(os.tmpdir(), "lead-agent-"));
  cfg.llm.enabled = false;
  return cfg;
}

export function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "x",
    postedAt: "2026-11-20T10:00:00.000Z",
    collectedAt: "2026-11-20T12:00:00.000Z",
    source: "facebook",
    sourceDetail: "група",
    market: "bg",
    niche: "Музикален клип",
    location: "София",
    summary: "Търсим екип за музикален клип.",
    url: "https://www.facebook.com/groups/1/posts/2/",
    author: "Иван",
    classifiedBy: "keywords",
    dedupeText: "Търсим екип за музикален клип в София през декември, бюджет по договаряне",
    ...over,
  };
}
