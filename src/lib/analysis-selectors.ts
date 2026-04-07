import { buildChartRecommendations, buildChartRecommendationsForLogicalTables } from "@/lib/chart-recommendation";
import { buildLogicalTableIdAliasMap, resolveLogicalTableId } from "@/lib/table-id-resolution";
import { buildTableInsightFacts } from "@/lib/table-insight";
import { resolveTableFieldRoles } from "@/lib/table-utils";

function hasStoredFieldRoles(dimensions?: string[], metrics?: string[]): boolean {
  return (dimensions?.length ?? 0) > 0 || (metrics?.length ?? 0) > 0;
}
import type {
  AnalysisData,
  NarrativeItem,
  ReferenceLine,
  SourceTable,
  SummaryVariant,
  TableChartRecommendationCaptionItem,
  TableInsightCard,
  TableRelation,
  VisualizationBrief,
} from "@/lib/session-types";

function columnNumberToExcelLabel(value: number): string {
  let current = value;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label || "A";
}

function formatRangeLabel(startRow: number, endRow: number, startCol: number, endCol: number): string {
  return `${startRow}~${endRow}행, ${columnNumberToExcelLabel(startCol)}~${columnNumberToExcelLabel(endCol)}열`;
}

function formatHeaderSummary(
  axis: "row" | "column" | "mixed" | "ambiguous",
  headerRows?: number[],
  headerCols?: number[]
): string {
  switch (axis) {
    case "mixed":
      return `헤더: 상단 ${headerRows?.join(", ") || "-"}행 + 좌측 ${headerCols?.map(columnNumberToExcelLabel).join(", ") || "-"}열`;
    case "row":
      return `헤더: 상단 ${headerRows?.join(", ") || "-"}행`;
    case "column":
      return `헤더: 좌측 ${headerCols?.map(columnNumberToExcelLabel).join(", ") || "-"}열`;
    default:
      return "헤더: 구조 미확정";
  }
}

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

function tokenizeInsightText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}%.-]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidInsightText(value: string | undefined, validationTokens: string[]): boolean {
  const normalized = value?.trim();
  if (!normalized) return false;

  const allowed = new Set(validationTokens.map((token) => token.toLowerCase()));
  const numericTokens = tokenizeInsightText(normalized).filter((token) => /\d/.test(token));
  return numericTokens.every((token) => allowed.has(token));
}

function getValidatedSignificantNumbers(
  significantNumbers: string[] | undefined,
  fallback: string[],
  validationTokens: string[]
): string[] {
  const allowed = new Set(validationTokens.map((token) => token.toLowerCase()));
  const validated = (significantNumbers ?? []).filter((item) => {
    const normalized = item.trim();
    if (!normalized) return false;
    const numericTokens = tokenizeInsightText(normalized).filter((token) => /\d/.test(token));
    return numericTokens.every((token) => allowed.has(token));
  });

  return validated.length > 0 ? compactUnique(validated) : fallback;
}

function formatChartTypeLabel(chartType: string): string {
  switch (chartType) {
    case "bar":
      return "막대 차트";
    case "line":
      return "라인 차트";
    case "donut":
      return "도넛 차트";
    case "pie":
      return "파이 차트";
    case "stacked-bar":
      return "누적 막대 차트";
    case "map":
      return "지도 차트";
    default:
      return chartType;
  }
}

