import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

type Level = "INFO" | "WARN" | "ERROR";

let logDir = path.join(ROOT, "logs");
let silent = false;

export function setLogDir(dir: string): void {
  logDir = dir;
}

export function setSilent(value: boolean): void {
  silent = value;
}

function write(level: Level, message: string): void {
  const now = new Date();
  const line = `${now.toISOString()} [${level}] ${message}`;
  if (!silent) {
    if (level === "ERROR") console.error(line);
    else console.log(line);
  }
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(path.join(logDir, `${now.toISOString().slice(0, 10)}.log`), line + "\n", "utf8");
  } catch {
    // Логът не трябва да спира агента
  }
}

export const log = {
  info: (m: string) => write("INFO", m),
  warn: (m: string) => write("WARN", m),
  error: (m: string) => write("ERROR", m),
};
