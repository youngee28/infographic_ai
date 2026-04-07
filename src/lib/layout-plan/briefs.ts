import { buildChartRecommendationsForLogicalTables } from "@/lib/chart-recommendation";
import { buildLogicalTableIdAliasMap, resolveLogicalTableId } from "@/lib/table-id-resolution";
import type {
  AnalysisData,
  AnalysisSheetStructure,
  AnalysisStructuredTable,
  SourceTable,
  TableInterpretationResult,
} from "@/lib/session-types";
import { buildLayoutDataSnippet, type TableData } from "@/lib/table-utils";
import type { LayoutPlanningTableBrief } from "./types";

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
}): LayoutPlanningTableBrief["chartHint"] {
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

export function buildLayoutTableBriefs(params: {
  sheetStructure: AnalysisSheetStructure;
  sourceTables?: SourceTable[];
  interpretationResults: TableInterpretationResult[];
  chartRecommendations?: AnalysisData["chartRecommendations"];
  tableData?: TableData;
}): LayoutPlanningTableBrief[] {
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

  return params.sheetStructure.tables
    .flatMap((table) => {
      const resolvedTableId = resolveLogicalTableId(table.id, aliases) ?? table.id;

      const sourceTable = sourceTableById.get(resolvedTableId);
      const briefTableData = logicalTableById.get(resolvedTableId)
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
        dataSnippet: briefTableData ? buildLayoutDataSnippet(briefTableData) : undefined,
      } satisfies LayoutPlanningTableBrief];
    })
    .filter(
      (brief) =>
        brief.dimensions.length > 0 ||
        brief.metrics.length > 0 ||
        brief.chartHint
    );
}

export function hasReadyLayoutBriefInputs(params: {
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
