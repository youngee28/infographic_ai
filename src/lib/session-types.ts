export interface ReferenceLine {
  text: string;
  pages: number[];
}

export interface SummaryVariant {
  title: string;
  content?: string;
  lines?: ReferenceLine[];
}

export interface AnalysisData {
  title?: string;
  summaries: SummaryVariant[];
  keywords: string[];
  insights: string;
  issues: string | ReferenceLine[];
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
