import type { AnalysisData, AnalysisSheetStructure, NarrativeItem, TableInterpretationResult } from "@/lib/session-types";

function deduplicateNarratives(items: NarrativeItem[]): NarrativeItem[] {
  const map = new Map<string, NarrativeItem>();

  for (const item of items) {
    const key = item.text.trim();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    map.set(key, {
      ...existing,
      sourceTableIds: Array.from(new Set([...(existing.sourceTableIds ?? []), ...(item.sourceTableIds ?? [])])),
      evidence: [...(existing.evidence ?? []), ...(item.evidence ?? [])],
    });
  }

  return [...map.values()];
}

function rangesOverlap(
  left: { startRow: number; endRow: number; startCol: number; endCol: number },
  right: { startRow: number; endRow: number; startCol: number; endCol: number }
) {
  const rowOverlap = left.startRow <= right.endRow && right.startRow <= left.endRow;
  const colOverlap = left.startCol <= right.endCol && right.startCol <= left.endCol;
  return rowOverlap && colOverlap;
}

export function validateSheetStructure(
  structure: { sheetStructure?: AnalysisSheetStructure },
  grid: string[][]
): { ok: boolean; reason?: string } {
  const sheetStructure = structure.sheetStructure;
  if (!sheetStructure) return { ok: false, reason: "sheetStructure missing" };

  const tables = sheetStructure.tables ?? [];
  const maxRow = grid.length;
  const maxCol = Math.max(0, ...grid.map((row) => row.length));

  if (sheetStructure.tableCount !== tables.length) {
    return { ok: false, reason: "tableCount mismatch" };
  }

  for (const table of tables) {
    const range = table.range;
    if (range.startRow > range.endRow || range.startCol > range.endCol) {
      return { ok: false, reason: `${table.id}: invalid range order` };
    }
    if (range.startRow < 1 || range.startCol < 1 || range.endRow > maxRow || range.endCol > maxCol) {
      return { ok: false, reason: `${table.id}: range outside grid` };
    }
    if (!["row-major", "column-major", "mixed", "ambiguous"].includes(table.structure)) {
      return { ok: false, reason: `${table.id}: invalid structure` };
    }

    const dataRegion = table.dataRegion;
    if (dataRegion) {
      if (dataRegion.startRow > dataRegion.endRow || dataRegion.startCol > dataRegion.endCol) {
        return { ok: false, reason: `${table.id}: invalid dataRegion order` };
      }
      if (
        dataRegion.startRow < range.startRow ||
        dataRegion.endRow > range.endRow ||
        dataRegion.startCol < range.startCol ||
        dataRegion.endCol > range.endCol
      ) {
        return { ok: false, reason: `${table.id}: dataRegion outside range` };
      }
    }
  }

  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      if (rangesOverlap(tables[i].range, tables[j].range)) {
        return { ok: false, reason: `${tables[i].id} overlaps ${tables[j].id}` };
      }
    }
  }

  return { ok: true };
}

export function mergeTableInterpretations(
  structure: { sheetStructure: AnalysisSheetStructure },
  results: TableInterpretationResult[]
): Partial<AnalysisData> {
  const findings = deduplicateNarratives(results.flatMap((result) => result.findings));
  const implications = deduplicateNarratives(results.flatMap((result) => result.implications));
  const cautions = deduplicateNarratives(results.flatMap((result) => result.cautions));

  return {
    sheetStructure: structure.sheetStructure,
    findings,
    implications,
    cautions,
    generatedInfographicPrompt: results.find((result) => result.infographicPrompt?.trim())?.infographicPrompt,
    infographicPrompt: results.find((result) => result.infographicPrompt?.trim())?.infographicPrompt,
    tableInterpretations: results,
  };
}
