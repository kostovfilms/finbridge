import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { ROOT, loadConfig, resolveFromRoot } from "../src/config.js";
import { loadLeads, sortNewestFirst } from "../src/store.js";

/** Локално табло: само за този компютър (127.0.0.1), само четене. */
export function createApp(outDir: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  });
  app.get("/api/leads", (_req, res) => {
    const leads = sortNewestFirst(loadLeads(outDir)).map(({ dedupeText: _d, ...rest }) => rest);
    res.json(leads);
  });
  app.get("/api/status", (_req, res) => {
    const file = path.join(outDir, "last-run.json");
    res.json(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
  });
  app.get("/download/:file", (req, res) => {
    const name = req.params.file;
    if (name !== "leads.csv" && name !== "leads.xlsx") return void res.status(404).end();
    const file = path.join(outDir, name);
    if (!existsSync(file)) return void res.status(404).send("Още няма файл. Пуснете npm run start.");
    res.download(file);
  });
  app.use(express.static(path.join(ROOT, "dashboard", "public")));
  return app;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // ако няма как да се отвори, адресът е в конзолата
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cfg = loadConfig();
  const port = Number(process.env.DASHBOARD_PORT ?? 3000);
  const app = createApp(resolveFromRoot(cfg.output.dir));
  app.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(`Таблото работи на ${url} (Ctrl+C за спиране)`);
    if (!process.argv.includes("--no-open")) openBrowser(url);
  });
}
