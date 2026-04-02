"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Menu, Table2 } from "lucide-react";
import type { RawSheetGrid, SummaryVariant } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";

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
  onCellChange?: (rowIndex: number, cellIndex: number, value: string) => void;
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
  onCellChange,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: TablePreviewProps) {
  if (!tableData && !rawSheetGrid) {
    return (
      <div className="h-full bg-white rounded-2xl border border-gray-200/60 shadow-lg overflow-hidden flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3 text-gray-500">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
            <Table2 className="w-6 h-6 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800">표 미리보기를 준비할 수 없습니다.</h2>
          <p className="text-sm leading-relaxed">
            이 세션에는 정규화된 표 데이터가 없습니다. CSV 또는 XLSX 파일로 새 세션을 시작하면 왼쪽 패널에서 미리보기를 확인할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

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

  const previewColumns = viewMode === "raw" && rawSheetGrid
    ? rawVisibleColumnIndexes.map((index) => columnIndexToExcelLabel(index))
    : (tableData?.columns ?? []);
  const previewRows = viewMode === "raw" && rawSheetGrid
    ? rawSheetGrid.rows.map((row) => rawVisibleColumnIndexes.map((index) => row[index] ?? ""))
    : (tableData?.rows ?? []);
  const previewColCount = previewColumns.length;
  const isEditable = Boolean(onCellChange) && viewMode === "normalized" && hasNormalizedTable;
  const hasEditControls = Boolean(onResetTableEdits || onApplyTableEdits) && viewMode === "normalized" && hasNormalizedTable;

  return (
    <div className="h-full bg-white rounded-2xl border border-gray-200/60 shadow-lg overflow-hidden flex flex-col relative z-10">
      <div className="shrink-0 border-b border-gray-200/60 bg-white/90 backdrop-blur-sm">
        <div className="px-4 py-4 flex items-start gap-3">
          {onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
              aria-label="사이드바 열기"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Table Preview
            </div>
             <h2 className="text-sm font-semibold text-gray-800 truncate mt-1">{resolvedFileName}</h2>
             <div className="mt-2 flex flex-wrap items-center gap-2">
               {hasRawGrid && viewMode === "raw" && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">원본 시트 보기</span>}
               {isEditable && <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">보이는 셀만 편집 가능</span>}
               {isDirty && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">미적용 변경</span>}
             </div>
             {(hasRawGrid || hasNormalizedTable) && (
               <div className="mt-3 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                 {hasRawGrid && (
                   <button
                     type="button"
                     onClick={() => setViewMode("raw")}
                     className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${viewMode === "raw" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                   >
                     시트 원본
                   </button>
                 )}
                 {hasNormalizedTable && (
                   <button
                     type="button"
                     onClick={() => setViewMode("normalized")}
                     className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${viewMode === "normalized" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                   >
                     편집용 표
                   </button>
                 )}
               </div>
             )}
           </div>

          <div className="min-w-0 max-w-[45%] flex-1">
            <div className="flex flex-col items-end gap-3 text-right">
              <div className="text-[11px] leading-4 text-gray-400 break-all" title={metadataFileName}>
                {metadataFileName}
              </div>
                {hasEditControls && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {onResetTableEdits && (
                    <button
                      type="button"
                      onClick={onResetTableEdits}
                      disabled={isResetTableEditsDisabled}
                      className="text-xs font-medium rounded-md px-3 py-1.5 border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:border-gray-300 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      되돌리기
                    </button>
                  )}
                  {onApplyTableEdits && (
                    <button
                      type="button"
                      onClick={onApplyTableEdits}
                      disabled={isApplyTableEditsDisabled}
                      className="text-xs font-semibold rounded-md px-3 py-1.5 border border-blue-600 bg-blue-600 text-white transition-colors hover:bg-blue-700 hover:border-blue-700 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      변경 적용
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-white">
        <div className="min-w-max p-4">
          <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200/70 bg-white shadow-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm">
              <tr>
                <th className="border-b border-r border-gray-200/70 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap bg-gray-100/90 min-w-[56px]">
                  {viewMode === "raw" ? "#" : ""}
                </th>
                {previewColumns.map((header, index) => (
                  <th
                    key={`${header}-${index}`}
                    className="border-b border-r last:border-r-0 border-gray-200/70 px-3 py-2.5 text-left text-[12px] font-semibold text-gray-700 whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.length === 0 ? (
                <tr>
                  <td className="border-b border-r border-gray-200/60 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 bg-gray-50 min-w-[56px]">
                    1
                  </td>
                  <td colSpan={previewColCount} className="px-4 py-8 text-center text-sm text-gray-500">
                    헤더 아래에 표시할 데이터 행이 없습니다.
                  </td>
                </tr>
              ) : (
                previewRows.slice(0, 80).map((row, rowIndex) => (
                  <tr key={`preview-row-${rowIndex}`} className="odd:bg-white even:bg-gray-50/40">
                    <td className="border-b border-r border-gray-200/60 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 bg-gray-50/80 min-w-[56px] sticky left-0">
                      {rowIndex + 1}
                    </td>
                    {previewColumns.map((header, cellIndex) => {
                      const cell = row[cellIndex] ?? "";

                      return (
                      <td
                        key={`preview-cell-${rowIndex}-${cellIndex}`}
                        className="max-w-[240px] border-b border-r last:border-r-0 border-gray-200/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 align-top whitespace-pre-wrap break-words"
                      >
                        {isEditable ? (
                          <input
                            type="text"
                            value={cell}
                            onChange={(event) => onCellChange?.(rowIndex, cellIndex, event.target.value)}
                            placeholder="값 없음"
                            aria-label={`${rowIndex + 1}행 ${header} 편집`}
                            className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[12.5px] leading-relaxed text-gray-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100 placeholder:text-gray-300"
                          />
                        ) : (
                          cell || <span className="text-gray-300">—</span>
                        )}
                      </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
