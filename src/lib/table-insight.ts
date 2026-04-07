import { buildLayoutAxisMetadata } from "@/lib/table-utils";

export interface TableInsightExtremaFact {
  label: string;
  rawValue: string;
  numericValue: number;
}

export interface TableInsightFacts {
  tableId: string;
  tableName: string;
  analysisMode: "trend" | "ranking" | "unknown";
  metricName: string;
  labelDimension: string;
  rowCount: number;
  max: TableInsightExtremaFact;
  min: TableInsightExtremaFact;
  mean: number;
  total: number;
  spread?: number;
  topValues: Array<{ label: string; value: string }>;
  topGap?: number;
  topGapRatio?: number;
  shareOfTop?: number;
  firstValue?: TableInsightExtremaFact;
  lastValue?: TableInsightExtremaFact;
  firstLastDelta?: number;
  firstLastDeltaRate?: number;
  notableFacts: string[];
  validationTokens: string[];
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function isTimeLikeLabel(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/(?:19|20)\d{2}/.test(normalized) || /\b\d{1,2}월\b/.test(normalized) || /\b\d{1,2}분기\b/.test(normalized)) {
    return true;
  }

  const timestamp = Date.parse(normalized.replace(/\./g, "-").replace(/년|월/g, "-").replace(/일/g, ""));
  return Number.isFinite(timestamp);
}

function getAnalysisMode(params: {
  columns: string[];
  rows: string[][];
  labelIndex: number;
}): "trend" | "ranking" | "unknown" {
  const { columns, rows, labelIndex } = params;
  const axisMetadata = buildLayoutAxisMetadata({
    columns,
    rows,
    rowCount: rows.length,
    columnCount: columns.length,
  });
  const labelValues = rows.map((row) => (row[labelIndex] ?? "").trim()).filter(Boolean);
  const categoryLikeShare = labelValues.length > 0
    ? labelValues.filter((value) => /[A-Za-z가-힣]/.test(value) && !isTimeLikeLabel(value)).length / labelValues.length
    : 0;
  const timeLikeShare = labelValues.length > 0
    ? labelValues.filter((value) => isTimeLikeLabel(value)).length / labelValues.length
    : 0;

  if (axisMetadata.timeAxisLikelyIn === "rows" || timeLikeShare >= 0.6) {
    return "trend";
  }
  if (
    axisMetadata.timeAxisLikelyIn === "none" &&
    (axisMetadata.categoryAxisLikelyIn === "rows" || categoryLikeShare >= 0.6)
  ) {
    return "ranking";
  }
  return "unknown";
}

function tokenizeForValidation(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}%.-]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseNumericCell(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const isNegativeByParens = normalized.startsWith("(") && normalized.endsWith(")");
  const withoutLeadingCurrency = normalized.replace(/^[₩$€¥£]\s*/, "");
  const withoutTrailingUnits = withoutLeadingCurrency.replace(/[a-zA-Z가-힣]+$/, "").trim();
  const candidate = withoutTrailingUnits.replace(/%$/, "").replace(/,/g, "").replace(/[()]/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(candidate)) return null;

  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) return null;
  return isNegativeByParens ? -parsed : parsed;
}

