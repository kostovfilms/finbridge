import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Lead } from "./types.js";

/** Локално хранилище: output/leads.json е източникът на истината; CSV/XLSX се правят от него. */
export function leadsFile(outDir: string): string {
  return path.join(outDir, "leads.json");
}

export function loadLeads(outDir: string): Lead[] {
  const file = leadsFile(outDir);
  if (!existsSync(file)) return [];
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data) ? (data as Lead[]) : [];
  } catch {
    // развален файл: пазим копие и започваме отначало
    renameSync(file, file + `.broken-${Date.now()}`);
    return [];
  }
}

export function saveLeads(outDir: string, leads: readonly Lead[]): void {
  mkdirSync(outDir, { recursive: true });
  const file = leadsFile(outDir);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(leads, null, 2), "utf8");
  renameSync(tmp, file);
}

/** Маха записи, по-стари от retentionDays (по дата на събиране). */
export function applyRetention(leads: readonly Lead[], retentionDays: number, now = new Date()): Lead[] {
  const cutoff = now.getTime() - retentionDays * 24 * 3600 * 1000;
  return leads.filter((l) => {
    const t = Date.parse(l.collectedAt);
    return Number.isNaN(t) || t >= cutoff;
  });
}

/** Най-новите отгоре: по дата на публикацията, после по дата на събиране. */
export function sortNewestFirst(leads: readonly Lead[]): Lead[] {
  const key = (l: Lead) => Date.parse(l.postedAt) || Date.parse(l.collectedAt) || 0;
  return [...leads].sort((a, b) => key(b) - key(a) || Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
}

/** Малко състояние между пусканията (докъде са стигнали заявките, последно известие). */
export interface AgentState {
  cursors: Record<string, number>;
  lastNotification?: string;
  lastRun?: string;
}

export function loadState(outDir: string): AgentState {
  const file = path.join(outDir, "state.json");
  try {
    return { cursors: {}, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<AgentState>) };
  } catch {
    return { cursors: {} };
  }
}

export function saveState(outDir: string, state: AgentState): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

/** Взима следващите n елемента от списъка, като продължава оттам, където е спряло. */
export function rotate<T>(items: readonly T[], n: number, state: AgentState, key: string): T[] {
  if (items.length === 0 || n <= 0) return [];
  const start = (state.cursors[key] ?? 0) % items.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(n, items.length); i++) out.push(items[(start + i) % items.length] as T);
  state.cursors[key] = (start + out.length) % items.length;
  return out;
}
