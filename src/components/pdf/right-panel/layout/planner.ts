import type {
  AnalysisData,
  AnalysisSheetStructure,
  AnalysisStructuredTable,
  ChartRecommendation,
  LayoutAspectRatio,
  LayoutChartType,
  LayoutPlan,
  LayoutSection,
  NarrativeItem,
  SourceTable,
  TableInterpretationResult,
} from "@/lib/session-types";
import { buildLogicalTableIdAliasMap, resolveLogicalTableId } from "@/lib/table-id-resolution";
import { buildChartRecommendationsForLogicalTables } from "@/lib/chart-recommendation";
import { buildLayoutDataSnippet, type TableData } from "@/lib/table-utils";

interface PlannerTableInput {
  tableId: string;
  name: string;
  role: SourceTable["role"];
  structure?: SourceTable["structure"];
  headerSummary?: string;
  rangeLabel?: string;
  dimensions: string[];
  metrics: string[];
  chartHint?: {
    chartType: ChartRecommendation["chartType"];
    dimension?: string;
    metric?: string;
    goal: string;
  };
  dataSnippet?: ReturnType<typeof buildLayoutDataSnippet>;
}

export interface PlannerInput {
  title: string;
  tables: PlannerTableInput[];
  selectedSourceTableIds?: string[];
  chartRecommendations?: ChartRecommendation[];
  findings?: NarrativeItem[];
  implications?: NarrativeItem[];
}

interface BuildPlannerInputParams {
  title: string;
  sheetStructure: AnalysisSheetStructure;
  sourceTables?: SourceTable[];
  selectedSourceTableIds?: string[];
  chartRecommendations?: ChartRecommendation[];
  tableData?: TableData;
  findings?: NarrativeItem[];
  implications?: NarrativeItem[];
}

function formatHeaderSummary(table: AnalysisStructuredTable): string | undefined {
  const axis = table.header.axis;
  if (axis === "mixed") {
    const headerRows = table.header.headerRows?.join(", ") || "-";
    const headerCols = table.header.headerCols?.join(", ") || "-";
    return `상단 ${headerRows}행 + 좌측 ${headerCols}열 헤더`;
  }
  if (axis === "row") {
    return `상단 ${table.header.headerRows?.join(", ") || "-"}행 헤더`;
  }
  if (axis === "column") {
    return `좌측 ${table.header.headerCols?.join(", ") || "-"}열 헤더`;
  }
  return undefined;
}

function formatRangeLabel(table: AnalysisStructuredTable): string {
  return `R${table.range.startRow}-R${table.range.endRow} / C${table.range.startCol}-C${table.range.endCol}`;
}

function getBestChartHintForTable(params: {
  chartRecommendations?: AnalysisData["chartRecommendations"];
  tableId: string;
  aliases: Map<string, string>;
  tableData?: TableData;
}): PlannerTableInput["chartHint"] {
  const matchingRecommendations = (params.chartRecommendations ?? [])
    .flatMap((recommendation) => {
      const resolvedTableId = resolveLogicalTableId(recommendation.tableId, params.aliases) ?? recommendation.tableId;
      if (resolvedTableId !== params.tableId) return [];
      return [{ ...recommendation, tableId: resolvedTableId }];
    })
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType));

  const bestRecommendation = matchingRecommendations[0];
  if (bestRecommendation) {
    return {
      chartType: bestRecommendation.chartType,
      dimension: bestRecommendation.dimension,
      metric: bestRecommendation.metric,
      goal: bestRecommendation.reason,
    };
  }

  if (params.tableData) {
    const regenerated = buildChartRecommendationsForLogicalTables(params.tableData, [params.tableId])
      .filter((recommendation) => recommendation.tableId === params.tableId)
      .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType))[0];
    if (regenerated) {
      return {
        chartType: regenerated.chartType,
        dimension: regenerated.dimension,
        metric: regenerated.metric,
        goal: regenerated.reason,
      };
    }
  }

  return undefined;
}

export function hasReadyPlannerInputs(params: {
  status?: AnalysisData["status"];
  sheetStructure?: AnalysisSheetStructure;
  reviewReasons?: string[];
  tableInterpretations?: TableInterpretationResult[];
}) {
  if (params.status !== "complete") return false;
  if (!params.sheetStructure || params.sheetStructure.tables.length === 0) return false;
  if (params.sheetStructure.needsReview || (params.reviewReasons?.length ?? 0) > 0) return false;
  return (params.tableInterpretations?.length ?? 0) === params.sheetStructure.tables.length;
}

