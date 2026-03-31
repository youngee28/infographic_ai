"use client";

import type { AnalysisData } from "@/lib/session-types";
import { TablePreview } from "./TablePreview";

interface LeftPanelProps {
  fileUrl: string | null;
  sessionId: string | null;
  pageNumber?: number;
  analysisData?: AnalysisData | null;
  rawFileName?: string;
  onOpenSidebar?: () => void;
  onPageChange?: (page: number) => void;
}

export function LeftPanel({ fileUrl, analysisData, rawFileName, onOpenSidebar }: LeftPanelProps) {
  if (!fileUrl) return null;

  return (
    <TablePreview
      fileName={analysisData?.title}
      rawFileName={rawFileName}
      summaries={analysisData?.summaries}
      tableData={analysisData?.tableData}
      isAnalyzing={analysisData?.status !== "complete"}
      onOpenSidebar={onOpenSidebar}
    />
  );
}
