import type { NormalizedTable, RawSheetGrid, TableFileType } from "@/lib/session-types";

interface SheetJsLike {
  read(data: ArrayBuffer, options: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      options: { header: 1; blankrows: boolean; defval: string }
    ) => unknown[];
  };
}

declare global {
  interface Window {
    XLSX?: SheetJsLike;
  }
}

const SHEETJS_CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

const toCellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value);
};

const normalizeRows = (rows: unknown[][]): string[][] => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const padded = Array.from({ length: maxCols }, (_, idx) => toCellText(row[idx]));
    return padded;
  });
};

const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const createNormalizedTable = (rows: unknown[][], sheetName?: string): NormalizedTable => {
  const safeRows = normalizeRows(rows);
  const firstRow = safeRows[0] ?? [];
  const dataRows = safeRows.length > 1 ? safeRows.slice(1) : [];
  const columns = firstRow.map((value, idx) => value.trim() || `column_${idx + 1}`);

  return {
    sheetName,
    columns,
    rows: dataRows,
    rowCount: dataRows.length,
    columnCount: columns.length,
  };
};

const createRawSheetGrid = (rows: unknown[][], fileType: TableFileType, sheetName?: string): RawSheetGrid => {
  const safeRows = normalizeRows(rows);
  const rowCount = safeRows.length;
  const columnCount = safeRows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    fileType,
    sheetName,
    rows: safeRows,
    rowCount,
    columnCount,
  };
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
};

const parseCsv = (content: string): unknown[][] => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[] = [];
  let currentRow = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentRow += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        currentRow += char;
      }
      continue;
    }

    if (char === "\n" && !inQuotes) {
      rows.push(currentRow);
      currentRow = "";
      continue;
    }

    currentRow += char;
  }

  if (currentRow.length > 0 || normalized.endsWith("\n")) {
    rows.push(currentRow);
  }

  return rows.map((row) => parseCsvLine(row));
};

const loadSheetJs = async (): Promise<SheetJsLike> => {
  if (typeof window === "undefined") {
    throw new Error("XLSX parsing is only available in browser.");
  }

  if (window.XLSX) return window.XLSX;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_CDN;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("XLSX parser load failed."));
    document.head.appendChild(script);
  });

  if (!window.XLSX) {
    throw new Error("XLSX parser not available.");
  }

  return window.XLSX;
};

const parseXlsx = async (file: File): Promise<NormalizedTable> => {
  const xlsx = await loadSheetJs();
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[];
  const rows = matrix.filter(Array.isArray) as unknown[][];
  return createNormalizedTable(rows, sheetName);
};

const parseXlsxGridFromArrayBuffer = async (buffer: ArrayBuffer): Promise<RawSheetGrid> => {
  const xlsx = await loadSheetJs();
  const workbook = xlsx.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: "" }) as unknown[];
  const rows = matrix.filter(Array.isArray) as unknown[][];
  return createRawSheetGrid(rows, "xlsx", sheetName);
};

const parseCsvGrid = (content: string): RawSheetGrid => createRawSheetGrid(parseCsv(content), "csv");

export const getTableFileType = (fileName: string): TableFileType | null => {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".xlsx")) return "xlsx";
  return null;
};

export const parseTableFile = async (file: File): Promise<{ fileType: TableFileType; tableData: NormalizedTable }> => {
  const fileType = getTableFileType(file.name);
  if (!fileType) {
    throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
  }

  if (fileType === "csv") {
    const text = await file.text();
    const rows = parseCsv(text);
    return { fileType, tableData: createNormalizedTable(rows) };
  }

  return { fileType, tableData: await parseXlsx(file) };
};

export const parseRawGridFile = async (file: File): Promise<RawSheetGrid> => {
  const fileType = getTableFileType(file.name);
  if (!fileType) {
    throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
  }

  if (fileType === "csv") {
    return parseCsvGrid(await file.text());
  }

  return parseXlsxGridFromArrayBuffer(await file.arrayBuffer());
};

export const parseRawGridBase64 = async (base64: string, fileName: string): Promise<RawSheetGrid> => {
  const fileType = getTableFileType(fileName);
  if (!fileType) {
    throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
  }

  if (fileType === "csv") {
    return parseCsvGrid(new TextDecoder("utf-8").decode(decodeBase64(base64)));
  }

  const bytes = decodeBase64(base64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return parseXlsxGridFromArrayBuffer(buffer);
};

export const serializeRawGridForGemini = (grid: RawSheetGrid, options?: { maxRows?: number; maxCols?: number }): string => {
  const maxRows = options?.maxRows ?? 200;
  const maxCols = options?.maxCols ?? 40;
  const visibleRows = grid.rows.slice(0, maxRows).map((row, rowIndex) => {
    const cells = Array.from({ length: Math.min(grid.columnCount, maxCols) }, (_, columnIndex) => {
      const value = String(row[columnIndex] ?? "").replace(/\s+/g, " ").trim();
      return `C${columnIndex + 1}=${value || "∅"}`;
    });
    return `R${rowIndex + 1}: ${cells.join(" | ")}`;
  });

  return [
    `[GRID_META]`,
    `- fileType: ${grid.fileType}`,
    grid.sheetName ? `- sheetName: ${grid.sheetName}` : "",
    `- rowCount: ${grid.rowCount}`,
    `- columnCount: ${grid.columnCount}`,
    visibleRows.length < grid.rowCount ? `- truncatedRows: first ${visibleRows.length} of ${grid.rowCount}` : "",
    grid.columnCount > maxCols ? `- truncatedCols: first ${maxCols} of ${grid.columnCount}` : "",
    "",
    `[GRID_ROWS]`,
    ...visibleRows,
  ]
    .filter(Boolean)
    .join("\n");
};

export function sliceGridByRange(grid: string[][], range: { startRow: number; endRow: number; startCol: number; endCol: number }): string[][] {
  return grid
    .slice(range.startRow - 1, range.endRow)
    .map((row) => row.slice(range.startCol - 1, range.endCol));
}

export function formatSlicedGrid(
  slicedGrid: string[][],
  options?: { originalRange?: { startRow: number; endRow: number; startCol: number; endCol: number } }
): string {
  const header = options?.originalRange
    ? `[원본 범위] R${options.originalRange.startRow}-R${options.originalRange.endRow} / C${options.originalRange.startCol}-C${options.originalRange.endCol}`
    : "";

  const body = slicedGrid
    .map((row, rowIndex) =>
      `R${rowIndex + 1}: ${row.map((cell, columnIndex) => `C${columnIndex + 1}=${String(cell ?? "").replace(/\s+/g, " ").trim() || "∅"}`).join(" | ")}`
    )
    .join("\n");

  return [header, body].filter(Boolean).join("\n");
}
