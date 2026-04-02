import type { LogicalTable, LogicalTableHeaderAxis, LogicalTableOrientation } from "@/lib/session-types";

export type TableSourceType = "csv" | "xlsx";

export interface TableData {
  columns: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  sourceType?: TableSourceType;
  sheetName?: string;
  normalizationNotes?: string[];
  logicalTables?: LogicalTable[];
  primaryLogicalTableId?: string;
}

interface ParseTableOptions {
  apiKey?: string;
}

interface GeminiTableRangeProposal {
  id?: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  headerAxis?: LogicalTableHeaderAxis;
  orientation?: LogicalTableOrientation;
  confidence?: number;
  title?: string;
  reason?: string;
}

const GEMINI_TABLE_RANGE_MODEL = "gemini-2.5-flash";

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function getDefaultHeader(index: number): string {
  return `Column ${index + 1}`;
}

function normalizeHeader(header: string, index: number, seen: Map<string, number>): string {
  const base = header.trim() || getDefaultHeader(index);
  const currentCount = seen.get(base) ?? 0;
  seen.set(base, currentCount + 1);
  return currentCount === 0 ? base : `${base} ${currentCount + 1}`;
}

function trimCell(value: string): string {
  return value.replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

function compactRows(rows: string[][]): string[][] {
  return rows
    .map((row) => row.map((cell) => trimCell(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
}

function padRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => {
    const value = row[index];
    return typeof value === "string" ? value : "";
  });
}

function transposeRows(rows: string[][]): string[][] {
  const rowCount = rows.length;
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, columnIndex) =>
    Array.from({ length: rowCount }, (_, rowIndex) => rows[rowIndex]?.[columnIndex] ?? "")
  );
}

function isRowBlank(row: string[]): boolean {
  return row.every((cell) => trimCell(cell).length === 0);
}

function isColumnBlank(rows: string[][], columnIndex: number): boolean {
  return rows.every((row) => trimCell(row[columnIndex] ?? "").length === 0);
}

function trimEmptyBorders(rows: string[][]): { rows: string[][]; startRowOffset: number; startColOffset: number } {
  let top = 0;
  let bottom = rows.length - 1;

  while (top <= bottom && isRowBlank(rows[top] ?? [])) top += 1;
  while (bottom >= top && isRowBlank(rows[bottom] ?? [])) bottom -= 1;

  if (top > bottom) {
    return { rows: [], startRowOffset: 0, startColOffset: 0 };
  }

  const slicedRows = rows.slice(top, bottom + 1);
  const width = Math.max(0, ...slicedRows.map((row) => row.length));
  let left = 0;
  let right = width - 1;

  while (left <= right && isColumnBlank(slicedRows, left)) left += 1;
  while (right >= left && isColumnBlank(slicedRows, right)) right -= 1;

  if (left > right) {
    return { rows: [], startRowOffset: 0, startColOffset: 0 };
  }

  return {
    rows: slicedRows.map((row) => row.slice(left, right + 1)),
    startRowOffset: top,
    startColOffset: left,
  };
}

function splitRowBands(rows: string[][]): Array<{ start: number; end: number }> {
  const bands: Array<{ start: number; end: number }> = [];
  let start = -1;

  rows.forEach((row, index) => {
    if (isRowBlank(row)) {
      if (start >= 0) {
        bands.push({ start, end: index - 1 });
        start = -1;
      }
      return;
    }

    if (start < 0) start = index;
  });

  if (start >= 0) {
    bands.push({ start, end: rows.length - 1 });
  }

  return bands;
}

function splitColumnBands(rows: string[][]): Array<{ start: number; end: number }> {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const bands: Array<{ start: number; end: number }> = [];
  let start = -1;

  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    if (isColumnBlank(rows, columnIndex)) {
      if (start >= 0) {
        bands.push({ start, end: columnIndex - 1 });
        start = -1;
      }
      continue;
    }

    if (start < 0) start = columnIndex;
  }

  if (start >= 0) {
    bands.push({ start, end: width - 1 });
  }

  return bands;
}

function normalizeTable(rawRows: string[][], sourceType: TableSourceType, sheetName?: string): TableData {
  const cleanedRows = compactRows(rawRows);
  const headerSource = cleanedRows[0] ?? [];
  const dataRows = cleanedRows.slice(1);
  const columnCount = Math.max(headerSource.length, ...dataRows.map((row) => row.length), 1);
  const seenHeaders = new Map<string, number>();

  const headers = Array.from({ length: columnCount }, (_, index) =>
    normalizeHeader(headerSource[index] ?? "", index, seenHeaders)
  );

  const normalizedRows = dataRows.map((row) => padRow(row, columnCount));
  const normalizationNotes = [
    "첫 번째 비어있지 않은 행을 헤더로 사용했습니다.",
    "셀 값의 앞뒤 공백과 중복 공백을 정리했습니다.",
    "미리보기는 상위 40개 행만 표시합니다.",
  ];

  if (sourceType === "xlsx" && sheetName) {
    normalizationNotes.unshift(`첫 번째 시트 \"${sheetName}\" 기준으로 정규화했습니다.`);
  }

  return {
    columns: headers,
    rows: normalizedRows,
    rowCount: normalizedRows.length,
    columnCount,
    sourceType,
    sheetName,
    normalizationNotes,
  };
}

function scoreNormalizedTable(table: TableData): number {
  if (table.columns.length === 0 || table.rows.length === 0) return Number.NEGATIVE_INFINITY;

  const profiles = profileColumns(table.columns, table.rows);
  const metricCandidates = rankMetricCandidates(profiles);
  const dimensionCandidates = rankDimensionCandidates(profiles);
  const headerValues = table.columns.map((header) => header.trim());
  const defaultHeaderCount = headerValues.filter((header, index) => header === getDefaultHeader(index)).length;
  const nonEmptyHeaderCount = headerValues.filter(Boolean).length;
  const uniqueHeaderCount = new Set(headerValues.filter(Boolean)).size;
  const metricScore = metricCandidates.reduce((sum, item) => sum + item.score, 0);
  const dimensionScore = dimensionCandidates.reduce((sum, item) => sum + item.score, 0);
  const textLikeHeaders = headerValues.filter((header) => /[A-Za-z가-힣]/.test(header)).length;

  return (
    metricScore * 0.8 +
    dimensionScore * 0.6 +
    nonEmptyHeaderCount * 3 +
    uniqueHeaderCount * 2 +
    textLikeHeaders * 2 -
    defaultHeaderCount * 8
  );
}

