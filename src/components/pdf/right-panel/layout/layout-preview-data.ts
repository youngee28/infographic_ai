import type { ChartConfiguration } from "chart.js";
import { buildLayoutAxisMetadata } from "@/lib/table-utils";
import { buildLogicalTableIdAliasMap } from "@/lib/table-id-resolution";
import type {
  AnalysisData,
  LayoutChartSpec,
  LayoutChartType,
  LayoutKpiBlock,
  LayoutKpiItem,
  LayoutPlan,
  LayoutSection,
} from "@/lib/session-types";

export type PreviewCanvasType = "bar" | "line" | "doughnut" | "pie";
export type PreviewColumnKind = "text" | "number" | "currency" | "percent" | "date";

export interface PreviewColumnProfile {
  index: number;
  name: string;
  kind: PreviewColumnKind;
  distinctCount: number;
  numericCoverage: number;
  dateCoverage: number;
  uniqueRatio: number;
  isGeoLike: boolean;
  isIdLike: boolean;
}

export interface PreviewDataContext {
  columns: string[];
  rows: string[][];
  profiles: PreviewColumnProfile[];
  primaryMetricIndex: number;
  primaryDimensionIndex: number;
  secondaryDimensionIndex: number;
  headerAxisHint: "row" | "column" | "mixed" | "ambiguous";
  timeAxisLikelyIn: "rows" | "columns" | "ambiguous" | "none";
  categoryAxisLikelyIn: "rows" | "columns" | "ambiguous" | "none";
}

export interface PreviewDataRegistry {
  emptyContext: PreviewDataContext;
  defaultContext: PreviewDataContext;
  contextsByTableId: Record<string, PreviewDataContext>;
}

export interface AggregatedPreviewDatum {
  label: string;
  value: number;
  order: number;
}

export interface PreparedPreviewChart {
  renderKind: "canvas" | "geo-rank" | "empty";
  chartType: LayoutChartType;
  canvasType?: PreviewCanvasType;
  title: string;
  goal: string;
  dimensionLabel: string;
  metricLabel: string;
  labels: string[];
  values: number[];
  stackedSeries?: Array<{ label: string; values: number[] }>;
  items: AggregatedPreviewDatum[];
  infoNote: string;
}

export interface PreviewKpiItem {
  id: string;
  label: string;
  value: string;
  note: string;
}

const NUMBER_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PERCENT_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%$/;
const CURRENCY_SYMBOL_REGEX = /^[₩$€¥£]\s*/;
const DATE_VALUE_REGEXES = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, /^\d{4}[-/.]\d{1,2}$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/];
const DIMENSION_HEADER_HINTS = ["date", "time", "month", "year", "day", "category", "type", "group", "segment", "region", "country", "city", "name", "제품", "카테고리", "유형", "구분", "지역", "국가", "도시", "이름", "항목", "월", "연도", "일자", "날짜"];
const GEO_HEADER_HINTS = ["country", "region", "state", "city", "nation", "국가", "지역", "도시", "시도"];
const ID_HEADER_HINTS = ["id", "code", "key", "uuid", "identifier", "번호", "코드", "식별", "순번"];
const PREVIEW_SERIES_COLORS = ["#2563eb", "#0ea5e9", "#f97316", "#14b8a6", "#8b5cf6", "#ef4444"];

export const PREVIEW_ASPECT_RATIOS: Record<NonNullable<LayoutPlan["aspectRatio"]>, string> = {
  portrait: "4 / 5",
  square: "1 / 1",
  landscape: "16 / 10",
};

function normalizePreviewText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePreviewKey(value?: string | null): string {
  return normalizePreviewText(value).toLowerCase().replace(/\s+/g, " ");
}

function isHeaderHint(header: string, hints: string[]): boolean {
  const normalized = normalizePreviewKey(header);
  return hints.some((hint) => normalized.includes(hint));
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

function parseMetricValue(value: string): number | null {
  return parsePercentNumber(value) ?? parseCurrencyNumber(value) ?? parsePlainNumber(value);
}

function parseDateOrder(value: string): number | null {
  const normalized = value.trim();
  if (!DATE_VALUE_REGEXES.some((regex) => regex.test(normalized))) {
    return null;
  }

  const timestamp = Date.parse(normalized.replace(/\./g, "-"));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isYearLikeLabel(value: string): boolean {
  const normalized = value.trim();
  return /(?:19|20)\d{2}/.test(normalized) || /(?:19|20)\d{2}\s*년/.test(normalized);
}

export function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000000) {
    return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return value.toLocaleString("ko-KR", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 });
}

