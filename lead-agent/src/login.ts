import "dotenv/config";
import { openContext } from "./browser.js";
import { loadConfig, resolveFromRoot } from "./config.js";

/**
 * Ръчен вход. Отваря видим браузър с постоянния профил и три раздела.
 * Влизате сами (с 2FA), после затваряте прозореца. Агентът не вижда и не пази паролата:
 * в профила остават само бисквитките на сесията, както в обикновен браузър.
 */
const cfg = loadConfig();
const ctx = await openContext(cfg, { headless: false });
const sites = [
  "https://www.facebook.com/login",
  "https://www.instagram.com/accounts/login/",
  "https://www.linkedin.com/login",
];
const first = ctx.pages()[0] ?? (await ctx.newPage());
await first.goto(sites[0]!).catch(() => undefined);
for (const url of sites.slice(1)) {
  const p = await ctx.newPage();
  await p.goto(url).catch(() => undefined);
}
console.log(`
Профил на браузъра: ${resolveFromRoot(cfg.browser.profileDir)}

1. Влезте във Facebook, Instagram и LinkedIn в отворените раздели (с 2FA, ако се иска).
2. Когато сте готови, затворете целия прозорец на браузъра.
Сесиите остават запазени. Агентът не вижда паролите ви.
`);
await new Promise<void>((resolve) => ctx.on("close", () => resolve()));
console.log("Прозорецът е затворен. Входът е запазен. Следва: npm run check или npm run start");
