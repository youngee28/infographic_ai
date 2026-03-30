export type TableSourceType = "csv" | "xlsx";

export interface TableData {
  columns: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  sourceType?: TableSourceType;
  sheetName?: string;
  normalizationNotes?: string[];
}

const MAX_PREVIEW_ROWS = 40;
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
  const next = [...row];
  while (next.length < columnCount) {
    next.push("");
  }
  return next.slice(0, columnCount);
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
  const rows = rowElements.map((rowElement) => {
    const row: string[] = [];
    for (const cell of getXmlElements(rowElement, "c")) {
      const cellRef = cell.getAttribute("r") ?? "A1";
      const columnIndex = cellRefToColumnIndex(cellRef);
      row[columnIndex] = getCellValue(cell, sharedStrings);
    }
    return row;
  });

  return { rows, sheetName };
}

function assertSupportedTableFile(fileName: string): TableSourceType {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".xlsx")) return "xlsx";
  throw new Error("CSV 또는 XLSX 파일만 업로드할 수 있습니다.");
}

async function parseTableBuffer(buffer: ArrayBuffer, fileName: string): Promise<TableData> {
  const sourceType = assertSupportedTableFile(fileName);

  if (sourceType === "csv") {
    const text = bytesToUtf8(new Uint8Array(buffer));
    const delimiter = detectDelimiter(text);
    const rows = parseDelimitedText(text, delimiter);
    return normalizeTable(rows, sourceType);
  }

  const { rows, sheetName } = await parseFirstSheetFromXlsx(buffer);
  return normalizeTable(rows, sourceType, sheetName);
}

export async function parseTableFile(file: File): Promise<TableData> {
  const buffer = await file.arrayBuffer();
  return parseTableBuffer(buffer, file.name);
}

export async function parseTableBase64(base64: string, fileName: string): Promise<TableData> {
  const bytes = decodeBase64(base64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return parseTableBuffer(buffer, fileName);
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

export function buildTableContext(tableData: TableData): string {
  const previewLines = tableData.rows.slice(0, 24).map((row, rowIndex) => {
    const mapped = tableData.columns.map((header, cellIndex) => `${header}: ${truncateCell(row[cellIndex] ?? "-")}`);
    return `${rowIndex + 1}. ${mapped.join(" | ")}`;
  });

  return [
    `데이터셋 개요`,
    `- 열 수: ${tableData.columnCount}`,
    `- 행 수: ${tableData.rowCount}`,
    `- 형식: ${(tableData.sourceType ?? "csv").toUpperCase()}`,
    tableData.sheetName ? `- 시트: ${tableData.sheetName}` : "",
    `- 열 이름: ${tableData.columns.join(", ")}`,
    `- 정규화 노트: ${(tableData.normalizationNotes ?? []).join(" /")}`,
    "",
    `샘플 행`,
    ...previewLines,
  ]
    .filter(Boolean)
    .join("\n");
}