function createPreviewDataContext(
  columns: string[],
  rows: string[][],
  hints?: {
    headerAxis?: "row" | "column" | "mixed" | "ambiguous";
    timeAxisLikelyIn?: "rows" | "columns" | "ambiguous" | "none";
    categoryAxisLikelyIn?: "rows" | "columns" | "ambiguous" | "none";
  }
): PreviewDataContext {
  const profiles = columns.map<PreviewColumnProfile>((name, index) => {
    const values = rows.map((row) => normalizePreviewText(row[index]));
    const nonEmptyValues = values.filter(Boolean);
    const distinctCount = new Set(nonEmptyValues).size;
    const numericMatches = nonEmptyValues.filter((value) => parseMetricValue(value) !== null).length;
    const percentMatches = nonEmptyValues.filter((value) => parsePercentNumber(value) !== null).length;
    const currencyMatches = nonEmptyValues.filter((value) => parseCurrencyNumber(value) !== null).length;
    const dateMatches = nonEmptyValues.filter((value) => parseDateOrder(value) !== null).length;
    const numericCoverage = numericMatches / Math.max(nonEmptyValues.length, 1);
    const dateCoverage = dateMatches / Math.max(nonEmptyValues.length, 1);
    const uniqueRatio = distinctCount / Math.max(nonEmptyValues.length, 1);
    const averageTextLength = nonEmptyValues.reduce((sum, value) => sum + value.length, 0) / Math.max(nonEmptyValues.length, 1);
    const isIdLike =
      uniqueRatio >= 0.95 &&
      averageTextLength <= 36 &&
      numericCoverage < 0.4 &&
      !isHeaderHint(name, GEO_HEADER_HINTS) &&
      isHeaderHint(name, ID_HEADER_HINTS);

    let kind: PreviewColumnKind = "text";
    if (dateCoverage >= 0.7) kind = "date";
    else if (percentMatches / Math.max(nonEmptyValues.length, 1) >= 0.7) kind = "percent";
    else if (currencyMatches / Math.max(nonEmptyValues.length, 1) >= 0.7) kind = "currency";
    else if (numericCoverage >= 0.7) kind = "number";

    return {
      index,
      name,
      kind,
      distinctCount,
      numericCoverage,
      dateCoverage,
      uniqueRatio,
      isGeoLike: isHeaderHint(name, GEO_HEADER_HINTS),
      isIdLike,
    };
  });

  const primaryMetricIndex = profiles
    .slice()
    .sort((left, right) => {
      const leftScore = left.numericCoverage * 100 + (isHeaderHint(left.name, ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"]) ? 12 : 0);
      const rightScore = right.numericCoverage * 100 + (isHeaderHint(right.name, ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"]) ? 12 : 0);
      return rightScore - leftScore || left.index - right.index;
    })
    .find((profile) => profile.numericCoverage >= 0.5 && !profile.isIdLike)?.index ?? -1;

  const orderedDimensions = profiles
    .filter((profile) => profile.index !== primaryMetricIndex && !profile.isIdLike)
    .slice()
    .sort((left, right) => {
      const scoreDimension = (profile: PreviewColumnProfile) => {
        let score = 0;
        if (profile.kind === "date") score += 40;
        if (profile.kind === "text") score += 25;
        if (profile.kind === "number" && profile.distinctCount <= 12) score += 12;
        if (profile.distinctCount <= 12) score += 15;
        else if (profile.distinctCount <= 40) score += 6;
        else score -= 15;
        if (isHeaderHint(profile.name, DIMENSION_HEADER_HINTS)) score += 10;
        if (profile.isGeoLike) score += 8;
        score -= profile.uniqueRatio > 0.95 ? 25 : 0;
        return score;
      };
      return scoreDimension(right) - scoreDimension(left) || left.index - right.index;
    });

  const headerAxisHint = hints?.headerAxis ?? "ambiguous";
  const timeAxisLikelyIn = hints?.timeAxisLikelyIn ?? "none";
  const categoryAxisLikelyIn = hints?.categoryAxisLikelyIn ?? "ambiguous";

  return {
    columns,
    rows,
    profiles,
    primaryMetricIndex,
    primaryDimensionIndex: orderedDimensions[0]?.index ?? -1,
    secondaryDimensionIndex: orderedDimensions.find((profile) => profile.distinctCount <= 8)?.index ?? orderedDimensions[1]?.index ?? -1,
    headerAxisHint,
    timeAxisLikelyIn,
    categoryAxisLikelyIn,
  };
}

export function buildPreviewDataRegistry(analysisData?: AnalysisData | null): PreviewDataRegistry {
  const emptyContext: PreviewDataContext = {
    columns: [],
    rows: [],
    profiles: [],
    primaryMetricIndex: -1,
    primaryDimensionIndex: -1,
    secondaryDimensionIndex: -1,
    headerAxisHint: "ambiguous",
    timeAxisLikelyIn: "none",
    categoryAxisLikelyIn: "none",
  };
  const tableData = analysisData?.tableData;
  if (!tableData) {
    return { emptyContext, defaultContext: emptyContext, contextsByTableId: {} };
  }

  const defaultAxisMetadata = buildLayoutAxisMetadata(tableData);
  const defaultContext = createPreviewDataContext(tableData.columns, tableData.rows, {
    headerAxis: defaultAxisMetadata.headerAxisHint,
    timeAxisLikelyIn: defaultAxisMetadata.timeAxisLikelyIn,
    categoryAxisLikelyIn: defaultAxisMetadata.categoryAxisLikelyIn,
  });
  const aliases = buildLogicalTableIdAliasMap({
    tableData,
    sheetStructure: analysisData?.sheetStructure,
    sourceTables: analysisData?.sourceInventory?.tables,
  });
  const contextsByTableId: Record<string, PreviewDataContext> = {};

  for (const table of tableData.logicalTables ?? []) {
    const axisMetadata = buildLayoutAxisMetadata(table);
    const context = createPreviewDataContext(table.columns, table.rows, {
      headerAxis: axisMetadata.headerAxisHint,
      timeAxisLikelyIn: axisMetadata.timeAxisLikelyIn,
      categoryAxisLikelyIn: axisMetadata.categoryAxisLikelyIn,
    });
    contextsByTableId[table.id] = context;
  }

  for (const [inputId, logicalId] of aliases.entries()) {
    const context = contextsByTableId[logicalId];
    if (context) {
      contextsByTableId[inputId] = context;
    }
  }

  return { emptyContext, defaultContext, contextsByTableId };
}

function resolveSectionSourceTableIds(plan: LayoutPlan, sectionId?: string): string[] | undefined {
  if (!sectionId) return undefined;
  return plan.sections.find((section) => section.id === sectionId)?.sourceTableIds;
}

export function resolvePreviewDataContext(registry: PreviewDataRegistry, tableId?: string, sourceTableIds?: string[]): PreviewDataContext {
  if (tableId && registry.contextsByTableId[tableId]) {
    return registry.contextsByTableId[tableId];
  }

  const firstSectionTableId = sourceTableIds?.find((candidate) => registry.contextsByTableId[candidate]);
  if (firstSectionTableId) {
    return registry.contextsByTableId[firstSectionTableId];
  }

  if (tableId || (sourceTableIds && sourceTableIds.length > 0)) {
    return registry.emptyContext;
  }

  return registry.defaultContext;
}

function findColumnIndex(context: PreviewDataContext, preferredName?: string, options?: { requireNumeric?: boolean; exclude?: number[] }): number {
  const normalizedName = normalizePreviewKey(preferredName);
  const excluded = new Set(options?.exclude ?? []);

  if (normalizedName) {
    const exactMatch = context.profiles.find((profile) => !excluded.has(profile.index) && normalizePreviewKey(profile.name) === normalizedName);
    if (exactMatch && (!options?.requireNumeric || exactMatch.numericCoverage >= 0.5)) {
      return exactMatch.index;
    }

    const partialMatch = context.profiles.find((profile) => !excluded.has(profile.index) && normalizePreviewKey(profile.name).includes(normalizedName));
    if (partialMatch && (!options?.requireNumeric || partialMatch.numericCoverage >= 0.5)) {
      return partialMatch.index;
    }
  }

  return -1;
}

function resolveMetricIndex(context: PreviewDataContext, preferredName?: string, exclude?: number[]): number {
  const matchedIndex = findColumnIndex(context, preferredName, { requireNumeric: true, exclude });
  if (matchedIndex >= 0) return matchedIndex;
  if (context.primaryMetricIndex >= 0 && !(exclude ?? []).includes(context.primaryMetricIndex)) {
    return context.primaryMetricIndex;
  }
  return -1;
}

function resolveDimensionIndex(context: PreviewDataContext, preferredName: string | undefined, metricIndex: number): number {
  const matchedIndex = findColumnIndex(context, preferredName, { exclude: [metricIndex] });
  if (matchedIndex >= 0) return matchedIndex;
  if (context.primaryDimensionIndex >= 0 && context.primaryDimensionIndex !== metricIndex) {
    return context.primaryDimensionIndex;
  }
  return context.profiles.find((profile) => profile.index !== metricIndex)?.index ?? -1;
}

function resolveSplitDimensionIndex(context: PreviewDataContext, dimensionIndex: number, metricIndex: number): number {
  if (context.secondaryDimensionIndex >= 0 && context.secondaryDimensionIndex !== dimensionIndex && context.secondaryDimensionIndex !== metricIndex) {
    return context.secondaryDimensionIndex;
  }

  return (
    context.profiles
      .filter((profile) => profile.index !== dimensionIndex && profile.index !== metricIndex && !profile.isIdLike)
      .sort((left, right) => left.distinctCount - right.distinctCount || left.index - right.index)
      .find((profile) => profile.distinctCount <= 8)?.index ?? -1
  );
}

function findMatchingRowIndex(context: PreviewDataContext, preferredName?: string): number {
  const normalizedName = normalizePreviewKey(preferredName);
  if (!normalizedName) return -1;
  return context.rows.findIndex((row) => {
    const label = normalizePreviewKey(row[0]);
    return Boolean(label) && (label === normalizedName || label.includes(normalizedName) || normalizedName.includes(label));
  });
}

function buildColumnTimeSeriesPreview(chart: LayoutChartSpec, context: PreviewDataContext): PreparedPreviewChart | null {
  if (context.timeAxisLikelyIn !== "columns" || context.categoryAxisLikelyIn !== "rows" || context.columns.length < 2 || context.rows.length === 0) {
    return null;
  }

  const timeColumns = context.columns
    .map((label, index) => ({ label, index, order: parseDateOrder(label) }))
    .filter((item) => item.index > 0 && (item.order !== null || isYearLikeLabel(item.label)));
  if (timeColumns.length < 2) {
    return null;
  }

  const orderedTimeColumns = timeColumns
    .slice()
    .sort((left, right) => (left.order ?? left.index) - (right.order ?? right.index) || left.index - right.index);
  const matchedRowIndex = findMatchingRowIndex(context, chart.metric);
  const viableRowIndexes = context.rows
    .map((row, rowIndex) => ({
      rowIndex,
      hasNumericSeries: orderedTimeColumns.some((column) => parseMetricValue(normalizePreviewText(row[column.index])) !== null),
    }))
    .filter((item) => item.hasNumericSeries)
    .map((item) => item.rowIndex);
  const fallbackRowIndex = viableRowIndexes.length === 1 ? viableRowIndexes[0] : -1;
  const rowIndex = matchedRowIndex >= 0 ? matchedRowIndex : fallbackRowIndex;
  if (rowIndex < 0) {
    return null;
  }

  const row = context.rows[rowIndex] ?? [];
  const items = orderedTimeColumns
    .map((column, order) => ({
      label: column.label,
      value: parseMetricValue(normalizePreviewText(row[column.index])) ?? Number.NaN,
      order: column.order ?? order,
    }))
    .filter((item) => Number.isFinite(item.value));
  if (items.length < 2) {
    return null;
  }

  const metricLabel = normalizePreviewText(row[0]) || chart.metric || "metric";
  return {
    renderKind: "canvas",
    chartType: chart.chartType,
    canvasType: chart.chartType === "line" ? "line" : "bar",
    title: chart.title,
    goal: chart.goal,
    dimensionLabel: chart.dimension ?? "연도",
    metricLabel,
    labels: items.map((item) => item.label),
    values: items.map((item) => item.value),
    items,
    infoNote: `${metricLabel} 행을 시간축 기준으로 재구성한 미리보기`,
  };
}

function aggregateByDimension(context: PreviewDataContext, dimensionIndex: number, metricIndex: number): AggregatedPreviewDatum[] {
  const dimensionProfile = context.profiles[dimensionIndex];
  const aggregated = new Map<string, AggregatedPreviewDatum>();

  context.rows.forEach((row, rowIndex) => {
    const label = normalizePreviewText(row[dimensionIndex]) || "미분류";
    const metricValue = parseMetricValue(normalizePreviewText(row[metricIndex]));
    if (metricValue === null) return;

    const order = dimensionProfile?.kind === "date" ? parseDateOrder(label) ?? rowIndex : rowIndex;
    const existing = aggregated.get(label);
    if (existing) {
      existing.value += metricValue;
      existing.order = Math.min(existing.order, order);
      return;
    }

    aggregated.set(label, { label, value: metricValue, order });
  });

  return Array.from(aggregated.values());
}

function sortPreviewItems(items: AggregatedPreviewDatum[], chartType: LayoutChartType, dimensionKind: PreviewColumnKind | undefined): AggregatedPreviewDatum[] {
  const sorted = items.slice();
  if (chartType === "line" && dimensionKind === "date") {
    return sorted.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  if (chartType === "line") {
    return sorted.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  return sorted.sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function buildPieLikeItems(items: AggregatedPreviewDatum[]): AggregatedPreviewDatum[] {
  if (items.length <= 5) return items;
  const head = items.slice(0, 4);
  const otherValue = items.slice(4).reduce((sum, item) => sum + item.value, 0);
  return otherValue > 0 ? [...head, { label: "기타", value: otherValue, order: Number.MAX_SAFE_INTEGER }] : head;
}

function buildStackedPreviewChart(
  chart: LayoutChartSpec,
  context: PreviewDataContext,
  dimensionIndex: number,
  metricIndex: number,
  splitIndex: number
): PreparedPreviewChart {
  const dimensionProfile = context.profiles[dimensionIndex];
  const categoryMap = new Map<string, { label: string; total: number; order: number; splits: Map<string, number> }>();
  const splitTotals = new Map<string, number>();

  context.rows.forEach((row, rowIndex) => {
    const categoryLabel = normalizePreviewText(row[dimensionIndex]) || "미분류";
    const splitLabel = normalizePreviewText(row[splitIndex]) || "기타";
    const metricValue = parseMetricValue(normalizePreviewText(row[metricIndex]));
    if (metricValue === null) return;

    const order = dimensionProfile?.kind === "date" ? parseDateOrder(categoryLabel) ?? rowIndex : rowIndex;
    const category = categoryMap.get(categoryLabel) ?? {
      label: categoryLabel,
      total: 0,
      order,
      splits: new Map<string, number>(),
    };

    category.total += metricValue;
    category.order = Math.min(category.order, order);
    category.splits.set(splitLabel, (category.splits.get(splitLabel) ?? 0) + metricValue);
    categoryMap.set(categoryLabel, category);
    splitTotals.set(splitLabel, (splitTotals.get(splitLabel) ?? 0) + metricValue);
  });

  const categories = sortPreviewItems(
    Array.from(categoryMap.values()).map((item) => ({ label: item.label, value: item.total, order: item.order })),
    chart.chartType,
    dimensionProfile?.kind
  ).slice(0, 5);
  const primarySplits = Array.from(splitTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label]) => label);

  const stackedSeries = primarySplits.map((label, index) => ({
    label,
    values: categories.map((category) => categoryMap.get(category.label)?.splits.get(label) ?? 0),
    color: PREVIEW_SERIES_COLORS[index],
  }));

  const otherValues = categories.map((category) => {
    const categoryItem = categoryMap.get(category.label);
    if (!categoryItem) return 0;
    const selectedTotal = primarySplits.reduce((sum, splitLabel) => sum + (categoryItem.splits.get(splitLabel) ?? 0), 0);
    return Math.max(categoryItem.total - selectedTotal, 0);
  });

  if (otherValues.some((value) => value > 0)) {
    stackedSeries.push({ label: "기타", values: otherValues, color: PREVIEW_SERIES_COLORS[3] });
  }

  return {
    renderKind: categories.length > 0 ? "canvas" : "empty",
    chartType: chart.chartType,
    canvasType: "bar",
    title: chart.title,
    goal: chart.goal,
    dimensionLabel: context.columns[dimensionIndex] ?? chart.dimension ?? "dimension",
    metricLabel: context.columns[metricIndex] ?? chart.metric ?? "metric",
    labels: categories.map((category) => category.label),
    values: categories.map((category) => category.value),
    stackedSeries: stackedSeries.map((series) => ({ label: series.label, values: series.values })),
    items: categories,
    infoNote: `${context.columns[splitIndex] ?? "세그먼트"} 기준 분해`,
  };
}

export function buildPreparedPreviewChart(chart: LayoutChartSpec, registry: PreviewDataRegistry, sourceTableIds?: string[]): PreparedPreviewChart {
  const context = resolvePreviewDataContext(registry, chart.tableId, sourceTableIds);
  if (chart.chartType === "line") {
    const transposedPreview = buildColumnTimeSeriesPreview(chart, context);
    if (transposedPreview) {
      return transposedPreview;
    }
  }
  const metricIndex = resolveMetricIndex(context, chart.metric);
  const dimensionIndex = resolveDimensionIndex(context, chart.dimension, metricIndex);

  if (metricIndex < 0 || dimensionIndex < 0) {
    return {
      renderKind: "empty",
      chartType: chart.chartType,
      title: chart.title,
      goal: chart.goal,
      dimensionLabel: chart.dimension ?? "dimension",
      metricLabel: chart.metric ?? "metric",
      labels: [],
      values: [],
      items: [],
      infoNote: "표에서 연결 가능한 차트 데이터를 찾지 못했습니다.",
    };
  }

  if (chart.chartType === "stacked-bar") {
    const splitIndex = resolveSplitDimensionIndex(context, dimensionIndex, metricIndex);
    if (splitIndex >= 0) {
      return buildStackedPreviewChart(chart, context, dimensionIndex, metricIndex, splitIndex);
    }
  }

  const dimensionProfile = context.profiles[dimensionIndex];
  const aggregatedItems = sortPreviewItems(aggregateByDimension(context, dimensionIndex, metricIndex), chart.chartType, dimensionProfile?.kind);
  const slicedItems =
    chart.chartType === "donut" || chart.chartType === "pie"
      ? buildPieLikeItems(aggregatedItems)
      : aggregatedItems.slice(0, chart.chartType === "map" ? 5 : 6);

  return {
    renderKind: slicedItems.length > 0 ? (chart.chartType === "map" ? "geo-rank" : "canvas") : "empty",
    chartType: chart.chartType,
    canvasType:
      chart.chartType === "line" ? "line" : chart.chartType === "donut" ? "doughnut" : chart.chartType === "pie" ? "pie" : "bar",
    title: chart.title,
    goal: chart.goal,
    dimensionLabel: context.columns[dimensionIndex] ?? chart.dimension ?? "dimension",
    metricLabel: context.columns[metricIndex] ?? chart.metric ?? "metric",
    labels: slicedItems.map((item) => item.label),
    values: slicedItems.map((item) => item.value),
    items: slicedItems,
    infoNote: chart.chartType === "map" ? "지도 대신 지역 랭킹으로 비교" : `${context.rows.length.toLocaleString("ko-KR")}개 행 기준 집계`,
  };
}

export function buildPreviewChartConfig(preview: PreparedPreviewChart): ChartConfiguration<PreviewCanvasType, number[], string> | null {
  if (preview.renderKind !== "canvas" || !preview.canvasType) {
    return null;
  }

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: Boolean(preview.stackedSeries && preview.stackedSeries.length > 1),
        position: "bottom" as const,
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          color: "#64748b",
          font: { size: 10, weight: 600 },
          padding: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: (context: { dataset: { label?: string }; parsed: { y?: number; x?: number } | number }) => {
            const numericValue = typeof context.parsed === "number" ? context.parsed : context.parsed.y ?? context.parsed.x ?? 0;
            return `${context.dataset.label ? `${context.dataset.label}: ` : ""}${formatPreviewNumber(numericValue)}`;
          },
        },
      },
    },
  };

  if (preview.canvasType === "line") {
    return {
      type: "line",
      data: {
        labels: preview.labels,
        datasets: [
          {
            label: preview.metricLabel,
            data: preview.values,
            borderColor: PREVIEW_SERIES_COLORS[0],
            backgroundColor: "rgba(37,99,235,0.14)",
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 2,
            pointHoverRadius: 2,
          },
        ],
      },
      options: {
        ...baseOptions,
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.16)" } },
        },
      },
    };
  }

  if (preview.canvasType === "doughnut" || preview.canvasType === "pie") {
    return {
      type: preview.canvasType,
      data: {
        labels: preview.labels,
        datasets: [
          {
            label: preview.metricLabel,
            data: preview.values,
            backgroundColor: preview.labels.map((_, index) => PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length]),
            borderColor: "#ffffff",
            borderWidth: 2,
            hoverOffset: 0,
          },
        ],
      },
      options: {
        ...baseOptions,
        cutout: preview.canvasType === "doughnut" ? "58%" : 0,
      },
    };
  }

  return {
    type: "bar",
    data: {
      labels: preview.labels,
      datasets: preview.stackedSeries && preview.stackedSeries.length > 0
        ? preview.stackedSeries.map((series, index) => ({
            label: series.label,
            data: series.values,
            backgroundColor: PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length],
            borderRadius: 8,
            borderSkipped: false as const,
            maxBarThickness: 26,
          }))
        : [
            {
              label: preview.metricLabel,
              data: preview.values,
              backgroundColor: preview.labels.map((_, index) => PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length]),
              borderRadius: 10,
              borderSkipped: false as const,
              maxBarThickness: 28,
            },
          ],
    },
    options: {
      ...baseOptions,
      scales: {
        x: {
          stacked: Boolean(preview.stackedSeries?.length),
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          stacked: Boolean(preview.stackedSeries?.length),
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(148,163,184,0.16)" },
        },
      },
    },
  };
}

