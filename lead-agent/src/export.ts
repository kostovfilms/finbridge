import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Lead } from "./types.js";
import { sortNewestFirst } from "./store.js";

export const COLUMNS: { key: keyof Lead; header: string; width: number }[] = [
  { key: "postedAt", header: "Дата", width: 18 },
  { key: "source", header: "Източник", width: 11 },
  { key: "sourceDetail", header: "Група / търсене", width: 28 },
  { key: "market", header: "Пазар", width: 10 },
  { key: "niche", header: "Ниша", width: 22 },
  { key: "location", header: "Град / държава", width: 16 },
  { key: "summary", header: "Нужда", width: 70 },
  { key: "url", header: "Връзка", width: 50 },
  { key: "author", header: "Автор", width: 22 },
  { key: "collectedAt", header: "Събрано на", width: 18 },
  { key: "classifiedBy", header: "Класификация", width: 12 },
];

/** Клетка за CSV: кавички при нужда и защита от формули в Excel (=, +, -, @). */
export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cellValue(lead: Lead, key: keyof Lead): string {
  const v = lead[key];
  if (key === "postedAt" || key === "collectedAt") return formatDate(String(v ?? ""));
  return String(v ?? "");
}

export function toCsv(leads: readonly Lead[]): string {
  const rows = sortNewestFirst(leads).map((l) => COLUMNS.map((c) => csvCell(cellValue(l, c.key))).join(","));
  // BOM, за да отвори Excel кирилицата правилно
  return "﻿" + [COLUMNS.map((c) => csvCell(c.header)).join(","), ...rows].join("\r\n") + "\r\n";
}

export async function toXlsx(leads: readonly Lead[], file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "lead-agent";
  const ws = wb.addWorksheet("Заявки", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  for (const lead of sortNewestFirst(leads)) {
    const row: Record<string, string | { text: string; hyperlink: string }> = {};
    for (const c of COLUMNS) row[c.key] = cellValue(lead, c.key);
    row.url = { text: lead.url, hyperlink: lead.url };
    ws.addRow(row);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  ws.getColumn("summary").alignment = { wrapText: true, vertical: "top" };
  await wb.xlsx.writeFile(file);
}

export async function exportAll(leads: readonly Lead[], outDir: string): Promise<{ csv: string; xlsx: string }> {
  mkdirSync(outDir, { recursive: true });
  const csv = path.join(outDir, "leads.csv");
  const xlsx = path.join(outDir, "leads.xlsx");
  writeFileSync(csv, toCsv(leads), "utf8");
  await toXlsx(leads, xlsx);
  return { csv, xlsx };
}