export function buildPlannerInput(params: BuildPlannerInputParams): PlannerInput {
  const aliases = buildLogicalTableIdAliasMap({
    tableData: params.tableData,
    sheetStructure: params.sheetStructure,
    sourceTables: params.sourceTables,
  });
  const sourceTableById = new Map(
    (params.sourceTables ?? []).map((table) => [resolveLogicalTableId(table.id, aliases) ?? table.id, table])
  );
  const logicalTableById = new Map(
    (params.tableData?.logicalTables ?? []).map((table) => [resolveLogicalTableId(table.id, aliases) ?? table.id, table])
  );

  const tables = params.sheetStructure.tables
    .flatMap((table) => {
      const resolvedTableId = resolveLogicalTableId(table.id, aliases) ?? table.id;
      const sourceTable = sourceTableById.get(resolvedTableId);
      const plannerTableData = logicalTableById.get(resolvedTableId)
        ?? (logicalTableById.size === 0 && params.tableData ? params.tableData : undefined);

      return [{
        tableId: resolvedTableId,
        name: sourceTable?.name || table.title,
        role: sourceTable?.role ?? (params.sheetStructure.tables[0]?.id === table.id ? "primary" : "supporting"),
        structure: table.structure,
        headerSummary: formatHeaderSummary(table),
        rangeLabel: formatRangeLabel(table),
        dimensions: table.dimensions,
        metrics: table.metrics,
        chartHint: getBestChartHintForTable({
          chartRecommendations: params.chartRecommendations,
          tableId: resolvedTableId,
          aliases,
          tableData: params.tableData,
        }),
        dataSnippet: plannerTableData ? buildLayoutDataSnippet(plannerTableData) : undefined,
      } satisfies PlannerTableInput];
    })
    .filter(
      (table) =>
        table.dimensions.length > 0 ||
        table.metrics.length > 0 ||
        table.chartHint
    );

  return {
    title: params.title,
    tables,
    selectedSourceTableIds: params.selectedSourceTableIds,
    chartRecommendations: params.chartRecommendations,
    findings: params.findings,
    implications: params.implications,
  };
}

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isTimeLikeDimension(value?: string): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  return ["date", "time", "month", "year", "day", "week", "quarter", "날짜", "일자", "월", "연도", "주", "분기"].some((token) => normalized.includes(token));
}

function inferChartType(table: PlannerTableInput, recommendations: ChartRecommendation[]): LayoutChartType {
  if (table.chartHint?.chartType) {
    return table.chartHint.chartType;
  }

  const matchingRecommendation = recommendations.find((recommendation) => recommendation.tableId === table.tableId);
  if (matchingRecommendation) {
    return matchingRecommendation.chartType;
  }

  const primaryDimension = table.dimensions[0];
  if (isTimeLikeDimension(primaryDimension)) return "line";
  return "bar";
}

function inferDimension(table: PlannerTableInput, recommendations: ChartRecommendation[]): string | undefined {
  return normalizeText(table.chartHint?.dimension)
    ?? normalizeText(recommendations.find((recommendation) => recommendation.tableId === table.tableId)?.dimension)
    ?? normalizeText(table.dimensions[0]);
}

function inferMetric(table: PlannerTableInput, recommendations: ChartRecommendation[]): string | undefined {
  return normalizeText(table.chartHint?.metric)
    ?? normalizeText(recommendations.find((recommendation) => recommendation.tableId === table.tableId)?.metric)
    ?? normalizeText(table.metrics[0]);
}

function buildChartTitle(tableName: string, dimension?: string, metric?: string): string {
  if (dimension && metric) return `${tableName} · ${dimension}별 ${metric}`;
  if (metric) return `${tableName} · ${metric}`;
  if (dimension) return `${tableName} · ${dimension} 흐름`;
  return tableName;
}

function buildChartGoal(tableName: string, dimension?: string, metric?: string, fallback?: string): string {
  if (fallback) return fallback;
  if (dimension && metric) return `${tableName}에서 ${dimension} 기준 ${metric} 변화를 비교합니다.`;
  if (metric) return `${tableName}의 핵심 지표 ${metric}를 빠르게 확인합니다.`;
  if (dimension) return `${tableName}의 ${dimension} 축 변화를 요약합니다.`;
  return `${tableName}의 핵심 패턴을 확인합니다.`;
}

