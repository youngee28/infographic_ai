export interface ReferenceLine {
  text: string;
  pages: number[];
}

export interface SummaryVariant {
  title: string;
  content?: string;
  lines?: ReferenceLine[];
}

export interface EvidenceRef {
  tableId: string;
  rowHints: string[];
  pages: number[];
}

export type TableRole = "primary" | "supporting" | "comparison" | "breakdown" | "trend" | "reference";

export interface SourceTable {
  id: string;
  name: string;
  role: TableRole;
  purpose: string;
  context: string;
  dimensions: string[];
  metrics: string[];
  grain?: string;
  keyTakeaway?: string;
  structure?: AnalysisTableStructureKind;
  rangeLabel?: string;
  headerSummary?: string;
}

export type AnalysisTableStructureKind = "row-major" | "column-major" | "mixed" | "ambiguous";

export interface AnalysisTableHeader {
  axis: "row" | "column" | "mixed" | "ambiguous";
  headerRows?: number[];
  headerCols?: number[];
}

export interface AnalysisStructuredTable {
  id: string;
  title: string;
  structure: AnalysisTableStructureKind;
  confidence: number;
  range: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
  header: AnalysisTableHeader;
  dataRegion?: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
  dimensions: string[];
  metrics: string[];
  notes?: string[];
}

export interface AnalysisSheetStructure {
  sheetName?: string;
  tableCount: number;
  tables: AnalysisStructuredTable[];
}

export type LogicalTableSource = "detected" | "sheet";
export type LogicalTableOrientation = "row-major" | "column-major" | "ambiguous";
export type LogicalTableHeaderAxis = "row" | "column" | "ambiguous";

export interface LogicalTable {
  id: string;
  name: string;
  source: LogicalTableSource;
  orientation: LogicalTableOrientation;
  headerAxis: LogicalTableHeaderAxis;
  confidence: number;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  columns: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  normalizationNotes?: string[];
}

export interface TableRelation {
  fromTableId: string;
  toTableId: string;
  type: "same_entity" | "comparison" | "explains_driver" | "breakdown_of" | "time_continuation" | "reference_for";
  description: string;
}

export interface NarrativeItem {
  text: string;
  sourceTableIds: string[];
  evidence: EvidenceRef[];
  priority?: "high" | "medium" | "low";
  audience?: "general" | "business" | "executive";
}

export type LayoutAspectRatio = "portrait" | "square" | "landscape";
export type LayoutSectionType = "header" | "chart-group" | "kpi-group" | "takeaway" | "note";
export type LayoutChartType = "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map";

export interface LayoutGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartRecommendation {
  chartType: LayoutChartType;
  dimension: string;
  metric: string;
  reason: string;
  score: number;
}

export interface LayoutChartSpec {
  id: string;
  chartType: LayoutChartType;
  title: string;
  goal: string;
  dimension?: string;
  metric?: string;
  layout?: LayoutGeometry;
}

export interface LayoutKpiItem {
  id: string;
  label: string;
  value: string;
  layout?: LayoutGeometry;
}

export interface LayoutSection {
  id: string;
  type: LayoutSectionType;
  title?: string;
  layout?: LayoutGeometry;
  titleLayout?: LayoutGeometry;
  charts?: LayoutChartSpec[];
  items?: LayoutKpiItem[];
  note?: string;
  noteLayout?: LayoutGeometry;
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
  headerTitleLayout?: LayoutGeometry;
  headerSummaryLayout?: LayoutGeometry;
  previewImageDataUrl?: string;
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

export interface VisualizationBrief {
  headline: string;
  coreMessage: string;
  primaryTableId: string;
  supportingTableIds: string[];
  storyFlow: string[];
  chartDirections: Array<{
    tableId: string;
    chartType: LayoutChartType;
    goal: string;
  }>;
  tone: "practical" | "executive" | "editorial";
  prompt?: string;
}

export interface AnalysisData {
  schemaVersion?: "1" | "2" | "3";
  title?: string;
  dataset?: {
    title: string;
    summary: string;
    tableCount: number;
    sourceType?: TableFileType;
  };
  sheetStructure?: AnalysisSheetStructure;
  sourceInventory?: {
    tables: SourceTable[];
    relations: TableRelation[];
  };
  findings?: NarrativeItem[];
  implications?: NarrativeItem[];
  cautions?: NarrativeItem[];
  askNext?: string[];
  visualizationBrief?: VisualizationBrief;
  summaries: SummaryVariant[];
  keywords: string[];
  insights: string;
  issues: string | ReferenceLine[];
  chartRecommendations?: ChartRecommendation[];
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
  logicalTables?: LogicalTable[];
  primaryLogicalTableId?: string;
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
