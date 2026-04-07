import type { ChartRecommendation, SourceTable } from "@/lib/session-types";
import type { LayoutDataSnippet } from "@/lib/table-utils";

export interface LayoutPlanningTableBrief {
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
  dataSnippet?: LayoutDataSnippet;
}