function pickNarrative(items: NarrativeItem[] | undefined, tableIds: string[]): NarrativeItem | undefined {
  const normalizedIds = new Set(tableIds);
  return (items ?? []).find((item) => item.sourceTableIds.some((tableId) => normalizedIds.has(tableId))) ?? items?.[0];
}

function inferAspectRatio(chartSectionCount: number, hasTextSections: boolean): LayoutAspectRatio {
  if (chartSectionCount >= 3) return "portrait";
  if (chartSectionCount === 1 && !hasTextSections) return "square";
  return "landscape";
}

function inferLayoutIntent(chartType?: LayoutChartType): string | undefined {
  if (chartType === "line") return "timeline";
  if (chartType === "donut" || chartType === "pie") return "distribution";
  if (chartType === "map") return "geo";
  if (chartType === "stacked-bar") return "comparison";
  if (chartType === "bar") return "ranking";
  return undefined;
}

export function buildDeterministicLayoutPlans(params: PlannerInput): LayoutPlan[] {
  const selectedIds = new Set((params.selectedSourceTableIds ?? []).filter(Boolean));
  const effectiveTables = (selectedIds.size > 0
    ? params.tables.filter((table) => selectedIds.has(table.tableId))
    : params.tables).filter((table) => table.dimensions.length > 0 || table.metrics.length > 0 || table.chartHint);
  const tables = effectiveTables.length > 0 ? effectiveTables : params.tables;
  const recommendations = (params.chartRecommendations ?? [])
    .filter((recommendation) => !selectedIds.size || (recommendation.tableId ? selectedIds.has(recommendation.tableId) : false))
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType));

  const chartSections: LayoutSection[] = tables.slice(0, 4).map((table, index) => {
    const dimension = inferDimension(table, recommendations);
    const metric = inferMetric(table, recommendations);
    const chartType = inferChartType(table, recommendations);
    const chartTitle = buildChartTitle(table.name, dimension, metric);
    const goal = buildChartGoal(table.name, dimension, metric, normalizeText(table.chartHint?.goal));

    return {
      id: `section-chart-${index + 1}`,
      type: "chart-group",
      sectionRole: index === 0 ? "HOOK" : "EVIDENCE",
      sourceTableIds: [table.tableId],
      title: index === 0 ? "핵심 비교" : table.name,
      charts: [{
        id: `chart-${index + 1}`,
        tableId: table.tableId,
        chartType,
        title: chartTitle,
        goal,
        dimension,
        metric,
      }],
      note: normalizeText(table.headerSummary) ?? normalizeText(table.rangeLabel),
    };
  });

  const chartTableIds = chartSections.flatMap((section) => section.sourceTableIds ?? []);
  const takeaway = pickNarrative(params.findings ?? params.implications, chartTableIds);

  const sections: LayoutSection[] = [{
    id: "section-header",
    type: "header",
    sectionRole: "HOOK",
    sourceTableIds: tables.map((table) => table.tableId),
    title: params.title,
    note: takeaway ? takeaway.text : normalizeText(params.implications?.[0]?.text),
  }, ...chartSections];

  if (takeaway) {
    sections.push({
      id: "section-takeaway",
      type: "takeaway",
      sectionRole: "CONCLUSION",
      sourceTableIds: takeaway.sourceTableIds,
      title: "핵심 해석",
      note: takeaway.text,
    });
  }

  const primaryChartType = chartSections[0]?.charts?.[0]?.chartType;
  const hasTextSections = sections.some((section) => section.type === "takeaway" || section.type === "note");

  return [{
    id: "layout-option-1",
    name: "자동 레이아웃",
    description: `${Math.max(chartSections.length, 1)}개 핵심 시각 요소를 기준으로 앱이 계산한 대시보드 레이아웃`,
    layoutType: "dashboard",
    layoutIntent: inferLayoutIntent(primaryChartType),
    aspectRatio: inferAspectRatio(chartSections.length, hasTextSections),
    sections,
    visualPolicy: hasTextSections
      ? { textRatio: 0.24, chartRatio: 0.66, iconRatio: 0.1 }
      : { textRatio: 0.16, chartRatio: 0.74, iconRatio: 0.1 },
  }];
}
