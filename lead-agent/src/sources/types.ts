import type { BrowserContext } from "playwright";
import type { Config } from "../config.js";
import type { AgentState } from "../store.js";
import type { RawPost } from "../types.js";

/** Общ брояч за лимита „публикации на пускане“. */
export class Budget {
  constructor(public remaining: number) {}
  get empty(): boolean {
    return this.remaining <= 0;
  }
  /** Взима до n и връща колко са разрешени. */
  take(n: number): number {
    const ok = Math.max(0, Math.min(n, this.remaining));
    this.remaining -= ok;
    return ok;
  }
}

export interface SourceContext {
  cfg: Config;
  state: AgentState;
  budget: Budget;
  /** Само за източниците с вход; публичните го нямат */
  browser?: BrowserContext;
  /** За тестове: без паузи */
  fast?: boolean;
  /** За ръчна проверка: ограничава броя групи/търсения */
  only?: { groups?: number; searches?: number };
}

export type SourceRunner = (ctx: SourceContext) => Promise<RawPost[]>;