function normalizeLogicalTable(
  rawRows: string[][],
  sourceType: TableSourceType,
  id: string,
  bounds: { startRow: number; endRow: number; startCol: number; endCol: number },
  sheetName?: string
): LogicalTable | null {
  const rowMajorTable = normalizeTable(rawRows, sourceType, sheetName);
  const columnMajorTable = normalizeTable(transposeRows(rawRows), sourceType, sheetName);
  const rowMajorScore = scoreNormalizedTable(rowMajorTable);
  const columnMajorScore = scoreNormalizedTable(columnMajorTable);
  const scoreGap = rowMajorScore - columnMajorScore;
  const normalized = scoreGap >= -6 ? rowMajorTable : columnMajorTable;
  const orientation: LogicalTableOrientation = Math.abs(scoreGap) <= 6 ? "ambiguous" : scoreGap > 0 ? "row-major" : "column-major";
  const headerAxis: LogicalTableHeaderAxis = orientation === "column-major" ? "column" : orientation === "row-major" ? "row" : "ambiguous";
  const confidence = Math.min(1, Math.max(0.2, Math.abs(scoreGap) / 40));
  const name = normalized.columns[0]?.trim() || `${sheetName?.trim() || "표"} ${id.replace(/^table-/, "")}`;

  if (normalized.columnCount < 2 || normalized.rowCount < 1) {
    return null;
  }

  return {
    id,
    name,
    source: "detected",
    orientation,
    headerAxis,
    confidence,
    startRow: bounds.startRow,
    endRow: bounds.endRow,
    startCol: bounds.startCol,
    endCol: bounds.endCol,
    columns: normalized.columns,
    rows: normalized.rows,
    rowCount: normalized.rowCount,
    columnCount: normalized.columnCount,
    normalizationNotes: normalized.normalizationNotes,
  };
}

function detectLogicalTables(rawRows: string[][], sourceType: TableSourceType, sheetName?: string): LogicalTable[] {
  const rowBands = splitRowBands(rawRows);
  const logicalTables: LogicalTable[] = [];

  rowBands.forEach((rowBand) => {
    const bandRows = rawRows.slice(rowBand.start, rowBand.end + 1);
    const columnBands = splitColumnBands(bandRows);
    columnBands.forEach((columnBand) => {
      const candidateRows = bandRows.map((row) => row.slice(columnBand.start, columnBand.end + 1));
      const trimmed = trimEmptyBorders(candidateRows);
      if (trimmed.rows.length < 2) return;
      const width = Math.max(0, ...trimmed.rows.map((row) => row.length));
      if (width < 2) return;

      const table = normalizeLogicalTable(
        trimmed.rows,
        sourceType,
        `table-${logicalTables.length + 1}`,
        {
          startRow: rowBand.start + trimmed.startRowOffset + 1,
          endRow: rowBand.start + trimmed.startRowOffset + trimmed.rows.length,
          startCol: columnBand.start + trimmed.startColOffset + 1,
          endCol: columnBand.start + trimmed.startColOffset + width,
        },
        sheetName
      );

      if (table) {
        logicalTables.push(table);
      }
    });
  });

  if (logicalTables.length > 0) {
    return [...logicalTables].sort((left, right) => right.confidence - left.confidence || (right.rowCount * right.columnCount) - (left.rowCount * left.columnCount));
  }

  const fallback = normalizeLogicalTable(rawRows, sourceType, "table-1", { startRow: 1, endRow: rawRows.length, startCol: 1, endCol: Math.max(1, ...rawRows.map((row) => row.length)) }, sheetName);
  return fallback ? [fallback] : [];
}

function buildNormalizedTableFromLogicalTables(logicalTables: LogicalTable[], sourceType: TableSourceType, sheetName?: string): TableData {
  const rankedTables = [...logicalTables].sort((left, right) => right.confidence - left.confidence || (right.rowCount * right.columnCount) - (left.rowCount * left.columnCount));
  const primary = rankedTables[0];
  if (!primary) {
    return normalizeTable([], sourceType, sheetName);
  }

  return {
    columns: primary.columns,
    rows: primary.rows,
    rowCount: primary.rowCount,
    columnCount: primary.columnCount,
    sourceType,
    sheetName,
    normalizationNotes: primary.normalizationNotes,
    logicalTables: rankedTables,
    primaryLogicalTableId: primary.id,
  };
}

function buildGridPreview(rawRows: string[][], maxRows = 120, maxCols = 20): string {
  const rowCount = rawRows.length;
  const columnCount = Math.max(0, ...rawRows.map((row) => row.length));
  const visibleRows = rawRows.slice(0, maxRows).map((row, rowIndex) => {
    const cells = Array.from({ length: Math.min(columnCount, maxCols) }, (_, columnIndex) => {
      const value = trimCell(row[columnIndex] ?? "");
      return `C${columnIndex + 1}=${value || "∅"}`;
    });
    return `R${rowIndex + 1}: ${cells.join(" | ")}`;
  });

  return [
    `[GRID_META] rows=${rowCount} cols=${columnCount}`,
    `[GRID_ROWS]`,
    ...visibleRows,
  ].join("\n");
}

function shouldInvokeGeminiFallback(logicalTables: LogicalTable[], rawRows: string[][]): boolean {
  const primary = logicalTables[0];
  if (!primary) return rawRows.length > 0;

  const totalRows = rawRows.length;
  const totalCols = Math.max(0, ...rawRows.map((row) => row.length));
  const totalArea = Math.max(totalRows * Math.max(totalCols, 1), 1);
  const primaryArea = primary.rowCount * primary.columnCount;
  const dominantButWeak = primaryArea / totalArea > 0.75 && primary.confidence < 0.75;

  return primary.orientation === "ambiguous" || primary.confidence < 0.55 || dominantButWeak;
}