function formatChartRecommendationReason(reason: string): string {
  if (reason === "time_series") {
    return "시간 흐름에 따른 추세 변화를 비교하기에 적합합니다.";
  }
  if (reason === "category_compare") {
    return "범주별 수치 차이를 한눈에 비교하기에 적합합니다.";
  }
  if (reason === "part_to_whole") {
    return "전체 대비 각 항목의 구성 비중을 보여주기에 적합합니다.";
  }
  if (reason === "geo_compare") {
    return "지역별 분포와 차이를 직관적으로 보여주기에 적합합니다.";
  }
  if (reason.startsWith("split_by_")) {
    const splitKey = reason.slice("split_by_".length).trim();
    return splitKey
      ? `${splitKey} 기준으로 세부 구성을 나눠 비교하기에 적합합니다.`
      : "세부 구성을 나눠 비교하기에 적합합니다.";
  }
  return reason;
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

function stripListPrefix(value: string): string {
  return value.replace(/^[-•]\s*/, "").trim();
}

function getSectionLines(context: string, sectionName: string): string[] {
  const escapedSectionName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\[${escapedSectionName}\\]\\n([\\s\\S]*?)(?=\\n\\[[A-Z_]+\\]|$)`);
  const match = context.match(pattern);
  if (!match?.[1]) return [];

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasStructuredTableContext(context?: string | null): boolean {
  return Boolean(context && /\[(DATASET_META|LOGICAL_TABLES|COLUMN_PROFILES|FIELD_ROLES|CHART_HINTS|DATA_QUALITY|ROW_SAMPLES)\]/.test(context));
}

function summarizeFieldRoleLine(line: string): string {
  const normalized = stripListPrefix(line);
  const [label, rawValue] = normalized.split(":", 2);
  if (!rawValue) return normalized;

  const entries = rawValue.split("/").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length <= 2) return `${label.trim()}: ${entries.join(" / ")}`;
  return `${label.trim()}: ${entries.slice(0, 2).join(" / ")} 외 ${entries.length - 2}개`;
}

function getStructuredTableContextSummaryLines(context: string): string[] {
  const metaLines = getSectionLines(context, "DATASET_META")
    .map(stripListPrefix)
    .filter((line) => !line.startsWith("형식:") && !line.startsWith("열 이름:"));
  const roleLines = getSectionLines(context, "FIELD_ROLES")
    .slice(0, 2)
    .map(summarizeFieldRoleLine);
  const qualityLines = getSectionLines(context, "DATA_QUALITY")
    .map(stripListPrefix)
    .filter((line) => !line.startsWith("정규화 노트:"))
    .slice(0, 1);

  return compactUnique([...metaLines, ...roleLines, ...qualityLines]).slice(0, 5);
}

function getStructuredChartHintLines(context?: string | null): string[] {
  const normalized = context?.trim();
  if (!normalized || !hasStructuredTableContext(normalized)) return [];

  return getSectionLines(normalized, "CHART_HINTS")
    .map(stripListPrefix)
    .filter(Boolean)
    .filter((line) => !line.includes("뚜렷한 차트 힌트를 찾지 못했습니다"));
}

function parseStructuredChartHintLine(line: string): { chartType: string; rationale: string } | null {
  const match = line.match(/^(.+?)\s*\+\s*(.+?)\s*->\s*([a-z-]+)\s*\((.+)\)$/i);
  if (!match) return null;

  const [, dimension, metric, chartType, reason] = match;
  const normalizedChartType = chartType.trim();
  const normalizedReason = reason.trim();
  const rationale = formatChartRecommendationReason(normalizedReason);

  return {
    chartType: normalizedChartType,
    rationale: `${dimension.trim()}와 ${metric.trim()} 기준으로 ${rationale}`,
  };
}

function buildBestRecommendationByTable(
  analysisData: AnalysisData | null | undefined,
  tables: SourceTable[]
): Map<string, { chartType: string; rationale: string }> {
  const validTableIds = tables.map((table) => table.id);
  const bestRecommendationByTable = new Map<string, { chartType: string; rationale: string }>();
  const tableIdSet = new Set(validTableIds);
  const bestScoreByTable = new Map<string, number>();

  for (const recommendation of analysisData?.chartRecommendations ?? []) {
    const tableId = recommendation.tableId?.trim();
    if (!tableId || !tableIdSet.has(tableId)) continue;
    const currentBestScore = bestScoreByTable.get(tableId) ?? Number.NEGATIVE_INFINITY;
    if (recommendation.score <= currentBestScore) continue;
    bestScoreByTable.set(tableId, recommendation.score);
    bestRecommendationByTable.set(tableId, {
      chartType: recommendation.chartType,
      rationale: formatChartRecommendationReason(recommendation.reason),
    });
  }

  const logicalTables = analysisData?.tableData?.logicalTables ?? [];
  if (logicalTables.length > 0) {
    for (const logicalTable of logicalTables) {
      if (!tableIdSet.has(logicalTable.id) || bestRecommendationByTable.has(logicalTable.id)) continue;
      const bestRecommendation = buildChartRecommendations({ columns: logicalTable.columns, rows: logicalTable.rows })[0];
      if (!bestRecommendation) continue;
      bestRecommendationByTable.set(logicalTable.id, {
        chartType: bestRecommendation.chartType,
        rationale: formatChartRecommendationReason(bestRecommendation.reason),
      });
    }
  } else if (analysisData?.tableData && validTableIds.length === 1 && !bestRecommendationByTable.has(validTableIds[0])) {
    const bestRecommendation = buildChartRecommendations(analysisData.tableData)[0];
    if (bestRecommendation) {
      bestRecommendationByTable.set(validTableIds[0], {
        chartType: bestRecommendation.chartType,
        rationale: formatChartRecommendationReason(bestRecommendation.reason),
      });
    }
  }

  for (const table of tables) {
    if (bestRecommendationByTable.has(table.id)) continue;
    bestRecommendationByTable.set(table.id, buildGenericFallbackRecommendation(table));
  }

  return bestRecommendationByTable;
}

function buildGenericFallbackRecommendation(table: SourceTable): { chartType: string; rationale: string } {
  if (table.metrics.length > 0 && table.dimensions.length > 0) {
    return {
      chartType: "bar",
      rationale: `${table.dimensions[0]} 기준으로 ${table.metrics[0]} 값을 비교하기에 적합합니다.`,
    };
  }

  if (table.metrics.length > 0) {
    return {
      chartType: "bar",
      rationale: `${table.metrics[0]} 중심의 수치 차이를 비교하기에 적합합니다.`,
    };
  }

  if (table.dimensions.length > 0) {
    return {
      chartType: "bar",
      rationale: `${table.dimensions[0]} 중심의 범주 구성을 비교하기에 적합합니다.`,
    };
  }

  return {
    chartType: "bar",
    rationale: "표의 핵심 값들을 비교해 보여주기에 가장 기본적인 형태입니다.",
  };
}

function toDisplaySafeTableContext(context?: string | null): string {
  const normalized = context?.trim();
  if (!normalized) return "";
  if (!hasStructuredTableContext(normalized)) return normalized;

  const metaSummary = getStructuredTableContextSummaryLines(normalized)
    .filter((line) => line.startsWith("논리 표 수:") || line.startsWith("대표 표:") || line.startsWith("행 수:"))
    .join(" · ");

  return metaSummary || getStructuredTableContextSummaryLines(normalized).join(" · ");
}

function deriveSourceTables(analysisData?: AnalysisData | null): SourceTable[] {
  const aliases = buildLogicalTableIdAliasMap({
    tableData: analysisData?.tableData,
    sheetStructure: analysisData?.sheetStructure,
    sourceTables: analysisData?.sourceInventory?.tables,
  });

  if (analysisData?.sheetStructure?.tables?.length) {
    const primaryTableId = resolveLogicalTableId(analysisData?.visualizationBrief?.primaryTableId, aliases)
      ?? resolveLogicalTableId(analysisData.sheetStructure.tables[0]?.id, aliases)
      ?? analysisData.sheetStructure.tables[0]?.id;
    const tables = analysisData.sheetStructure.tables.map((table) => {
      const resolvedId = resolveLogicalTableId(table.id, aliases) ?? table.id;
      const matchingLogicalTable = analysisData?.tableData?.logicalTables?.find((candidate) => candidate.id === resolvedId);
      const fieldRoles = hasStoredFieldRoles(table.dimensions, table.metrics)
        ? { dimensions: table.dimensions, metrics: table.metrics }
        : matchingLogicalTable
          ? resolveTableFieldRoles(matchingLogicalTable)
          : { dimensions: table.dimensions, metrics: table.metrics };
      return {
        id: resolvedId,
      name: table.title,
        role: resolvedId === primaryTableId ? "primary" as const : table.structure === "column-major" ? "reference" as const : "supporting" as const,
      purpose:
        table.structure === "mixed"
          ? "행과 열 헤더가 혼합된 표 구조 파악"
          : table.structure === "column-major"
            ? "열 방향 표 구조 파악"
            : table.structure === "ambiguous"
              ? "구조가 애매한 표 후보 검토"
              : "행 방향 표 구조 파악",
      context: `${table.range.startRow}-${table.range.endRow}행, ${table.range.startCol}-${table.range.endCol}열 범위의 구조화 표입니다.`,
      dimensions: fieldRoles.dimensions,
      metrics: fieldRoles.metrics,
      grain: table.structure,
        keyTakeaway: resolvedId === primaryTableId ? analysisData?.summaries[0]?.lines?.[0]?.text : undefined,
      structure: table.structure,
      rangeLabel: formatRangeLabel(table.range.startRow, table.range.endRow, table.range.startCol, table.range.endCol),
      headerSummary: formatHeaderSummary(table.header.axis, table.header.headerRows, table.header.headerCols),
      };
    });
    return Array.from(new Map(tables.map((table) => [table.id, table])).values());
  }

  if (analysisData?.sourceInventory?.tables && analysisData.sourceInventory.tables.length > 0) {
    return analysisData.sourceInventory.tables.map((table) => ({
      ...table,
      context: toDisplaySafeTableContext(table.context),
    }));
  }

  const tableData = analysisData?.tableData;
  if (!tableData) return [];

  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    const primaryLogicalTableId = tableData.primaryLogicalTableId ?? tableData.logicalTables[0]?.id;
    return tableData.logicalTables.map((table) => {
      const normalizedStructure = table.localStructureHint?.winner ?? table.orientation;
      const fieldRoles = resolveTableFieldRoles(table);
      return {
        id: table.id,
        name: table.name,
        role: table.id === primaryLogicalTableId ? "primary" : normalizedStructure === "column-major" ? "reference" : "supporting",
        purpose: normalizedStructure === "mixed" ? "행과 열 헤더가 혼합된 표 구조 파악" : normalizedStructure === "column-major" ? "열 방향 표 구조 파악" : normalizedStructure === "ambiguous" ? "구조가 애매한 표 후보 검토" : "행 방향 표 구조 파악",
        context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열 범위의 논리 표입니다.`,
        dimensions: fieldRoles.dimensions,
        metrics: fieldRoles.metrics,
        grain: normalizedStructure,
        keyTakeaway: table.id === primaryLogicalTableId ? analysisData?.summaries[0]?.lines?.[0]?.text : undefined,
      };
    });
  }

  const fieldRoles = resolveTableFieldRoles({
    columns: tableData.columns,
    rows: tableData.rows,
    rowCount: tableData.rowCount,
    columnCount: tableData.columnCount,
  });
  return [
    {
      id: "table-1",
      name: tableData.sheetName?.trim() || analysisData?.title?.trim() || "기본 표",
      role: "primary",
      purpose: "핵심 데이터 구조 파악",
      context: toDisplaySafeTableContext(analysisData?.tableContext) || "업로드된 표의 핵심 구조와 수치를 해석하기 위한 기본 표입니다.",
      dimensions: fieldRoles.dimensions,
      metrics: fieldRoles.metrics,
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
  const selectedSourceTableIds = analysisData?.selectedSourceTableIds?.length
    ? compactUnique(analysisData.selectedSourceTableIds)
    : compactUnique(tables.map((table) => table.id));
  const primaryTableId = selectedSourceTableIds[0] ?? tables[0]?.id ?? "table-1";
  const headline = analysisData?.title?.trim() || analysisData?.dataset?.title?.trim() || "데이터 인포그래픽 기획안";
  const coreMessage =
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    analysisData?.summaries[1]?.lines?.[0]?.text ||
    toDisplaySafeTableContext(analysisData?.tableContext) ||
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
    supportingTableIds: selectedSourceTableIds.filter((tableId) => tableId !== primaryTableId),
    storyFlow: storyFlow.length > 0 ? storyFlow : ["핵심 흐름 파악", "비교 포인트 정리", "실무 시사점 제안"],
    chartDirections: (analysisData?.chartRecommendations ?? []).slice(0, 3).map((item, index) => ({
      tableId: item.tableId?.trim() || primaryTableId,
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
    toDisplaySafeTableContext(analysisData?.dataset?.summary) ||
    analysisData?.summaries[1]?.lines?.[0]?.text ||
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    toDisplaySafeTableContext(analysisData?.tableContext) ||
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

export function getAskNext(analysisData?: AnalysisData | null): string[] {
  if (analysisData?.askNext && analysisData.askNext.length > 0) {
    return compactUnique(analysisData.askNext).slice(0, 3);
  }
  return parseLegacyQuestions(analysisData?.insights);
}

export function getVisualizationBrief(analysisData?: AnalysisData | null): VisualizationBrief | undefined {
  return deriveVisualizationBrief(analysisData);
}

export function getTableInsightCards(analysisData?: AnalysisData | null): TableInsightCard[] {
  const sourceTables = deriveSourceTables(analysisData);
  const tableData = analysisData?.tableData;
  if (sourceTables.length === 0 || !tableData) return [];

  const aliases = buildLogicalTableIdAliasMap({
    tableData,
    sheetStructure: analysisData?.sheetStructure,
    sourceTables: analysisData?.sourceInventory?.tables,
  });
  const sourceTableById = new Map(sourceTables.map((table) => [table.id, table]));
  const primaryTableId = analysisData?.visualizationBrief?.primaryTableId && sourceTableById.has(analysisData.visualizationBrief.primaryTableId)
    ? analysisData.visualizationBrief.primaryTableId
    : sourceTables[0]?.id;

  const logicalTables = tableData.logicalTables && tableData.logicalTables.length > 0
    ? tableData.logicalTables.map((table) => ({
        id: resolveLogicalTableId(table.id, aliases) ?? table.id,
        name: table.name,
        columns: table.columns,
        rows: table.rows,
      }))
    : [{
        id: sourceTables[0]?.id ?? "table-1",
        name: sourceTables[0]?.name ?? analysisData?.title?.trim() ?? "기본 표",
        columns: tableData.columns,
        rows: tableData.rows,
      }];

  const interpretationByTableId = new Map(
    (analysisData?.tableInterpretations ?? []).map((item) => [item.tableId, item])
  );

  return logicalTables
    .map((table) => {
      const sourceTable = sourceTableById.get(table.id);
      const facts = buildTableInsightFacts({
        tableId: table.id,
        tableName: sourceTable?.name ?? table.name,
        columns: table.columns,
        rows: table.rows,
        dimensions: sourceTable?.dimensions,
        metrics: sourceTable?.metrics,
      });
      if (!facts) return null;

      const interpretation = interpretationByTableId.get(table.id);
      const fallbackInsight = `${facts.tableName}에서는 ${facts.metricName} 기준 차이가 확인됩니다.`;
      const fallbackSignificantNumbers = facts.notableFacts.slice(0, 3);
      const geminiInsight = interpretation?.insight?.trim();
      const geminiSignificantNumbers = interpretation?.significantNumbers ?? [];
      const validatedInsight = isValidInsightText(geminiInsight, facts.validationTokens) ? geminiInsight : fallbackInsight;
      const validatedSignificantNumbers = getValidatedSignificantNumbers(
        geminiSignificantNumbers,
        fallbackSignificantNumbers,
        facts.validationTokens
      );

      return {
        tableId: table.id,
        tableName: sourceTable?.name ?? table.name,
        insight: validatedInsight,
        significantNumbers: validatedSignificantNumbers,
        metricName: facts.metricName,
        maxLabel: facts.max.label,
        maxValue: facts.max.rawValue,
        minLabel: facts.min.label,
        minValue: facts.min.rawValue,
      };
    })
    .filter((card): card is TableInsightCard => card !== null)
    .sort((left, right) => {
      if (left.tableId === primaryTableId) return -1;
      if (right.tableId === primaryTableId) return 1;
      return 0;
    });
}

export function getTableChartRecommendationCaptionItems(
  analysisData?: AnalysisData | null
): TableChartRecommendationCaptionItem[] {
  const tables = deriveSourceTables(analysisData);
  if (tables.length === 0) return [];

  const tableNameById = new Map(tables.map((table) => [table.id, table.name]));
  const topRecommendationByTable = buildBestRecommendationByTable(analysisData, tables);

  return tables
    .map((table) => {
      const recommendation = topRecommendationByTable.get(table.id);
      if (!recommendation) return null;

      return {
        tableId: table.id,
        tableTitle: tableNameById.get(table.id) ?? table.name,
        recommendedChart: formatChartTypeLabel(recommendation.chartType),
        rationale: recommendation.rationale,
      };
    })
    .filter((item): item is TableChartRecommendationCaptionItem => item !== null);
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

  if (hasStructuredTableContext(context)) {
    return getStructuredTableContextSummaryLines(context);
  }

  return compactUnique(context.split(/\n+/)).slice(0, 5);
}
