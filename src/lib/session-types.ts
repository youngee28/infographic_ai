export interface ReferenceLine {
  text: string;
  pages: number[];
}

export interface SummaryVariant {
  title: string;
  content?: string;
  lines?: ReferenceLine[];
}

export type LayoutAspectRatio = "portrait" | "square" | "landscape";
export type LayoutSectionType = "header" | "chart-group" | "kpi-group" | "takeaway" | "note";
export type LayoutChartType = "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map";

export interface LayoutChartSpec {
  id: string;
  chartType: LayoutChartType;
  title: string;
  goal: string;
  dimension?: string;
  metric?: string;
}

export interface LayoutSection {
  id: string;
  type: LayoutSectionType;
  title?: string;
  charts?: LayoutChartSpec[];
  items?: Array<{ label: string; value: string }>;
  note?: string;
}

export interface LayoutVisualPolicy {
  textRatio: number;
  chartRatio: number;
  iconRatio: number;
}

export interface LayoutPlan {
  id: string;
  layoutType: "dashboard";
  aspectRatio: LayoutAspectRatio;
  name?: string;
  description?: string;
  sections: LayoutSection[];
  visualPolicy: LayoutVisualPolicy;
}

export type InfographicAspectRatioOption = "portrait" | "square" | "landscape";
export type InfographicColorToneOption = "clean" | "neutral" | "warm";
export type InfographicEmphasisOption = "visual" | "balanced" | "text";

export interface InfographicControls {
  aspectRatio?: InfographicAspectRatioOption;
  colorTone?: InfographicColorToneOption;
  emphasis?: InfographicEmphasisOption;
}

export interface AnalysisData {
  title?: string;
  summaries: SummaryVariant[];
  keywords: string[];
  insights: string;
  issues: string | ReferenceLine[];
  generatedLayoutPlans?: LayoutPlan[];
  selectedLayoutPlanId?: string;
  generatedLayoutPlan?: LayoutPlan;
  layoutPlan?: LayoutPlan;
  generatedInfographicPrompt?: string;
  infographicPrompt?: string;
  tableContext?: string;
  tableData?: NormalizedTable;
  status?: "pending" | "complete";
}

export interface NormalizedTable {
  sheetName?: string;
  columns: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  normalizationNotes?: string[];
  sourceType?: TableFileType;
}

export type TableFileType = "csv" | "xlsx";

export interface TableSession {
  id: string;
  fileName: string;
  fileType: TableFileType;
  fileBase64?: string;
  tableData: NormalizedTable;
  analysisData: AnalysisData | null;
  messages: Array<{
    role: "user" | "ai";
    content: string;
    citations?: number[];
    generatedImageDataUrl?: string;
  }>;
  infographicMessages?: Array<{
    role: "user" | "ai";
    content: string;
    generatedImageDataUrl?: string;
  }>;
  infographicControls?: InfographicControls;
  annotations?: Array<{
    id: string;
    position: { x: number; y: number; width: number; height: number; pageNumber: number };
    imageOriginBase64: string;
    messages: Array<{
      role: "user" | "ai";
      content: string;
      citations?: number[];
      generatedImageDataUrl?: string;
    }>;
    createdAt: number;
  }>;
  createdAt: number;
}
