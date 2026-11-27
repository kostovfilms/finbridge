import "dotenv/config";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { cronEveryHours, inWorkHours } from "./hours.js";
import { log } from "./logger.js";
import { runOnce } from "./run.js";

/** Работи на фона: пуска агента на всеки N часа, само в работните часове. */
async function tick(): Promise<void> {
  const cfg = loadConfig(); // чете наново: промените в config.yaml важат от следващото пускане
  const { start, end } = cfg.schedule.workHours;
  if (!inWorkHours(new Date(), start, end)) {
    log.info(`Извън работните часове (${start}–${end}); пропускам`);
    return;
  }
  try {
    await runOnce({ cfg });
  } catch (e) {
    log.error(`Пускането спря: ${(e as Error).message}`);
  }
}

const cfg = loadConfig();
const expr = cronEveryHours(cfg.schedule.everyHours);
log.info(`График: на всеки ${cfg.schedule.everyHours} ч (${expr}), работни часове ${cfg.schedule.workHours.start}–${cfg.schedule.workHours.end}. Спиране: Ctrl+C`);
cron.schedule(expr, () => void tick(), { noOverlap: true });
void tick();
