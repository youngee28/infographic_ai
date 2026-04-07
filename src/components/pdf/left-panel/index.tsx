"use client";

import type { AnalysisData } from "@/lib/session-types";
import type { RawSheetGrid } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";
import { TablePreview } from "./TablePreview";

interface LeftPanelProps {
  analysisData?: AnalysisData | null;
  tableData?: TableData | null;
  rawSheetGrid?: RawSheetGrid | null;
  isTableDirty?: boolean;
  isApplyTableEditsDisabled?: boolean;
  isResetTableEditsDisabled?: boolean;
  rawFileName?: string;
  selectedLogicalTableId?: string | null;
  onCellChange?: (tableId: string, rowIndex: number, cellIndex: number, value: string) => void;
  onHeaderChange?: (tableId: string, columnIndex: number, value: string) => void;
  onLogicalTableSelect?: (tableId: string) => void;
  onResetTableEdits?: () => void;
  onApplyTableEdits?: () => void;
  onOpenSidebar?: () => void;
}

export function LeftPanel({
  analysisData,
  tableData,
  rawSheetGrid,
  isTableDirty,
  isApplyTableEditsDisabled,
  isResetTableEditsDisabled,
  rawFileName,
  selectedLogicalTableId,
  onCellChange,
  onHeaderChange,
  onLogicalTableSelect,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: LeftPanelProps) {
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
      selectedLogicalTableId={selectedLogicalTableId}
      onCellChange={onCellChange}
      onHeaderChange={onHeaderChange}
      onLogicalTableSelect={onLogicalTableSelect}
      onResetTableEdits={onResetTableEdits}
      onApplyTableEdits={onApplyTableEdits}
      onOpenSidebar={onOpenSidebar}
    />
  );
}