export function buildTableInsightFacts(params: {
  tableId: string;
  tableName: string;
  columns: string[];
  rows: string[][];
  dimensions?: string[];
  metrics?: string[];
}): TableInsightFacts | null {
  const { tableId, tableName, columns, rows, dimensions = [], metrics = [] } = params;
  const metricCandidates = dedupeStrings([...metrics, ...columns]);
  const metricCandidate = metricCandidates
    .map((metricName) => ({ metricName, index: columns.findIndex((column) => column === metricName) }))
    .find((candidate) => candidate.index >= 0 && rows.some((row) => parseNumericCell(row[candidate.index] ?? "") !== null));

  if (!metricCandidate) return null;

  const labelCandidates = dedupeStrings([...dimensions, ...columns.filter((column) => column !== metricCandidate.metricName)]);
  const labelCandidate = labelCandidates
    .map((labelName) => ({ labelName, index: columns.findIndex((column) => column === labelName) }))
    .find((candidate) => candidate.index >= 0 && candidate.index !== metricCandidate.index);

  const labelDimension = labelCandidate?.labelName ?? columns[Math.max(0, metricCandidate.index === 0 ? 1 : 0)] ?? "항목";
  const labelIndex = labelCandidate?.index ?? Math.max(0, metricCandidate.index === 0 ? 1 : 0);
  const analysisMode = getAnalysisMode({ columns, rows, labelIndex });

  const candidates = rows
    .map((row, rowIndex) => {
      const rawValue = row[metricCandidate.index] ?? "";
      const numericValue = parseNumericCell(rawValue);
      if (numericValue === null) return null;

      return {
        label: (row[labelIndex] ?? "").trim() || `행 ${rowIndex + 1}`,
        rawValue: rawValue.trim() || String(numericValue),
        numericValue,
      };
    })
    .filter((item): item is TableInsightExtremaFact => item !== null);

  if (candidates.length === 0) return null;

  const byMax = [...candidates].sort((left, right) => right.numericValue - left.numericValue);
  const byMin = [...candidates].sort((left, right) => left.numericValue - right.numericValue);
  const max = byMax[0];
  const min = byMin[0];
  const firstValue = candidates[0];
  const lastValue = candidates[candidates.length - 1];
  const mean = candidates.reduce((sum, item) => sum + item.numericValue, 0) / candidates.length;
  const total = candidates.reduce((sum, item) => sum + item.numericValue, 0);
  const hasComparableRange = candidates.length > 1 && max.numericValue !== min.numericValue;
  const spread = hasComparableRange ? max.numericValue - min.numericValue : null;
  const topValues = byMax.slice(0, 3).map((item) => ({ label: item.label, value: item.rawValue }));
  const topGap = analysisMode === "ranking" && hasComparableRange && byMax[1] ? max.numericValue - byMax[1].numericValue : null;
  const topGapRatio = analysisMode === "ranking" && hasComparableRange && byMax[1] && byMax[1].numericValue !== 0
    ? max.numericValue / byMax[1].numericValue
    : null;
  const shareOfTop = analysisMode === "ranking" && hasComparableRange && total !== 0 && candidates.length > 1
    ? max.numericValue / total
    : null;
  const maxVsMean = mean === 0 ? null : (max.numericValue - mean) / Math.abs(mean);
  const minVsMean = mean === 0 ? null : (mean - min.numericValue) / Math.abs(mean);
  const firstLastDelta = analysisMode === "trend" && hasComparableRange && candidates.length >= 2 ? lastValue.numericValue - firstValue.numericValue : null;
  const firstLastDeltaRate = analysisMode === "trend" && firstLastDelta !== null && firstValue.numericValue !== 0
    ? firstLastDelta / Math.abs(firstValue.numericValue)
    : null;

  const notableFacts = dedupeStrings([
    analysisMode === "trend" ? `이 표는 시간 흐름 중심으로 해석하는 것이 적절합니다.` : undefined,
    analysisMode === "ranking" ? `이 표는 항목 간 순위와 비중 중심으로 해석하는 것이 적절합니다.` : undefined,
    `${labelDimension} 기준 최대값은 ${max.label}(${max.rawValue})입니다.`,
    `${labelDimension} 기준 최소값은 ${min.label}(${min.rawValue})입니다.`,
    topGap !== null ? `상위 1위와 2위의 차이는 ${topGap}입니다.` : undefined,
    topGapRatio !== null && topGapRatio >= 1.5 ? `1위는 2위보다 ${topGapRatio.toFixed(1)}배 큽니다.` : undefined,
    shareOfTop !== null && shareOfTop >= 0.4 ? `최대 항목은 전체의 ${formatPercent(shareOfTop)}를 차지합니다.` : undefined,
    maxVsMean !== null && maxVsMean >= 0.2 ? `최대값은 평균보다 ${formatPercent(maxVsMean)} 높습니다.` : undefined,
    minVsMean !== null && minVsMean >= 0.2 ? `최소값은 평균보다 ${formatPercent(minVsMean)} 낮습니다.` : undefined,
    firstLastDelta !== null && firstLastDelta !== 0
      ? `${firstValue.label}에서 ${lastValue.label}까지 ${formatCompactNumber(firstLastDelta)} 변화했습니다.`
      : undefined,
    firstLastDeltaRate !== null && Math.abs(firstLastDeltaRate) >= 0.2
      ? `처음 대비 마지막 값은 ${formatPercent(firstLastDeltaRate)} ${firstLastDeltaRate > 0 ? "증가" : "감소"}했습니다.`
      : undefined,
    spread !== null ? `최대값과 최소값의 차이는 ${spread}입니다.` : undefined,
  ]);

  const validationTokens = dedupeStrings([
    ...tokenizeForValidation(tableName),
    ...tokenizeForValidation(metricCandidate.metricName),
    ...tokenizeForValidation(labelDimension),
    ...candidates.flatMap((item) => tokenizeForValidation(item.label)),
    ...candidates.flatMap((item) => tokenizeForValidation(item.rawValue)),
    ...topValues.flatMap((item) => tokenizeForValidation(item.value)),
    ...notableFacts.flatMap((item) => tokenizeForValidation(item)),
    formatCompactNumber(mean),
    formatCompactNumber(total),
    spread !== null ? formatCompactNumber(spread) : undefined,
    topGap !== null ? formatCompactNumber(topGap) : undefined,
    topGapRatio !== null ? topGapRatio.toFixed(1) : undefined,
    shareOfTop !== null ? formatPercent(shareOfTop) : undefined,
    firstLastDelta !== null ? formatCompactNumber(firstLastDelta) : undefined,
    firstLastDeltaRate !== null ? formatPercent(firstLastDeltaRate) : undefined,
  ]);

  return {
    tableId,
    tableName,
    analysisMode,
    metricName: metricCandidate.metricName,
    labelDimension,
    rowCount: candidates.length,
    max,
    min,
    mean,
    total,
    spread: spread ?? undefined,
    topValues,
    topGap: topGap ?? undefined,
    topGapRatio: topGapRatio ?? undefined,
    shareOfTop: shareOfTop ?? undefined,
    firstValue,
    lastValue,
    firstLastDelta: firstLastDelta ?? undefined,
    firstLastDeltaRate: firstLastDeltaRate ?? undefined,
    notableFacts,
    validationTokens,
  };
}
