import type { AnalysisSheetStructure, SourceTable } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";

interface TableIdResolutionOptions {
  tableData?: TableData | null;
  sheetStructure?: AnalysisSheetStructure | null;
  sourceTables?: SourceTable[] | null;
}

function normalizeName(value?: string): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function rangeKey(range?: { startRow: number; endRow: number; startCol: number; endCol: number }): string | undefined {
  if (!range) return undefined;
  return `${range.startRow}:${range.endRow}:${range.startCol}:${range.endCol}`;
}

function logicalRangeKey(table: NonNullable<TableData["logicalTables"]>[number]): string {
  return `${table.startRow}:${table.endRow}:${table.startCol}:${table.endCol}`;
}

function columnLabelToNumber(value: string): number {
  let result = 0;
  for (const character of value.toUpperCase()) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) return Number.NaN;
    result = result * 26 + (code - 64);
  }
  return result;
}

function parseRangeLabel(rangeLabel?: string): { startRow: number; endRow: number; startCol: number; endCol: number } | undefined {
  const compact = rangeLabel?.trim();
  if (!compact) return undefined;

  const structuredMatch = compact.match(/^R(\d+)-R(\d+)\s*\/\s*C(\d+)-C(\d+)$/i);
  if (structuredMatch) {
    return {
      startRow: Number(structuredMatch[1]),
      endRow: Number(structuredMatch[2]),
      startCol: Number(structuredMatch[3]),
      endCol: Number(structuredMatch[4]),
    };
  }

  const localizedMatch = compact.match(/^(\d+)~(\d+)행,\s*([A-Z]+)~([A-Z]+)열$/i);
  if (localizedMatch) {
    return {
      startRow: Number(localizedMatch[1]),
      endRow: Number(localizedMatch[2]),
      startCol: columnLabelToNumber(localizedMatch[3]),
      endCol: columnLabelToNumber(localizedMatch[4]),
    };
  }

  return undefined;
}

export function buildLogicalTableIdAliasMap(options: TableIdResolutionOptions): Map<string, string> {
  const aliases = new Map<string, string>();
  const logicalTables = options.tableData?.logicalTables ?? [];
  if (logicalTables.length === 0) {
    return aliases;
  }

  const logicalByRange = new Map<string, string>();
  const logicalNameCounts = new Map<string, number>();
  const logicalByUniqueName = new Map<string, string>();

  for (const logicalTable of logicalTables) {
    aliases.set(logicalTable.id, logicalTable.id);
    logicalByRange.set(logicalRangeKey(logicalTable), logicalTable.id);
    const normalized = normalizeName(logicalTable.name);
    if (normalized) {
      logicalNameCounts.set(normalized, (logicalNameCounts.get(normalized) ?? 0) + 1);
    }
  }

  for (const logicalTable of logicalTables) {
    const normalized = normalizeName(logicalTable.name);
    if (normalized && logicalNameCounts.get(normalized) === 1) {
      logicalByUniqueName.set(normalized, logicalTable.id);
    }
  }

  for (const table of options.sheetStructure?.tables ?? []) {
    const resolvedByRange = logicalByRange.get(rangeKey(table.range) ?? "");
    const resolvedByName = logicalByUniqueName.get(normalizeName(table.title));
    const resolvedId = resolvedByRange ?? resolvedByName;
    if (resolvedId) {
      aliases.set(table.id, resolvedId);
    }
  }

  for (const table of options.sourceTables ?? []) {
    const resolvedByRange = logicalByRange.get(rangeKey(parseRangeLabel(table.rangeLabel)) ?? "");
    const resolvedByName = logicalByUniqueName.get(normalizeName(table.name));
    const resolvedId = resolvedByRange ?? resolvedByName;
    if (resolvedId) {
      aliases.set(table.id, resolvedId);
    }
  }

  return aliases;
}

export function resolveLogicalTableId(inputId: string | undefined, aliases: Map<string, string>): string | undefined {
  if (!inputId) return undefined;
  return aliases.get(inputId.trim()) ?? aliases.get(inputId) ?? undefined;
}

export function resolveLogicalTableIds(inputIds: string[] | undefined, aliases: Map<string, string>): string[] {
  if (!inputIds || inputIds.length === 0) return [];
  const resolved = inputIds.flatMap((inputId) => {
    const logicalId = resolveLogicalTableId(inputId, aliases);
    return logicalId ? [logicalId] : [];
  });
  return Array.from(new Set(resolved));
}