function parseGeminiRangeResponse(input: string): GeminiTableRangeProposal[] {
  const parsed = JSON.parse(input) as { tables?: unknown };
  if (!parsed || !Array.isArray(parsed.tables)) return [];

  return parsed.tables.flatMap((table) => {
    if (!table || typeof table !== "object") return [];
    const candidate = table as Record<string, unknown>;
    const startRow = Number(candidate.startRow);
    const endRow = Number(candidate.endRow);
    const startCol = Number(candidate.startCol);
    const endCol = Number(candidate.endCol);
    const headerAxis = candidate.headerAxis;
    const orientation = candidate.orientation;
    const confidence = Number(candidate.confidence);

    if (![startRow, endRow, startCol, endCol].every((value) => Number.isInteger(value) && value > 0)) {
      return [];
    }

    return [{
      id: typeof candidate.id === "string" ? candidate.id : undefined,
      startRow,
      endRow,
      startCol,
      endCol,
      headerAxis: headerAxis === "row" || headerAxis === "column" || headerAxis === "ambiguous" ? headerAxis : undefined,
      orientation: orientation === "row-major" || orientation === "column-major" || orientation === "ambiguous" ? orientation : undefined,
      confidence: Number.isFinite(confidence) ? confidence : undefined,
      title: typeof candidate.title === "string" ? candidate.title.trim() : undefined,
      reason: typeof candidate.reason === "string" ? candidate.reason.trim() : undefined,
    }];
  });
}

function validateGeminiRangeProposal(proposal: GeminiTableRangeProposal, rawRows: string[][]): boolean {
  const maxRow = rawRows.length;
  const maxCol = Math.max(0, ...rawRows.map((row) => row.length));
  if (proposal.startRow > proposal.endRow || proposal.startCol > proposal.endCol) return false;
  if (proposal.endRow > maxRow || proposal.endCol > maxCol) return false;

  const sliced = rawRows
    .slice(proposal.startRow - 1, proposal.endRow)
    .map((row) => row.slice(proposal.startCol - 1, proposal.endCol));
  const trimmed = trimEmptyBorders(sliced);
  const width = Math.max(0, ...trimmed.rows.map((row) => row.length));
  return trimmed.rows.length >= 2 && width >= 2;
}

