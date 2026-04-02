import type {
  AnalysisData,
  NarrativeItem,
  ReferenceLine,
  SourceTable,
  SummaryVariant,
  TableRelation,
  VisualizationBrief,
} from "@/lib/session-types";

function compactUnique(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseLegacyQuestions(insights?: string): string[] {
  if (!insights?.trim()) return [];
  const raw = insights.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return compactUnique(parsed.filter((item): item is string => typeof item === "string")).slice(0, 3);
      }
    } catch {
    }
  }
  return compactUnique(raw.split(/\n+|\s+(?=\d+[.)]\s*)|[;|]/)).slice(0, 3);
}

function getSectionLines(text: string, sectionName: string): string[] {
  const marker = `[${sectionName}]`;
  const startIndex = text.indexOf(marker);
  if (startIndex < 0) return [];
  const remainder = text.slice(startIndex + marker.length);
  const nextSectionIndex = remainder.search(/\n\[[A-Z_]+\]/);
  const sectionBody = nextSectionIndex >= 0 ? remainder.slice(0, nextSectionIndex) : remainder;
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("- "));
}

function linesToNarrative(lines?: ReferenceLine[]): NarrativeItem[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => ({
    text: line.text,
    sourceTableIds: [],
    evidence: line.pages.length > 0 ? [{ tableId: "table-1", rowHints: [], pages: line.pages }] : [],
  }));
}

function narrativeToLines(items?: NarrativeItem[]): ReferenceLine[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const text = item.text?.trim();
      if (!text) return null;
      const pages = compactUnique(
        item.evidence?.flatMap((entry) => entry.pages.map((page) => String(page))) ?? []
      ).map((page) => Number(page)).filter((page) => Number.isFinite(page) && page > 0);
      return { text, pages };
    })
    .filter((item): item is ReferenceLine => item !== null);
}