export function buildPreviewKpis(section: LayoutSection, registry: PreviewDataRegistry): PreviewKpiItem[] {
  const context = resolvePreviewDataContext(registry, section.items?.[0]?.tableId, section.sourceTableIds);
  const metricIndex = resolveMetricIndex(context, undefined);
  const dimensionIndex = resolveDimensionIndex(context, undefined, metricIndex);
  const metricLabel = context.columns[metricIndex] ?? "핵심 지표";
  const aggregatedItems = metricIndex >= 0 && dimensionIndex >= 0 ? aggregateByDimension(context, dimensionIndex, metricIndex) : [];
  const sortedItems = aggregatedItems.slice().sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  const totalValue = aggregatedItems.reduce((sum, item) => sum + item.value, 0);
  const averageValue = aggregatedItems.length > 0 ? totalValue / aggregatedItems.length : 0;
  const topItem = sortedItems[0];

  const sourceItems = section.items && section.items.length > 0
    ? section.items
    : [
        { id: `${section.id}-metric`, label: metricLabel, value: "" },
        { id: `${section.id}-top`, label: "대표 항목", value: "" },
        { id: `${section.id}-rows`, label: "행 수", value: "" },
      ];

  return sourceItems.slice(0, 3).map((item, index) => {
    const normalizedLabel = normalizePreviewKey(item.label);
    const itemId = item.id || `preview-kpi-${index + 1}`;

    if (normalizedLabel.includes("행") || normalizedLabel.includes("row") || normalizedLabel.includes("건수") || normalizedLabel.includes("count")) {
      return { id: itemId, label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    if (normalizedLabel.includes("열") || normalizedLabel.includes("column")) {
      return { id: itemId, label: item.label, value: context.columns.length.toLocaleString("ko-KR"), note: "열 개수" };
    }

    if (normalizedLabel.includes("평균") || normalizedLabel.includes("avg") || normalizedLabel.includes("mean")) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(averageValue), note: `${metricLabel} 평균` };
    }

    if (normalizedLabel.includes("최대") || normalizedLabel.includes("max")) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(sortedItems[0]?.value ?? 0), note: `${context.columns[dimensionIndex] ?? "차원"} 최고값` };
    }

    if (normalizedLabel.includes("대표") || normalizedLabel.includes("1위") || normalizedLabel.includes("top") || normalizedLabel.includes("최고")) {
      return { id: itemId, label: item.label, value: topItem?.label ?? item.value, note: topItem ? `${formatPreviewNumber(topItem.value)} 기준` : "대표 항목" };
    }

    if (index === 0 && metricIndex >= 0) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(totalValue), note: `${metricLabel} 합계` };
    }

    if (index === 1 && topItem) {
      return { id: itemId, label: item.label, value: topItem.label, note: `${formatPreviewNumber(topItem.value)} 기준` };
    }

    if (index === 2) {
      return { id: itemId, label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    return { id: itemId, label: item.label, value: item.value, note: section.title || "핵심 수치" };
  });
}

