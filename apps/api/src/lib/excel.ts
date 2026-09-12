import ExcelJS from "exceljs";
import type { Response } from "express";

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Streams a single-sheet workbook straight to the response. Replaces the old
 * `xlsx.writeFile` to the server filesystem followed by `res.download`, which
 * raced between concurrent users and leaked files into apps/api/.
 *
 * Cells that start with =, +, -, or @ are prefixed with an apostrophe so a
 * memo like "=HYPERLINK(...)" cannot execute when the export is opened
 * (CSV/formula injection; CEO review Section 3).
 */
export async function sendWorkbook(
  res: Response,
  filename: string,
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  for (const row of rows) {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      safe[key] = typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
    }
    sheet.addRow(safe);
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}