function deriveSourceTables(analysisData?: AnalysisData | null): SourceTable[] {
  if (analysisData?.sheetStructure?.tables?.length) {
    const primaryTableId = analysisData?.visualizationBrief?.primaryTableId ?? analysisData.sheetStructure.tables[0]?.id;
    return analysisData.sheetStructure.tables.map((table, index) => ({
      id: table.id,
      name: table.title,
      role: table.id === primaryTableId ? "primary" : table.structure === "column-major" ? "reference" : "supporting",
      purpose:
        table.structure === "mixed"
          ? "행과 열 헤더가 혼합된 표 구조 파악"
          : table.structure === "column-major"
            ? "열 방향 표 구조 파악"
            : table.structure === "ambiguous"
              ? "구조가 애매한 표 후보 검토"
              : "행 방향 표 구조 파악",
      context: `${table.range.startRow}-${table.range.endRow}행, ${table.range.startCol}-${table.range.endCol}열 범위의 구조화 표입니다.`,
      dimensions: table.dimensions,
      metrics: table.metrics,
      grain: table.structure,
      keyTakeaway: table.id === primaryTableId ? analysisData?.summaries[0]?.lines?.[0]?.text : undefined,
      structure: table.structure,
      rangeLabel: `R${table.range.startRow}-R${table.range.endRow} / C${table.range.startCol}-C${table.range.endCol}`,
      headerSummary:
        table.header.axis === "mixed"
          ? `행 헤더 ${table.header.headerRows?.join(", ") || "-"}, 열 헤더 ${table.header.headerCols?.join(", ") || "-"}`
          : table.header.axis === "row"
            ? `헤더 행 ${table.header.headerRows?.join(", ") || "-"}`
            : table.header.axis === "column"
              ? `헤더 열 ${table.header.headerCols?.join(", ") || "-"}`
              : "헤더 축이 불명확함",
    }));
  }

  if (analysisData?.sourceInventory?.tables && analysisData.sourceInventory.tables.length > 0) {
    return analysisData.sourceInventory.tables;
  }

  const tableData = analysisData?.tableData;
  if (!tableData) return [];

  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    const primaryLogicalTableId = tableData.primaryLogicalTableId ?? tableData.logicalTables[0]?.id;
    return tableData.logicalTables.map((table, index) => ({
      id: table.id,
      name: table.name,
      role: table.id === primaryLogicalTableId ? "primary" : table.orientation === "column-major" ? "reference" : "supporting",
      purpose: table.orientation === "column-major" ? "열 방향 표 구조 파악" : "행 방향 표 구조 파악",
      context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열 범위의 논리 표입니다.`,
      dimensions: table.columns.slice(0, 2),
      metrics: table.columns.slice(2),
      grain: table.orientation,
      keyTakeaway: table.id === primaryLogicalTableId ? analysisData?.summaries[0]?.lines?.[0]?.text : undefined,
    }));
  }

  const dimensionCandidates = tableData.columns.slice(0, 2);
  const metricCandidates = tableData.columns.slice(2);
  return [
    {
      id: "table-1",
      name: tableData.sheetName?.trim() || analysisData?.title?.trim() || "기본 표",
      role: "primary",
      purpose: "핵심 데이터 구조 파악",
      context: analysisData?.tableContext?.trim() || "업로드된 표의 핵심 구조와 수치를 해석하기 위한 기본 표입니다.",
      dimensions: dimensionCandidates,
      metrics: metricCandidates,
      grain: tableData.sheetName ? "sheet" : undefined,
      keyTakeaway: analysisData?.summaries[0]?.lines?.[0]?.text,
    },
  ];
}

function deriveNarrativeItems(
  current: NarrativeItem[] | undefined,
  fallbackSummary?: SummaryVariant,
  fallbackIssues?: string | ReferenceLine[]
): NarrativeItem[] {
  if (current && current.length > 0) return current;
  if (fallbackSummary) {
    const fromLines = linesToNarrative(fallbackSummary.lines);
    if (fromLines.length > 0) return fromLines;
    if (fallbackSummary.content?.trim()) {
      return [{ text: fallbackSummary.content.trim(), sourceTableIds: [], evidence: [] }];
    }
  }
  if (fallbackIssues) {
    if (Array.isArray(fallbackIssues)) return linesToNarrative(fallbackIssues);
    if (fallbackIssues.trim()) return [{ text: fallbackIssues.trim(), sourceTableIds: [], evidence: [] }];
  }
  return [];
}

function deriveVisualizationBrief(analysisData?: AnalysisData | null): VisualizationBrief | undefined {
  if (analysisData?.visualizationBrief) {
    return analysisData.visualizationBrief;
  }

  const tables = deriveSourceTables(analysisData);
  const primaryTableId = tables[0]?.id ?? "table-1";
  const headline = analysisData?.title?.trim() || analysisData?.dataset?.title?.trim() || "데이터 인포그래픽 기획안";
  const coreMessage =
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    analysisData?.summaries[1]?.lines?.[0]?.text ||
    analysisData?.tableContext?.trim() ||
    "핵심 변화와 비교 포인트가 잘 드러나는 구조로 정리합니다.";

  const storyFlow = compactUnique([
    analysisData?.summaries[0]?.title,
    analysisData?.summaries[1]?.title,
    Array.isArray(analysisData?.issues) ? analysisData?.issues[0]?.text : analysisData?.issues,
  ]).slice(0, 3);

  return {
    headline,
    coreMessage,
    primaryTableId,
    supportingTableIds: tables.slice(1).map((table) => table.id),
    storyFlow: storyFlow.length > 0 ? storyFlow : ["핵심 흐름 파악", "비교 포인트 정리", "실무 시사점 제안"],
    chartDirections: (analysisData?.chartRecommendations ?? []).slice(0, 3).map((item, index) => ({
      tableId: primaryTableId,
      chartType: item.chartType,
      goal: item.reason || `추천 차트 ${index + 1}`,
    })),
    tone: "practical",
    prompt: analysisData?.infographicPrompt?.trim() || analysisData?.generatedInfographicPrompt?.trim() || undefined,
  };
}

export function getAnalysisTitle(analysisData?: AnalysisData | null, fallbackTitle = "데이터 요약"): string {
  return analysisData?.dataset?.title?.trim() || analysisData?.title?.trim() || fallbackTitle;
}

export function getDatasetSummary(analysisData?: AnalysisData | null): string {
  return (
    analysisData?.dataset?.summary?.trim() ||
    analysisData?.summaries[1]?.lines?.[0]?.text ||
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    analysisData?.tableContext?.trim() ||
    ""
  );
}

export function getSourceTables(analysisData?: AnalysisData | null): SourceTable[] {
  return deriveSourceTables(analysisData);
}

export function getTableRelations(analysisData?: AnalysisData | null): TableRelation[] {
  return analysisData?.sourceInventory?.relations ?? [];
}

export function getFindings(analysisData?: AnalysisData | null): NarrativeItem[] {
  return deriveNarrativeItems(analysisData?.findings, analysisData?.summaries[0]);
}

export function getImplications(analysisData?: AnalysisData | null): NarrativeItem[] {
  return deriveNarrativeItems(analysisData?.implications, analysisData?.summaries[1]);
}

export function getCautions(analysisData?: AnalysisData | null): NarrativeItem[] {
  return deriveNarrativeItems(analysisData?.cautions, undefined, analysisData?.issues);
}

export function getAskNext(analysisData?: AnalysisData | null): string[] {
  if (analysisData?.askNext && analysisData.askNext.length > 0) {
    return compactUnique(analysisData.askNext).slice(0, 3);
  }
  return parseLegacyQuestions(analysisData?.insights);
}

export function getVisualizationBrief(analysisData?: AnalysisData | null): VisualizationBrief | undefined {
  return deriveVisualizationBrief(analysisData);
}

export function getVisualizationPrompt(analysisData?: AnalysisData | null): string {
  const brief = deriveVisualizationBrief(analysisData);
  if (!brief) return "";
  return (
    brief.prompt?.trim() ||
    compactUnique([
      brief.headline,
      brief.coreMessage,
      ...brief.storyFlow,
      ...brief.chartDirections.map((item) => `${item.chartType}: ${item.goal}`),
    ]).join(" ")
  );
}

export function getFindingsSummaryVariant(analysisData?: AnalysisData | null): SummaryVariant | undefined {
  const lines = narrativeToLines(getFindings(analysisData)).slice(0, 3);
  if (lines.length === 0) return analysisData?.summaries[0];
  return { title: "핵심 신호", lines };
}

export function getImplicationsSummaryVariant(analysisData?: AnalysisData | null): SummaryVariant | undefined {
  const lines = narrativeToLines(getImplications(analysisData)).slice(0, 4);
  if (lines.length === 0) return analysisData?.summaries[1];
  return { title: "실무 시사점", lines };
}

export function getCautionReferenceLines(analysisData?: AnalysisData | null): string | ReferenceLine[] {
  const lines = narrativeToLines(getCautions(analysisData));
  if (lines.length > 0) return lines;
  return analysisData?.issues ?? "";
}

export function getLegacyKeywordFallback(analysisData?: AnalysisData | null): string[] {
  if (analysisData?.keywords?.length) return analysisData.keywords;
  const tables = deriveSourceTables(analysisData);
  return compactUnique([
    ...tables.flatMap((table) => [table.name, ...table.dimensions, ...table.metrics]),
  ]).slice(0, 6);
}

export function getTableContextHighlights(analysisData?: AnalysisData | null): string[] {
  if (analysisData?.sheetStructure?.tables?.length) {
    const structureLines = analysisData.sheetStructure.tables.map((table) => {
      const rangeLabel = `R${table.range.startRow}-R${table.range.endRow} / C${table.range.startCol}-C${table.range.endCol}`;
      const headerSummary =
        table.header.axis === "mixed"
          ? `행 헤더 ${table.header.headerRows?.join(", ") || "-"}, 열 헤더 ${table.header.headerCols?.join(", ") || "-"}`
          : table.header.axis === "row"
            ? `헤더 행 ${table.header.headerRows?.join(", ") || "-"}`
            : table.header.axis === "column"
              ? `헤더 열 ${table.header.headerCols?.join(", ") || "-"}`
              : "헤더 축이 불명확함";
      return `${table.title}: ${table.structure}, ${rangeLabel}, ${headerSummary}`;
    });

    return compactUnique([
      `표 수 ${analysisData.sheetStructure.tableCount}`,
      ...structureLines,
    ]).slice(0, 5);
  }

  const context = analysisData?.tableContext?.trim();
  if (!context) return [];

  const metaLines = getSectionLines(context, "DATASET_META")
    .filter((line) => !line.includes("형식:"))
    .map((line) => line.replace(/^-\s*/, ""));
  const roleLines = getSectionLines(context, "FIELD_ROLES")
    .slice(0, 2)
    .map((line) => line.replace(/^-\s*/, ""));
  const qualityLines = getSectionLines(context, "DATA_QUALITY")
    .slice(0, 1)
    .map((line) => line.replace(/^-\s*/, ""));

  return compactUnique([...metaLines, ...roleLines, ...qualityLines]).slice(0, 5);
}
