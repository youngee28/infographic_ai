"use client";

import { FileSpreadsheet, Menu, Table2 } from "lucide-react";
import type { SummaryVariant } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";

interface TablePreviewProps {
  fileName?: string;
  rawFileName?: string;
  summaries?: SummaryVariant[] | null;
  tableData?: TableData;
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
  isDirty,
  isApplyTableEditsDisabled,
  isResetTableEditsDisabled,
  onCellChange,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: TablePreviewProps) {
  if (!tableData) {
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
  const isEditable = Boolean(onCellChange);
  const hasEditControls = Boolean(onResetTableEdits || onApplyTableEdits);

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
              {isEditable && <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">보이는 셀만 편집 가능</span>}
              {isDirty && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">미적용 변경</span>}
            </div>
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
                {tableData.columns.map((header) => (
                  <th
                    key={header}
                    className="border-b border-r last:border-r-0 border-gray-200/70 px-3 py-2.5 text-left text-[12px] font-semibold text-gray-700 whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.rows.length === 0 ? (
                <tr>
                  <td colSpan={tableData.columnCount} className="px-4 py-8 text-center text-sm text-gray-500">
                    헤더 아래에 표시할 데이터 행이 없습니다.
                  </td>
                </tr>
              ) : (
                tableData.rows.slice(0, 40).map((row, rowIndex) => (
                  <tr key={`preview-row-${rowIndex}`} className="odd:bg-white even:bg-gray-50/40">
                    {tableData.columns.map((header, cellIndex) => {
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
