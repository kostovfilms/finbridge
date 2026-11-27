import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvCell, exportAll, toCsv } from "../src/export.js";
import { lead, testConfig } from "./helpers.js";

describe("CSV", () => {
  it("кавички, нови редове и защита от формули", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("ред1\nред2")).toBe('"ред1\nред2"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+359")).toBe("'+359");
    expect(csvCell("обикновен")).toBe("обикновен");
  });

  it("BOM, заглавен ред, най-новите отгоре, без вътрешния текст за дубликати", () => {
    const csv = toCsv([
      lead({ url: "https://a/old", postedAt: "2026-01-01T00:00:00Z" }),
      lead({ url: "https://a/new", postedAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(csv.startsWith("﻿Дата,")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("https://a/new");
    expect(lines[2]).toContain("https://a/old");
    expect(csv).not.toContain("бюджет по договаряне");
  });
});

describe("XLSX", () => {
  it("записва лист с редовете, най-новите отгоре, с връзка", async () => {
    const dir = testConfig().output.dir;
    const { xlsx, csv } = await exportAll(
      [lead({ url: "https://a/1", postedAt: "2026-02-01T00:00:00Z" }), lead({ url: "https://a/2", postedAt: "2026-03-01T00:00:00Z", summary: "=1+1" })],
      dir,
    );
    expect(readFileSync(csv, "utf8")).toContain("https://a/2");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx);
    const ws = wb.getWorksheet("Заявки")!;
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(1).getCell(1).value).toBe("Дата");
    const urlCell = ws.getRow(2).getCell(8).value as { hyperlink: string };
    expect(urlCell.hyperlink).toBe("https://a/2");
    // в Excel текстът остава текст, не формула
    expect(typeof ws.getRow(2).getCell(7).value).toBe("string");
    expect(path.basename(xlsx)).toBe("leads.xlsx");
  });
});
