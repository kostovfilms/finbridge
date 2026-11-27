import notifier from "node-notifier";
import { log } from "./logger.js";
import type { AgentState } from "./store.js";
import type { Lead } from "./types.js";

/** Текстът на дневното резюме. */
export function dailySummaryText(leads: readonly Lead[], now = new Date()): string {
  const since = now.getTime() - 24 * 3600 * 1000;
  const recent = leads.filter((l) => Date.parse(l.collectedAt) >= since);
  if (recent.length === 0) return "Няма нови заявки за последните 24 часа.";
  const byMarket = new Map<string, number>();
  for (const l of recent) byMarket.set(l.market, (byMarket.get(l.market) ?? 0) + 1);
  const parts = [...byMarket.entries()].map(([m, n]) => `${m.toUpperCase()}: ${n}`).join(", ");
  return `${recent.length} нови заявки за 24 ч (${parts}). Отворете таблото: npm run dashboard`;
}

/** Показва известие веднъж на ден, само ако е включено в config.yaml. */
export function maybeNotify(enabled: boolean, leads: readonly Lead[], state: AgentState, now = new Date()): void {
  if (!enabled) return;
  const today = now.toISOString().slice(0, 10);
  if (state.lastNotification === today) return;
  try {
    notifier.notify({ title: "Lead agent", message: dailySummaryText(leads, now) });
    state.lastNotification = today;
  } catch (e) {
    log.warn(`Известието не се показа: ${(e as Error).message}`);
  }
}