export function buildEditableKpiItems(section: LayoutSection, registry: PreviewDataRegistry): LayoutKpiItem[] {
  return buildPreviewKpis(section, registry).map(({ id, label, value }) => ({
    id,
    label: label.trim() || "지표",
    value: value.trim() || "-",
  }));
}

export function resolveKpiNoteForBlock(block: LayoutKpiBlock, plan: LayoutPlan, registry: PreviewDataRegistry): string {
  const sourceTableIds = resolveSectionSourceTableIds(plan, block.content.sectionId);
  const context = resolvePreviewDataContext(registry, block.content.tableId, sourceTableIds);
  const metricIndex = resolveMetricIndex(context, undefined);
  const dimensionIndex = resolveDimensionIndex(context, undefined, metricIndex);
  const metricLabel = context.columns[metricIndex] ?? "핵심 지표";
  const aggregatedItems = metricIndex >= 0 && dimensionIndex >= 0 ? aggregateByDimension(context, dimensionIndex, metricIndex) : [];
  const sortedItems = aggregatedItems.slice().sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  const averageValue = aggregatedItems.length > 0 ? aggregatedItems.reduce((sum, item) => sum + item.value, 0) / aggregatedItems.length : 0;
  const topItem = sortedItems[0];
  const normalizedLabel = normalizePreviewKey(block.content.label);

  if (normalizedLabel.includes("행") || normalizedLabel.includes("row") || normalizedLabel.includes("건수") || normalizedLabel.includes("count")) {
    return "원본 행 수";
  }

  if (normalizedLabel.includes("열") || normalizedLabel.includes("column")) {
    return "열 개수";
  }

  if (normalizedLabel.includes("평균") || normalizedLabel.includes("avg") || normalizedLabel.includes("mean")) {
    return `${metricLabel} 평균`;
  }

  if (normalizedLabel.includes("최대") || normalizedLabel.includes("max")) {
    return `${context.columns[dimensionIndex] ?? "차원"} 최고값`;
  }

  if (normalizedLabel.includes("대표") || normalizedLabel.includes("1위") || normalizedLabel.includes("top") || normalizedLabel.includes("최고")) {
    return topItem ? `${formatPreviewNumber(topItem.value)} 기준` : "대표 항목";
  }

  if (metricIndex >= 0) {
    return aggregatedItems.length > 0 && averageValue >= 0 ? `${metricLabel} 합계` : `${metricLabel} 지표`;
  }

  return plan.sections.find((section) => section.id === block.content.sectionId)?.title || "핵심 수치";
}