async function detectTableRangesWithGemini(
  rawRows: string[][],
  sourceType: TableSourceType,
  apiKey: string,
  sheetName?: string
): Promise<GeminiTableRangeProposal[]> {
  const systemInstruction = `당신은 비정형 표 그리드에서 논리적 표 범위를 찾는 분석기입니다. 반드시 JSON만 반환하세요. 설명, 마크다운, 코드블록은 금지합니다.

반환 형식:
{
  "tables": [
    {
      "id": "table-1",
      "startRow": 1,
      "endRow": 10,
      "startCol": 1,
      "endCol": 5,
      "headerAxis": "row",
      "orientation": "row-major",
      "confidence": 0.8,
      "title": "표 이름",
      "reason": "짧은 근거"
    }
  ]
}

규칙:
- row/col은 1부터 시작합니다.
- 여러 표가 보이면 모두 반환합니다.
- 장식 행, 공백 행, 메모 행은 가능하면 제외합니다.
- 불확실하면 confidence를 낮추고 ambiguous를 사용합니다.
- 반드시 JSON만 반환합니다.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TABLE_RANGE_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{
          role: "user",
          parts: [{
            text: [
              `sourceType=${sourceType}`,
              sheetName ? `sheetName=${sheetName}` : "",
              buildGridPreview(rawRows),
            ].filter(Boolean).join("\n\n"),
          }],
        }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const responseText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof responseText !== "string" || !responseText.trim()) return [];

    try {
      return parseGeminiRangeResponse(responseText);
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

function buildLogicalTablesFromGeminiRanges(
  proposals: GeminiTableRangeProposal[],
  rawRows: string[][],
  sourceType: TableSourceType,
  sheetName?: string
): LogicalTable[] {
  return proposals.flatMap((proposal, index) => {
    if (!validateGeminiRangeProposal(proposal, rawRows)) return [];

    const sliced = rawRows
      .slice(proposal.startRow - 1, proposal.endRow)
      .map((row) => row.slice(proposal.startCol - 1, proposal.endCol));
    const trimmed = trimEmptyBorders(sliced);
    const table = normalizeLogicalTable(
      trimmed.rows,
      sourceType,
      proposal.id?.trim() || `table-${index + 1}`,
      {
        startRow: proposal.startRow + trimmed.startRowOffset,
        endRow: proposal.startRow + trimmed.startRowOffset + trimmed.rows.length - 1,
        startCol: proposal.startCol + trimmed.startColOffset,
        endCol: proposal.startCol + trimmed.startColOffset + Math.max(0, ...trimmed.rows.map((row) => row.length)) - 1,
      },
      sheetName
    );

    if (!table) return [];

    return [{
      ...table,
      name: proposal.title || table.name,
      orientation: proposal.orientation ?? table.orientation,
      headerAxis: proposal.headerAxis ?? table.headerAxis,
      confidence: proposal.confidence !== undefined ? Math.max(0.2, Math.min(1, proposal.confidence)) : table.confidence,
      normalizationNotes: [
        ...(table.normalizationNotes ?? []),
        `Gemini fallback range applied${proposal.reason ? `: ${proposal.reason}` : "."}`,
      ],
    } satisfies LogicalTable];
  });
}

function mergeLogicalTables(primary: LogicalTable[], fallback: LogicalTable[]): LogicalTable[] {
  const merged = [...primary];

  for (const candidate of fallback) {
    const duplicateIndex = merged.findIndex((table) =>
      table.startRow === candidate.startRow &&
      table.endRow === candidate.endRow &&
      table.startCol === candidate.startCol &&
      table.endCol === candidate.endCol
    );

    if (duplicateIndex >= 0) {
      if (candidate.confidence > merged[duplicateIndex].confidence) {
        merged[duplicateIndex] = candidate;
      }
      continue;
    }

    merged.push(candidate);
  }

  return merged.sort((left, right) => right.confidence - left.confidence || (right.rowCount * right.columnCount) - (left.rowCount * left.columnCount));
}

function assignStableLogicalTableIds(logicalTables: LogicalTable[]): LogicalTable[] {
  return logicalTables.map((table, index) => ({
    ...table,
    id: `table-${index + 1}`,
  }));
}

async function resolveLogicalTables(
  rawRows: string[][],
  sourceType: TableSourceType,
  sheetName: string | undefined,
  options?: ParseTableOptions
): Promise<LogicalTable[]> {
  const heuristicTables = detectLogicalTables(rawRows, sourceType, sheetName);
  const apiKey = options?.apiKey?.trim();

  if (!apiKey || !shouldInvokeGeminiFallback(heuristicTables, rawRows)) {
    return heuristicTables;
  }

  const geminiProposals = await detectTableRangesWithGemini(rawRows, sourceType, apiKey, sheetName);
  const geminiTables = buildLogicalTablesFromGeminiRanges(geminiProposals, rawRows, sourceType, sheetName);
  if (geminiTables.length === 0) {
    return heuristicTables;
  }

  return assignStableLogicalTableIds(mergeLogicalTables(heuristicTables, geminiTables));
}

function detectDelimiter(text: string): string {
  const candidates = [",", "\t", ";", "|"];
  const sampleLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);

  const scores = candidates.map((candidate) => {
    const counts = sampleLines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        if (!inQuotes && char === candidate) count += 1;
      }
      return count;
    });

    const total = counts.reduce((sum, count) => sum + count, 0);
    const variance = counts.reduce((sum, count) => sum + Math.abs(count - (counts[0] ?? 0)), 0);
    return { candidate, total, variance };
  });

  scores.sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    return left.variance - right.variance;
  });

  return scores[0]?.candidate ?? ",";
}

function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function parseXml(xmlText: string): Document {
  return new DOMParser().parseFromString(xmlText, "application/xml");
}

function getXmlElements(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

function getXmlText(node: Document | Element, localName: string): string {
  return getXmlElements(node, localName)
    .map((element) => element.textContent ?? "")
    .join("");
}

function getPathDir(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts.filter(Boolean);
}

function resolveZipPath(basePath: string, target: string): string {
  const parts = target.replace(/^\//, "").split("/");
  const baseParts = getPathDir(basePath);

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      baseParts.pop();
      continue;
    }
    baseParts.push(part);
  }

  return baseParts.join("/");
}

function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const minimumOffset = Math.max(0, buffer.byteLength - 65557);
  let eocdOffset = -1;

  for (let offset = buffer.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("XLSX 파일의 ZIP 구조를 읽지 못했습니다.");
  }

  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;
  const decoder = new TextDecoder("utf-8");

  while (cursor < centralDirectoryOffset + centralDirectorySize) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      throw new Error("XLSX 중앙 디렉터리 항목이 손상되었습니다.");
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const name = decoder.decode(new Uint8Array(buffer.slice(fileNameStart, fileNameEnd)));

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    cursor = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function getZipEntryBytes(buffer: ArrayBuffer, entry: ZipEntry): Uint8Array {
  const view = new DataView(buffer);
  const localHeaderOffset = entry.localHeaderOffset;

  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`ZIP 로컬 헤더를 찾지 못했습니다: ${entry.name}`);
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;
  return new Uint8Array(buffer.slice(dataStart, dataEnd));
}

async function inflateZipEntry(entryBytes: Uint8Array, compressionMethod: number): Promise<Uint8Array> {
  if (compressionMethod === 0) {
    return entryBytes;
  }

  if (compressionMethod !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("지원하지 않는 XLSX 압축 형식입니다.");
  }

  const entryBuffer = entryBytes.buffer.slice(
    entryBytes.byteOffset,
    entryBytes.byteOffset + entryBytes.byteLength
  ) as ArrayBuffer;
  const stream = new Blob([entryBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function unzipTextEntry(buffer: ArrayBuffer, entryName: string): Promise<string | null> {
  const entry = readZipEntries(buffer).find((item) => item.name === entryName);
  if (!entry) return null;
  const bytes = getZipEntryBytes(buffer, entry);
  const inflated = await inflateZipEntry(bytes, entry.compressionMethod);
  return bytesToUtf8(inflated);
}

function getSharedStrings(sharedStringsXml: string | null): string[] {
  if (!sharedStringsXml) return [];
  const document = parseXml(sharedStringsXml);
  return getXmlElements(document, "si").map((item) => getXmlText(item, "t"));
}

function cellRefToColumnIndex(cellRef: string): number {
  const letters = cellRef.replace(/\d+/g, "").toUpperCase();
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

function getCellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t");

  if (type === "inlineStr") {
    return getXmlText(cell, "t");
  }

  const rawValue = getXmlText(cell, "v");
  if (!rawValue) return "";

  if (type === "s") {
    const sharedStringIndex = Number.parseInt(rawValue, 10);
    return Number.isFinite(sharedStringIndex) ? sharedStrings[sharedStringIndex] ?? "" : "";
  }

  if (type === "b") {
    return rawValue === "1" ? "TRUE" : "FALSE";
  }

  return rawValue;
}

async function parseFirstSheetFromXlsx(buffer: ArrayBuffer): Promise<{ rows: string[][]; sheetName?: string }> {
  const workbookXml = await unzipTextEntry(buffer, "xl/workbook.xml");
  const workbookRelsXml = await unzipTextEntry(buffer, "xl/_rels/workbook.xml.rels");

  if (!workbookXml || !workbookRelsXml) {
    throw new Error("XLSX 워크북 정보를 찾지 못했습니다.");
  }

  const workbookDocument = parseXml(workbookXml);
  const workbookRelsDocument = parseXml(workbookRelsXml);
  const firstSheet = getXmlElements(workbookDocument, "sheet")[0];
  if (!firstSheet) {
    throw new Error("첫 번째 시트를 찾지 못했습니다.");
  }

  const relationId = firstSheet.getAttribute("r:id") ?? "";
  const sheetName = firstSheet.getAttribute("name") ?? undefined;
  const relationship = getXmlElements(workbookRelsDocument, "Relationship").find(
    (element) => element.getAttribute("Id") === relationId
  );

  if (!relationship) {
    throw new Error("첫 번째 시트 관계 정보를 찾지 못했습니다.");
  }

  const target = relationship.getAttribute("Target") ?? "";
  const sheetPath = resolveZipPath("xl/workbook.xml", target);
  const sheetXml = await unzipTextEntry(buffer, sheetPath);
  if (!sheetXml) {
    throw new Error("첫 번째 시트 XML을 불러오지 못했습니다.");
  }

  const sharedStrings = getSharedStrings(await unzipTextEntry(buffer, "xl/sharedStrings.xml"));
  const sheetDocument = parseXml(sheetXml);
  const rowElements = getXmlElements(sheetDocument, "row");
  const rows: string[][] = [];
  rowElements.forEach((rowElement) => {
    const rowIndexAttr = Number.parseInt(rowElement.getAttribute("r") ?? "", 10);
    const rowIndex = Number.isFinite(rowIndexAttr) && rowIndexAttr > 0 ? rowIndexAttr - 1 : rows.length;
    while (rows.length < rowIndex) {
      rows.push([]);
    }
    const row: string[] = [];
    for (const cell of getXmlElements(rowElement, "c")) {
      const cellRef = cell.getAttribute("r") ?? "A1";
      const columnIndex = cellRefToColumnIndex(cellRef);
      row[columnIndex] = getCellValue(cell, sharedStrings);
    }
    rows[rowIndex] = row;
  });

  return { rows, sheetName };
}

function assertSupportedTableFile(fileName: string): TableSourceType {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".xlsx")) return "xlsx";
  throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
}

async function parseTableBuffer(buffer: ArrayBuffer, fileName: string, options?: ParseTableOptions): Promise<TableData> {
  const sourceType = assertSupportedTableFile(fileName);
  let rawRows: string[][] = [];
  let sheetName: string | undefined;

  if (sourceType === "csv") {
    const text = bytesToUtf8(new Uint8Array(buffer));
    const delimiter = detectDelimiter(text);
    rawRows = parseDelimitedText(text, delimiter);
  } else {
    const parsedSheet = await parseFirstSheetFromXlsx(buffer);
    rawRows = parsedSheet.rows;
    sheetName = parsedSheet.sheetName;
  }

  const logicalTables = await resolveLogicalTables(rawRows, sourceType, sheetName, options);
  return buildNormalizedTableFromLogicalTables(logicalTables, sourceType, sheetName);
}

export async function parseTableFile(file: File, options?: ParseTableOptions): Promise<TableData> {
  const buffer = await file.arrayBuffer();
  return parseTableBuffer(buffer, file.name, options);
}

export async function parseTableBase64(base64: string, fileName: string, options?: ParseTableOptions): Promise<TableData> {
  const bytes = decodeBase64(base64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return parseTableBuffer(buffer, fileName, options);
}

export function getDatasetTitle(fileName: string): string {
  const stripped = stripExtension(fileName);
  return stripped || "테이블 데이터셋";
}

export function getUploadMimeType(fileName: string): string {
  const sourceType = assertSupportedTableFile(fileName);
  return sourceType === "csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function truncateCell(value: string, maxLength = 80): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

type InferredColumnKind = "number" | "percent" | "currency" | "date" | "boolean" | "id" | "text";
type CardinalityBucket = "low" | "medium" | "high";

interface ColumnValueCount {
  value: string;
  count: number;
}

interface ColumnProfile {
  index: number;
  name: string;
  nonEmptyCount: number;
  missingCount: number;
  missingRatio: number;
  distinctCount: number;
  uniqueRatio: number;
  averageTextLength: number;
  exampleValues: string[];
  topValues: ColumnValueCount[];
  inferredKind: InferredColumnKind;
  cardinality: CardinalityBucket;
  idLike: boolean;
  numberCoverage: number;
  percentCoverage: number;
  currencyCoverage: number;
  dateCoverage: number;
  booleanCoverage: number;
  minValue?: number;
  maxValue?: number;
  meanValue?: number;
}

interface RankedField {
  name: string;
  score: number;
  reason: string;
}

interface ChartHint {
  chartType: "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map";
  dimension: string;
  metric: string;
  reason: string;
  score: number;
}

const NUMBER_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PERCENT_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%$/;
const CURRENCY_SYMBOL_REGEX = /^[₩$€¥£]\s*/;
const DATE_VALUE_REGEXES = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/,
  /^\d{4}[-/.]\d{1,2}$/,
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/,
];
const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n", "0", "1", "t", "f"]);
const METRIC_HEADER_HINTS = ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"];
const DIMENSION_HEADER_HINTS = ["date", "time", "month", "year", "day", "category", "type", "group", "segment", "region", "country", "city", "name", "제품", "카테고리", "유형", "구분", "지역", "국가", "도시", "이름", "항목", "월", "연도", "일자", "날짜"];
const MAP_HEADER_HINTS = ["country", "region", "state", "city", "nation", "국가", "지역", "도시", "시도"];
const ID_HEADER_HINTS = ["id", "code", "key", "uuid", "identifier", "번호", "코드", "식별", "순번", "주문번호", "상품코드"];

function formatRatio(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function normalizeCellValue(value: string): string {
  return value.trim();
}

function parsePlainNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!NUMBER_VALUE_REGEX.test(value.trim()) && !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentNumber(value: string): number | null {
  const normalized = value.trim();
  if (!PERCENT_VALUE_REGEX.test(normalized)) return null;
  return parsePlainNumber(normalized.replace(/%/g, "").trim());
}

function parseCurrencyNumber(value: string): number | null {
  const normalized = value.trim();
  if (!CURRENCY_SYMBOL_REGEX.test(normalized)) return null;
  return parsePlainNumber(normalized.replace(CURRENCY_SYMBOL_REGEX, ""));
}

function isBooleanLike(value: string): boolean {
  return BOOLEAN_VALUES.has(value.trim().toLowerCase());
}

function isDateLike(value: string): boolean {
  const normalized = value.trim();
  if (!DATE_VALUE_REGEXES.some((regex) => regex.test(normalized))) {
    return false;
  }
  const timestamp = Date.parse(normalized.replace(/\./g, "-"));
  return Number.isFinite(timestamp);
}

function isHeaderHint(header: string, hints: string[]): boolean {
  const normalized = header.trim().toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

function getCoverageThreshold(nonEmptyCount: number): number {
  return nonEmptyCount < 20 ? 0.7 : 0.85;
}

function classifyCardinality(distinctCount: number, uniqueRatio: number): CardinalityBucket {
  if (distinctCount <= 20 && uniqueRatio <= 0.2) return "low";
  if (distinctCount <= 100 && uniqueRatio <= 0.6) return "medium";
  return "high";
}

function inferColumnKind(params: {
  header: string;
  values: string[];
  nonEmptyCount: number;
  uniqueRatio: number;
  averageTextLength: number;
  numberCoverage: number;
  percentCoverage: number;
  currencyCoverage: number;
  dateCoverage: number;
  booleanCoverage: number;
}): { inferredKind: InferredColumnKind; idLike: boolean } {
  const { header, values, nonEmptyCount, uniqueRatio, averageTextLength, numberCoverage, percentCoverage, currencyCoverage, dateCoverage, booleanCoverage } = params;
  const threshold = getCoverageThreshold(nonEmptyCount);
  const alphaNumericShare = values.filter((value) => /[A-Za-z]/.test(value) && /\d/.test(value)).length / Math.max(values.length, 1);
  const numericOnlyShare = values.filter((value) => /^\d+$/.test(value)).length / Math.max(values.length, 1);
  const whitespaceShare = values.filter((value) => /\s/.test(value)).length / Math.max(values.length, 1);
  const idLike =
    uniqueRatio >= 0.95 &&
    averageTextLength <= 40 &&
    whitespaceShare < 0.1 &&
    (alphaNumericShare >= 0.2 || numericOnlyShare >= 0.9 || isHeaderHint(header, ID_HEADER_HINTS));

  if (percentCoverage >= threshold) return { inferredKind: "percent", idLike };
  if (currencyCoverage >= threshold) return { inferredKind: "currency", idLike };
  if (numberCoverage >= threshold) return { inferredKind: "number", idLike };
  if (dateCoverage >= threshold) return { inferredKind: "date", idLike };
  if (booleanCoverage >= threshold) return { inferredKind: "boolean", idLike };
  if (idLike) return { inferredKind: "id", idLike };
  return { inferredKind: "text", idLike };
}

function getColumnValues(rows: string[][], columnIndex: number): string[] {
  return rows.map((row) => normalizeCellValue(row[columnIndex] ?? ""));
}

function profileColumns(columns: string[], rows: string[][]): ColumnProfile[] {
  return columns.map((name, index) => {
    const values = getColumnValues(rows, index);
    const nonEmptyValues = values.filter(Boolean);
    const nonEmptyCount = nonEmptyValues.length;
    const missingCount = rows.length - nonEmptyCount;
    const missingRatio = missingCount / Math.max(rows.length, 1);
    const frequency = new Map<string, number>();

    for (const value of nonEmptyValues) {
      frequency.set(value, (frequency.get(value) ?? 0) + 1);
    }

    const distinctCount = frequency.size;
    const uniqueRatio = distinctCount / Math.max(nonEmptyCount, 1);
    const averageTextLength = nonEmptyValues.reduce((sum, value) => sum + value.length, 0) / Math.max(nonEmptyCount, 1);
    const exampleValues = Array.from(new Set(nonEmptyValues)).slice(0, 3);
    const topValues = Array.from(frequency.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    const numericValues: number[] = [];
    let numberMatches = 0;
    let percentMatches = 0;
    let currencyMatches = 0;
    let dateMatches = 0;
    let booleanMatches = 0;

    for (const value of nonEmptyValues) {
      const percentValue = parsePercentNumber(value);
      const currencyValue = parseCurrencyNumber(value);
      const plainNumber = parsePlainNumber(value);

      if (percentValue !== null) {
        percentMatches += 1;
        numericValues.push(percentValue);
      }

      if (currencyValue !== null) {
        currencyMatches += 1;
        numericValues.push(currencyValue);
      }

      if (plainNumber !== null) {
        numberMatches += 1;
        numericValues.push(plainNumber);
      }

      if (isDateLike(value)) {
        dateMatches += 1;
      }

      if (isBooleanLike(value)) {
        booleanMatches += 1;
      }
    }

    const meanValue = numericValues.length > 0
      ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
      : undefined;
    const { inferredKind, idLike } = inferColumnKind({
      header: name,
      values: nonEmptyValues,
      nonEmptyCount,
      uniqueRatio,
      averageTextLength,
      numberCoverage: numberMatches / Math.max(nonEmptyCount, 1),
      percentCoverage: percentMatches / Math.max(nonEmptyCount, 1),
      currencyCoverage: currencyMatches / Math.max(nonEmptyCount, 1),
      dateCoverage: dateMatches / Math.max(nonEmptyCount, 1),
      booleanCoverage: booleanMatches / Math.max(nonEmptyCount, 1),
    });

    return {
      index,
      name,
      nonEmptyCount,
      missingCount,
      missingRatio,
      distinctCount,
      uniqueRatio,
      averageTextLength,
      exampleValues,
      topValues,
      inferredKind,
      cardinality: classifyCardinality(distinctCount, uniqueRatio),
      idLike,
      numberCoverage: numberMatches / Math.max(nonEmptyCount, 1),
      percentCoverage: percentMatches / Math.max(nonEmptyCount, 1),
      currencyCoverage: currencyMatches / Math.max(nonEmptyCount, 1),
      dateCoverage: dateMatches / Math.max(nonEmptyCount, 1),
      booleanCoverage: booleanMatches / Math.max(nonEmptyCount, 1),
      minValue: numericValues.length > 0 ? Math.min(...numericValues) : undefined,
      maxValue: numericValues.length > 0 ? Math.max(...numericValues) : undefined,
      meanValue,
    };
  });
}

function rankMetricCandidates(profiles: ColumnProfile[]): RankedField[] {
  return profiles
    .filter((profile) => ["number", "percent", "currency"].includes(profile.inferredKind) && !profile.idLike)
    .map((profile) => {
      let score = 40 * Math.max(profile.numberCoverage, profile.percentCoverage, profile.currencyCoverage);
      score -= 20 * profile.missingRatio;
      score += 15 * Math.min(profile.uniqueRatio, 1);
      if (isHeaderHint(profile.name, METRIC_HEADER_HINTS)) score += 10;
      if (profile.idLike) score -= 25;
      return {
        name: profile.name,
        score,
        reason: `${profile.inferredKind}, 결측 ${formatRatio(profile.missingRatio)}, 고유값 ${profile.distinctCount}`,
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3);
}

function rankDimensionCandidates(profiles: ColumnProfile[]): RankedField[] {
  return profiles
    .filter((profile) => {
      if (profile.idLike) return false;
      if (["date", "text", "boolean"].includes(profile.inferredKind)) return true;
      return profile.inferredKind === "number" && profile.cardinality !== "high";
    })
    .map((profile) => {
      let score = 0;
      if (profile.cardinality === "low") score += 25;
      else if (profile.cardinality === "medium") score += 10;
      else score -= 20;
      score -= 15 * profile.missingRatio;
      if (isHeaderHint(profile.name, DIMENSION_HEADER_HINTS)) score += 10;
      if (profile.idLike) score -= 30;
      return {
        name: profile.name,
        score,
        reason: `${profile.inferredKind}, ${profile.cardinality} cardinality, 고유값 ${profile.distinctCount}`,
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3);
}

function buildChartHints(profiles: ColumnProfile[], metrics: RankedField[], dimensions: RankedField[]): ChartHint[] {
  const dimensionProfiles = dimensions
    .map((candidate) => profiles.find((profile) => profile.name === candidate.name))
    .filter((profile): profile is ColumnProfile => Boolean(profile));
  const metricProfiles = metrics
    .map((candidate) => profiles.find((profile) => profile.name === candidate.name))
    .filter((profile): profile is ColumnProfile => Boolean(profile));
  const hints: ChartHint[] = [];
  const primaryMetric = metricProfiles[0];
  const primaryDimension = dimensionProfiles[0];
  const secondaryDimension = dimensionProfiles[1];

  if (primaryDimension && primaryMetric) {
    if (primaryDimension.inferredKind === "date") {
      hints.push({ chartType: "line", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "time_series", score: 90 });
    }

    if (["low", "medium"].includes(primaryDimension.cardinality)) {
      hints.push({ chartType: "bar", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "category_compare", score: 82 });
    }

    if (primaryDimension.cardinality === "low" && primaryDimension.distinctCount <= 8) {
      hints.push({ chartType: "donut", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "part_to_whole", score: 74 });
      hints.push({ chartType: "pie", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "part_to_whole", score: 70 });
    }

    if (isHeaderHint(primaryDimension.name, MAP_HEADER_HINTS)) {
      hints.push({ chartType: "map", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "geo_compare", score: 76 });
    }
  }

  if (primaryMetric && primaryDimension && secondaryDimension && secondaryDimension.cardinality === "low" && secondaryDimension.distinctCount <= 8) {
    hints.push({ chartType: "stacked-bar", dimension: primaryDimension.name, metric: primaryMetric.name, reason: `split_by_${secondaryDimension.name}`, score: 78 });
  }

  return hints
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType))
    .filter((hint, index, source) => index === source.findIndex((candidate) => candidate.chartType === hint.chartType && candidate.dimension === hint.dimension && candidate.metric === hint.metric))
    .slice(0, 3);
}

function findExtremeRowIndexes(rows: string[][], columnIndex: number): number[] {
  let minRowIndex = -1;
  let maxRowIndex = -1;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;

  rows.forEach((row, rowIndex) => {
    const value = normalizeCellValue(row[columnIndex] ?? "");
    const parsed = parsePercentNumber(value) ?? parseCurrencyNumber(value) ?? parsePlainNumber(value);
    if (parsed === null) return;
    if (parsed < minValue) {
      minValue = parsed;
      minRowIndex = rowIndex;
    }
    if (parsed > maxValue) {
      maxValue = parsed;
      maxRowIndex = rowIndex;
    }
  });

  return [minRowIndex, maxRowIndex].filter((index) => index >= 0);
}

function selectSampleRowIndexes(rows: string[][], profiles: ColumnProfile[], metrics: RankedField[], limit = 10): number[] {
  if (rows.length <= limit) {
    return rows.map((_, index) => index);
  }

  const selected = new Set<number>();
  for (let index = 0; index < Math.min(4, rows.length); index += 1) {
    selected.add(index);
  }

  for (const metric of metrics) {
    const profile = profiles.find((candidate) => candidate.name === metric.name);
    if (!profile) continue;
    for (const rowIndex of findExtremeRowIndexes(rows, profile.index)) {
      selected.add(rowIndex);
    }
  }

  const missingScores = rows
    .map((row, rowIndex) => ({
      rowIndex,
      missingCount: row.filter((value) => !normalizeCellValue(value ?? "")).length,
    }))
    .sort((left, right) => right.missingCount - left.missingCount || left.rowIndex - right.rowIndex)
    .slice(0, 2);

  missingScores.forEach((item) => {
    if (item.missingCount > 0) selected.add(item.rowIndex);
  });

  if (selected.size < limit) {
    const remaining = limit - selected.size;
    for (let index = 0; index < remaining; index += 1) {
      const ratio = remaining === 1 ? 0 : index / (remaining - 1);
      selected.add(Math.round(ratio * (rows.length - 1)));
    }
  }

  return Array.from(selected).sort((left, right) => left - right).slice(0, limit);
}

function formatColumnProfile(profile: ColumnProfile): string {
  const examples = profile.exampleValues.length > 0 ? profile.exampleValues.map((value) => truncateCell(value, 24)).join(", ") : "-";
  const numericSummary = profile.minValue !== undefined && profile.maxValue !== undefined
    ? ` | 범위 ${formatCompactNumber(profile.minValue)}~${formatCompactNumber(profile.maxValue)} | 평균 ${formatCompactNumber(profile.meanValue ?? 0)}`
    : "";
  const topValueSummary = profile.topValues.length > 0
    ? ` | 상위값 ${profile.topValues.slice(0, 3).map((item) => `${truncateCell(item.value, 16)}(${item.count})`).join(", ")}`
    : "";

  return `- ${profile.name} | kind=${profile.inferredKind} | 결측 ${formatRatio(profile.missingRatio)} | 고유값 ${profile.distinctCount}(${profile.cardinality}) | 예시 ${examples}${numericSummary}${topValueSummary}`;
}

function formatRankedFields(label: string, fields: RankedField[]): string {
  if (fields.length === 0) {
    return `${label}: 없음`;
  }

  return `${label}: ${fields.map((field) => `${field.name}(${field.reason})`).join(" / ")}`;
}

function buildDataQualityLines(profiles: ColumnProfile[]): string[] {
  const nullHeavy = profiles.filter((profile) => profile.missingRatio >= 0.3).map((profile) => `${profile.name}(${formatRatio(profile.missingRatio)})`);
  const mixedType = profiles
    .filter((profile) => profile.inferredKind === "text" && Math.max(profile.numberCoverage, profile.dateCoverage, profile.booleanCoverage) >= 0.3)
    .map((profile) => profile.name);
  const highCardinality = profiles.filter((profile) => profile.cardinality === "high" && !profile.idLike).map((profile) => `${profile.name}(${profile.distinctCount})`);

  return [
    `- 결측 많은 열: ${nullHeavy.length > 0 ? nullHeavy.join(", ") : "없음"}`,
    `- 혼합형 의심 열: ${mixedType.length > 0 ? mixedType.join(", ") : "없음"}`,
    `- 고카디널리티 열: ${highCardinality.length > 0 ? highCardinality.join(", ") : "없음"}`,
  ];
}

export function buildTableContext(tableData: TableData): string {
  const logicalTableInventory = (tableData.logicalTables ?? []).map((table) => {
    const shape = `${table.rowCount}x${table.columnCount}`;
    const orientation = table.orientation === "column-major" ? "column-major" : table.orientation === "row-major" ? "row-major" : "ambiguous";
    const sample = table.rows[0]?.slice(0, 4).join(" | ") || "샘플 없음";
    return `- ${table.id}: ${table.name} | 범위 R${table.startRow}-R${table.endRow}, C${table.startCol}-C${table.endCol} | shape=${shape} | orientation=${orientation} | confidence=${table.confidence.toFixed(2)} | columns=${table.columns.join(", ")} | sample=${sample}`;
  });
  const profiles = profileColumns(tableData.columns, tableData.rows);
  const metricCandidates = rankMetricCandidates(profiles);
  const dimensionCandidates = rankDimensionCandidates(profiles);
  const chartHints = buildChartHints(profiles, metricCandidates, dimensionCandidates);
  const sampleRowIndexes = selectSampleRowIndexes(tableData.rows, profiles, metricCandidates, 10);
  const previewLines = sampleRowIndexes.map((rowIndex) => {
    const row = tableData.rows[rowIndex] ?? [];
    const mapped = tableData.columns.map((header, cellIndex) => `${header}=${truncateCell(row[cellIndex] ?? "-", 36)}`);
    return `${rowIndex + 1}. ${mapped.join(" | ")}`;
  });

  return [
    `[DATASET_META]`,
    `- 형식: ${(tableData.sourceType ?? "csv").toUpperCase()}`,
    tableData.sheetName ? `- 시트: ${tableData.sheetName}` : "",
    `- 논리 표 수: ${tableData.logicalTables?.length ?? 1}`,
    tableData.primaryLogicalTableId ? `- 대표 표: ${tableData.primaryLogicalTableId}` : "",
    `- 행 수: ${tableData.rowCount}`,
    `- 열 이름: ${tableData.columns.join(", ")}`,
    "",
    `[LOGICAL_TABLES]`,
    ...(logicalTableInventory.length > 0 ? logicalTableInventory : ["- 감지된 추가 표가 없습니다."]),
    "",
    `[COLUMN_PROFILES]`,
    ...profiles.map(formatColumnProfile),
    "",
    `[FIELD_ROLES]`,
    formatRankedFields("- dimension 후보", dimensionCandidates),
    formatRankedFields("- metric 후보", metricCandidates),
    `- id 성격 열: ${profiles.filter((profile) => profile.idLike).map((profile) => profile.name).join(", ") || "없음"}`,
    `- 시간축 후보: ${profiles.filter((profile) => profile.inferredKind === "date").map((profile) => profile.name).join(", ") || "없음"}`,
    "",
    `[CHART_HINTS]`,
    ...(chartHints.length > 0
      ? chartHints.map((hint) => `- ${hint.dimension} + ${hint.metric} -> ${hint.chartType} (${hint.reason})`)
      : ["- 뚜렷한 차트 힌트를 찾지 못했습니다."]),
    "",
    `[DATA_QUALITY]`,
    ...buildDataQualityLines(profiles),
    `- 정규화 노트: ${(tableData.normalizationNotes ?? []).join(" /") || "없음"}`,
    "",
    `[ROW_SAMPLES]`,
    ...previewLines,
  ]
    .filter(Boolean)
    .join("\n");
}
