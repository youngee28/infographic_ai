import type { ChartRecommendation, LayoutPlan, LayoutSection, NormalizedTable } from "@/lib/session-types";

type InferredColumnKind = "number" | "percent" | "currency" | "date" | "boolean" | "id" | "text";
type CardinalityBucket = "low" | "medium" | "high";

interface ColumnProfile {
  name: string;
  distinctCount: number;
  uniqueRatio: number;
  averageTextLength: number;
  inferredKind: InferredColumnKind;
  cardinality: CardinalityBucket;
  idLike: boolean;
  numberCoverage: number;
  percentCoverage: number;
  currencyCoverage: number;
  missingRatio: number;
}

interface RankedField {
  name: string;
  score: number;
  reason: string;
}

const NUMBER_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PERCENT_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%$/;
const CURRENCY_SYMBOL_REGEX = /^[₩$€¥£]\s*/;
const DATE_VALUE_REGEXES = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, /^\d{4}[-/.]\d{1,2}$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/];
const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n", "0", "1", "t", "f"]);
const METRIC_HEADER_HINTS = ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"];
const DIMENSION_HEADER_HINTS = ["date", "time", "month", "year", "day", "category", "type", "group", "segment", "region", "country", "city", "name", "제품", "카테고리", "유형", "구분", "지역", "국가", "도시", "이름", "항목", "월", "연도", "일자", "날짜"];
const MAP_HEADER_HINTS = ["country", "region", "state", "city", "nation", "국가", "지역", "도시", "시도"];
const ID_HEADER_HINTS = ["id", "code", "key", "uuid", "identifier", "번호", "코드", "식별", "순번", "주문번호", "상품코드"];

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
  const {
    header,
    values,
    nonEmptyCount,
    uniqueRatio,
    averageTextLength,
    numberCoverage,
    percentCoverage,
    currencyCoverage,
    dateCoverage,
    booleanCoverage,
  } = params;
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

function profileColumns(columns: string[], rows: string[][]): ColumnProfile[] {
  return columns.map((name, index) => {
    const values = rows.map((row) => normalizeCellValue(row[index] ?? ""));
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

    let numberMatches = 0;
    let percentMatches = 0;
    let currencyMatches = 0;
    let dateMatches = 0;
    let booleanMatches = 0;

    for (const value of nonEmptyValues) {
      if (parsePercentNumber(value) !== null) percentMatches += 1;
      if (parseCurrencyNumber(value) !== null) currencyMatches += 1;
      if (parsePlainNumber(value) !== null) numberMatches += 1;
      if (isDateLike(value)) dateMatches += 1;
      if (isBooleanLike(value)) booleanMatches += 1;
    }

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
      name,
      distinctCount,
      uniqueRatio,
      averageTextLength,
      inferredKind,
      cardinality: classifyCardinality(distinctCount, uniqueRatio),
      idLike,
      numberCoverage: numberMatches / Math.max(nonEmptyCount, 1),
      percentCoverage: percentMatches / Math.max(nonEmptyCount, 1),
      currencyCoverage: currencyMatches / Math.max(nonEmptyCount, 1),
      missingRatio,
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
        reason: `${profile.inferredKind}, 결측 ${Math.round(profile.missingRatio * 100)}%, 고유값 ${profile.distinctCount}`,
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

export function buildChartRecommendations(tableData: Pick<NormalizedTable, "columns" | "rows">): ChartRecommendation[] {
  const profiles = profileColumns(tableData.columns, tableData.rows);
  const metrics = rankMetricCandidates(profiles);
  const dimensions = rankDimensionCandidates(profiles);
  const dimensionProfiles = dimensions
    .map((candidate) => profiles.find((profile) => profile.name === candidate.name))
    .filter((profile): profile is ColumnProfile => Boolean(profile));
  const metricProfiles = metrics
    .map((candidate) => profiles.find((profile) => profile.name === candidate.name))
    .filter((profile): profile is ColumnProfile => Boolean(profile));

  const recommendations: ChartRecommendation[] = [];
  const primaryMetric = metricProfiles[0];
  const primaryDimension = dimensionProfiles[0];
  const secondaryDimension = dimensionProfiles[1];

  if (primaryDimension && primaryMetric) {
    if (primaryDimension.inferredKind === "date") {
      recommendations.push({ chartType: "line", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "time_series", score: 90 });
    }

    if (["low", "medium"].includes(primaryDimension.cardinality)) {
      recommendations.push({ chartType: "bar", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "category_compare", score: 82 });
    }

    if (primaryDimension.cardinality === "low" && primaryDimension.distinctCount <= 8) {
      recommendations.push({ chartType: "donut", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "part_to_whole", score: 74 });
      recommendations.push({ chartType: "pie", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "part_to_whole", score: 70 });
    }

    if (isHeaderHint(primaryDimension.name, MAP_HEADER_HINTS)) {
      recommendations.push({ chartType: "map", dimension: primaryDimension.name, metric: primaryMetric.name, reason: "geo_compare", score: 76 });
    }
  }

  if (primaryMetric && primaryDimension && secondaryDimension && secondaryDimension.cardinality === "low" && secondaryDimension.distinctCount <= 8) {
    recommendations.push({
      chartType: "stacked-bar",
      dimension: primaryDimension.name,
      metric: primaryMetric.name,
      reason: `split_by_${secondaryDimension.name}`,
      score: 78,
    });
  }

  return recommendations
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType))
    .filter(
      (recommendation, index, source) =>
        index ===
        source.findIndex(
          (candidate) =>
            candidate.chartType === recommendation.chartType &&
            candidate.dimension === recommendation.dimension &&
            candidate.metric === recommendation.metric
        )
    )
    .slice(0, 3);
}

export function buildChartRecommendationsForLogicalTables(
  tableData: Pick<NormalizedTable, "logicalTables" | "primaryLogicalTableId" | "columns" | "rows">,
  selectedTableIds?: string[]
): ChartRecommendation[] {
  const logicalTables = tableData.logicalTables ?? [];
  if (logicalTables.length === 0) {
    return buildChartRecommendations(tableData).map((recommendation) => ({
      ...recommendation,
      tableId: tableData.primaryLogicalTableId ?? "table-1",
    }));
  }

  const allowedTableIds = selectedTableIds === undefined ? null : new Set(selectedTableIds);
  return logicalTables
    .filter((table) => !allowedTableIds || allowedTableIds.has(table.id))
    .flatMap((table) =>
      buildChartRecommendations({ columns: table.columns, rows: table.rows }).map((recommendation) => ({
        ...recommendation,
        tableId: table.id,
      }))
    )
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType))
    .slice(0, 6);
}

