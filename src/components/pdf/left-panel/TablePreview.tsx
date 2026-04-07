"use client";

import { useMemo, useState } from "react";
import type { RawSheetGrid, SummaryVariant } from "@/lib/session-types";
import { getEditableLogicalTable, type TableData } from "@/lib/table-utils";
import { TablePreviewEmptyState } from "./TablePreviewEmptyState";
import { TablePreviewGrid } from "./TablePreviewGrid";
import { TablePreviewToolbar } from "./TablePreviewToolbar";

function columnIndexToExcelLabel(index: number): string {
  let current = index;
  let label = "";

  while (current >= 0) {
    label = String.fromCharCode((current % 26) + 65) + label;
    current = Math.floor(current / 26) - 1;
  }

  return label;
}

interface TablePreviewProps {
  fileName?: string;
  rawFileName?: string;
  summaries?: SummaryVariant[] | null;
  tableData?: TableData;
  rawSheetGrid?: RawSheetGrid | null;
  isAnalyzing?: boolean;
  isDirty?: boolean;
  isApplyTableEditsDisabled?: boolean;
  isResetTableEditsDisabled?: boolean;
  selectedLogicalTableId?: string | null;
  onCellChange?: (tableId: string, rowIndex: number, cellIndex: number, value: string) => void;
  onHeaderChange?: (tableId: string, columnIndex: number, value: string) => void;
  onLogicalTableSelect?: (tableId: string) => void;
  onResetTableEdits?: () => void;
  onApplyTableEdits?: () => void;
  onOpenSidebar?: () => void;
}

export function TablePreview({
  fileName,
  rawFileName,
  tableData,
  rawSheetGrid,
  isDirty,
  isApplyTableEditsDisabled,
  isResetTableEditsDisabled,
  selectedLogicalTableId,
  onCellChange,
  onHeaderChange,
  onLogicalTableSelect,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: TablePreviewProps) {
  const resolvedFileName = fileName?.trim() || "업로드된 테이블";
  const resolvedRawFileName = rawFileName?.trim() || resolvedFileName;
  const metadataFileName = resolvedRawFileName.split(/[\\/]/).pop()?.trim() || resolvedRawFileName;
  const hasRawGrid = Boolean(rawSheetGrid);
  const hasNormalizedTable = Boolean(tableData);
  const [viewMode, setViewMode] = useState<"raw" | "normalized">(hasRawGrid ? "raw" : "normalized");

  const rawVisibleColumnIndexes = useMemo(() => {
    if (!rawSheetGrid) return [];
    const indexes: number[] = [];
    for (let columnIndex = 0; columnIndex < rawSheetGrid.columnCount; columnIndex += 1) {
      const hasValue = rawSheetGrid.rows.some((row) => String(row[columnIndex] ?? "").trim().length > 0);
      if (hasValue) indexes.push(columnIndex);
    }
    return indexes;
  }, [rawSheetGrid]);

  const editableLogicalTable = useMemo(() => {
    if (!tableData) return null;
    return getEditableLogicalTable(tableData, selectedLogicalTableId);
  }, [selectedLogicalTableId, tableData]);

  if (!tableData && !rawSheetGrid) {
    return <TablePreviewEmptyState />;
  }

  const previewColumns = viewMode === "raw" && rawSheetGrid
    ? rawVisibleColumnIndexes.map((index) => columnIndexToExcelLabel(index))
    : (editableLogicalTable?.columns ?? tableData?.columns ?? []);
  const previewRows = viewMode === "raw" && rawSheetGrid
    ? rawSheetGrid.rows.map((row) => rawVisibleColumnIndexes.map((index) => row[index] ?? ""))
    : (editableLogicalTable?.rows ?? tableData?.rows ?? []);
  const isEditable = Boolean(onCellChange) && viewMode === "normalized" && hasNormalizedTable;
  const hasEditControls = Boolean(onResetTableEdits || onApplyTableEdits) && viewMode === "normalized" && hasNormalizedTable;
  const activeLogicalTableId = editableLogicalTable?.tableId;

  return (
    <div className="h-full bg-white rounded-2xl border border-gray-200/60 shadow-lg overflow-hidden flex flex-col relative z-10">
      <TablePreviewToolbar
        resolvedFileName={resolvedFileName}
        metadataFileName={metadataFileName}
        hasRawGrid={hasRawGrid}
        hasNormalizedTable={hasNormalizedTable}
        viewMode={viewMode}
        isEditable={isEditable}
        isDirty={isDirty}
        hasEditControls={hasEditControls}
        isApplyTableEditsDisabled={isApplyTableEditsDisabled}
        isResetTableEditsDisabled={isResetTableEditsDisabled}
        logicalTables={tableData?.logicalTables}
        activeLogicalTableId={activeLogicalTableId}
        onViewModeChange={setViewMode}
        onLogicalTableSelect={onLogicalTableSelect}
        onResetTableEdits={onResetTableEdits}
        onApplyTableEdits={onApplyTableEdits}
        onOpenSidebar={onOpenSidebar}
      />

      <div className="flex-1 min-h-0 overflow-auto bg-white">
        <TablePreviewGrid
          viewMode={viewMode}
          previewColumns={previewColumns}
          previewRows={previewRows}
          isEditable={isEditable}
          activeLogicalTableId={activeLogicalTableId}
          onHeaderChange={onHeaderChange}
          onCellChange={onCellChange}
        />
      </div>
    </div>
  );
}
