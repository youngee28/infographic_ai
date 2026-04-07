import type {
  ChartRecommendation,
  LayoutAspectRatio,
  LayoutChartType,
  LayoutPlan,
  LayoutSection,
  NarrativeItem,
} from "@/lib/session-types";
import type { LayoutPlanningTableBrief } from "./types";

interface BuildDeterministicLayoutPlanParams {
  title: string;
  tableBriefs: LayoutPlanningTableBrief[];
  selectedSourceTableIds?: string[];
  chartRecommendations?: ChartRecommendation[];
  findings?: NarrativeItem[];
  implications?: NarrativeItem[];
  cautions?: NarrativeItem[];
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

function inferChartType(brief: LayoutPlanningTableBrief, recommendations: ChartRecommendation[]): LayoutChartType {
  if (brief.chartHint?.chartType) {
    return brief.chartHint.chartType;
  }

  const matchingRecommendation = recommendations.find((recommendation) => recommendation.tableId === brief.tableId);
  if (matchingRecommendation) {
    return matchingRecommendation.chartType;
  }

  const primaryDimension = brief.dimensions[0];
  if (isTimeLikeDimension(primaryDimension)) return "line";
  return "bar";
}

function inferDimension(brief: LayoutPlanningTableBrief, recommendations: ChartRecommendation[]): string | undefined {
  return normalizeText(brief.chartHint?.dimension)
    ?? normalizeText(recommendations.find((recommendation) => recommendation.tableId === brief.tableId)?.dimension)
    ?? normalizeText(brief.dimensions[0]);
}

function inferMetric(brief: LayoutPlanningTableBrief, recommendations: ChartRecommendation[]): string | undefined {
  return normalizeText(brief.chartHint?.metric)
    ?? normalizeText(recommendations.find((recommendation) => recommendation.tableId === brief.tableId)?.metric)
    ?? normalizeText(brief.metrics[0]);
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

export function buildDeterministicLayoutPlans(params: BuildDeterministicLayoutPlanParams): LayoutPlan[] {
  const selectedIds = new Set((params.selectedSourceTableIds ?? []).filter(Boolean));
  const effectiveBriefs = (selectedIds.size > 0
    ? params.tableBriefs.filter((brief) => selectedIds.has(brief.tableId))
    : params.tableBriefs).filter((brief) => brief.dimensions.length > 0 || brief.metrics.length > 0 || brief.chartHint);
  const tableBriefs = effectiveBriefs.length > 0 ? effectiveBriefs : params.tableBriefs;
  const recommendations = (params.chartRecommendations ?? [])
    .filter((recommendation) => !selectedIds.size || (recommendation.tableId ? selectedIds.has(recommendation.tableId) : false))
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType));

  const chartSections: LayoutSection[] = tableBriefs.slice(0, 4).map((brief, index) => {
    const dimension = inferDimension(brief, recommendations);
    const metric = inferMetric(brief, recommendations);
    const chartType = inferChartType(brief, recommendations);
    const chartTitle = buildChartTitle(brief.name, dimension, metric);
    const goal = buildChartGoal(brief.name, dimension, metric, normalizeText(brief.chartHint?.goal));

    return {
      id: `section-chart-${index + 1}`,
      type: "chart-group",
      sectionRole: index === 0 ? "HOOK" : "EVIDENCE",
      sourceTableIds: [brief.tableId],
      title: index === 0 ? "핵심 비교" : brief.name,
      charts: [{
        id: `chart-${index + 1}`,
        tableId: brief.tableId,
        chartType,
        title: chartTitle,
        goal,
        dimension,
        metric,
      }],
      note: normalizeText(brief.headerSummary) ?? normalizeText(brief.rangeLabel),
    };
  });

  const chartTableIds = chartSections.flatMap((section) => section.sourceTableIds ?? []);
  const takeaway = pickNarrative(params.findings ?? params.implications, chartTableIds);
  const caution = pickNarrative(params.cautions, chartTableIds);

  const sections: LayoutSection[] = [{
    id: "section-header",
    type: "header",
    sectionRole: "HOOK",
    sourceTableIds: tableBriefs.map((brief) => brief.tableId),
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

  if (caution) {
    sections.push({
      id: "section-note",
      type: "note",
      sectionRole: "CONTEXT",
      sourceTableIds: caution.sourceTableIds,
      title: "해석 시 유의점",
      note: caution.text,
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