function normalizeRecommendationKey(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function sanitizePromptValue(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/[{}<>`]/g, " ").replace(/\s+/g, " ").trim();
}

function getPlanCharts(plan: LayoutPlan): NonNullable<LayoutSection["charts"]> {
  return plan.sections.flatMap((section) => section.charts ?? []);
}

export function buildChartRecommendationPromptContext(recommendations?: ChartRecommendation[]): string {
  if (!recommendations || recommendations.length === 0) {
    return "";
  }

  return [
    "[CHART_RECOMMENDATIONS]",
    ...recommendations.map(
      (recommendation, index) =>
        `${index + 1}. ${recommendation.chartType} | dimension=${sanitizePromptValue(recommendation.dimension)} | metric=${sanitizePromptValue(recommendation.metric)} | reason=${sanitizePromptValue(recommendation.reason)} | score=${recommendation.score}`
    ),
    "",
    "레이아웃 생성 규칙 추가:",
    "- 추천 차트를 우선 참고해 최소 1개 이상의 chart-group에 반영하세요.",
    "- 추천과 정확히 일치하지 않더라도, dimension/metric 의미가 맞으면 그 차트를 우선적으로 사용하세요.",
    "- 추천 1순위 차트는 적어도 한 시안의 핵심 차트로 사용하세요.",
  ].join("\n");
}

export function scoreLayoutPlanRecommendationAlignment(plan: LayoutPlan, recommendations?: ChartRecommendation[]): number {
  if (!recommendations || recommendations.length === 0) {
    return 0;
  }

  const charts = getPlanCharts(plan);
  if (charts.length === 0) {
    return 0;
  }

  let score = 0;
  const usedChartIds = new Set<string>();

  for (const recommendation of recommendations) {
    const exactMatch = charts.find((chart) => {
      if (usedChartIds.has(chart.id)) return false;
      const sameType = chart.chartType === recommendation.chartType;
      const sameDimension = normalizeRecommendationKey(chart.dimension) === normalizeRecommendationKey(recommendation.dimension);
      const sameMetric = normalizeRecommendationKey(chart.metric) === normalizeRecommendationKey(recommendation.metric);
      return sameType && sameDimension && sameMetric;
    });

    if (exactMatch) {
      usedChartIds.add(exactMatch.id);
      score += recommendation.score + 30;
      continue;
    }

    const partialMatch = charts.find((chart) => {
      if (usedChartIds.has(chart.id)) return false;
      const sameType = chart.chartType === recommendation.chartType;
      const sameDimension = normalizeRecommendationKey(chart.dimension) === normalizeRecommendationKey(recommendation.dimension);
      const sameMetric = normalizeRecommendationKey(chart.metric) === normalizeRecommendationKey(recommendation.metric);
      return (sameType && sameDimension) || (sameType && sameMetric) || (sameDimension && sameMetric);
    });

    if (partialMatch) {
      usedChartIds.add(partialMatch.id);
      score += recommendation.score * 0.45;
    }
  }

  return score;
}

export function rerankLayoutPlansByRecommendations(plans: LayoutPlan[] | undefined, recommendations?: ChartRecommendation[]): LayoutPlan[] | undefined {
  if (!plans || plans.length <= 1 || !recommendations || recommendations.length === 0) {
    return plans;
  }

  return plans
    .map((plan, index) => ({
      plan,
      index,
      alignmentScore: scoreLayoutPlanRecommendationAlignment(plan, recommendations),
    }))
    .sort((left, right) => right.alignmentScore - left.alignmentScore || left.index - right.index)
    .map(({ plan }) => plan);
}
