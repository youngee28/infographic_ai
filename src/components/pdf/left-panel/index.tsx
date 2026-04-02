"use client";

import type { AnalysisData } from "@/lib/session-types";
import type { RawSheetGrid } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";
import { TablePreview } from "./TablePreview";

interface LeftPanelProps {
  fileUrl: string | null;
  sessionId: string | null;
  pageNumber?: number;
  analysisData?: AnalysisData | null;
  tableData?: TableData | null;
  rawSheetGrid?: RawSheetGrid | null;
  isTableDirty?: boolean;
  isApplyTableEditsDisabled?: boolean;
  isResetTableEditsDisabled?: boolean;
  rawFileName?: string;
  onCellChange?: (rowIndex: number, cellIndex: number, value: string) => void;
  onResetTableEdits?: () => void;
  onApplyTableEdits?: () => void;
  onOpenSidebar?: () => void;
  onPageChange?: (page: number) => void;
}

export function LeftPanel({
  fileUrl,
  analysisData,
  tableData,
  rawSheetGrid,
  isTableDirty,
  isApplyTableEditsDisabled,
  isResetTableEditsDisabled,
  rawFileName,
  onCellChange,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: LeftPanelProps) {
  if (!fileUrl) return null;

  return (
    <TablePreview
      fileName={analysisData?.title}
      rawFileName={rawFileName}
      summaries={analysisData?.summaries}
      tableData={tableData ?? analysisData?.tableData}
      rawSheetGrid={rawSheetGrid}
      isAnalyzing={analysisData?.status !== "complete"}
      isDirty={isTableDirty}
      isApplyTableEditsDisabled={isApplyTableEditsDisabled}
      isResetTableEditsDisabled={isResetTableEditsDisabled}
      onCellChange={onCellChange}
      onResetTableEdits={onResetTableEdits}
      onApplyTableEdits={onApplyTableEdits}
      onOpenSidebar={onOpenSidebar}
    />
  );
}
