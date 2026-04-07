import { FileSpreadsheet, Menu } from "lucide-react";
import type { TableData } from "@/lib/table-utils";

interface TablePreviewHeaderProps {
  resolvedFileName: string;
  metadataFileName: string;
  hasRawGrid: boolean;
  hasNormalizedTable: boolean;
  viewMode: "raw" | "normalized";
  isEditable: boolean;
  isDirty?: boolean;
  hasEditControls: boolean;
  isApplyTableEditsDisabled?: boolean;
  isResetTableEditsDisabled?: boolean;
  logicalTables?: TableData["logicalTables"];
  activeLogicalTableId?: string | null;
  onViewModeChange: (viewMode: "raw" | "normalized") => void;
  onLogicalTableSelect?: (tableId: string) => void;
  onResetTableEdits?: () => void;
  onApplyTableEdits?: () => void;
  onOpenSidebar?: () => void;
}

export function TablePreviewHeader({
  resolvedFileName,
  metadataFileName,
  hasRawGrid,
  hasNormalizedTable,
  viewMode,
  isEditable,
  isDirty,
  hasEditControls,
  isApplyTableEditsDisabled,
  isResetTableEditsDisabled,
  logicalTables,
  activeLogicalTableId,
  onViewModeChange,
  onLogicalTableSelect,
  onResetTableEdits,
  onApplyTableEdits,
  onOpenSidebar,
}: TablePreviewHeaderProps) {
  return (
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
            {isEditable && <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">헤더와 셀 값을 수정하면 적용 후 분석/레이아웃에 반영됩니다</span>}
            {isDirty && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">미적용 변경</span>}
          </div>
          {(hasRawGrid || hasNormalizedTable) && (
            <div className="mt-3 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              {hasRawGrid && (
                <button
                  type="button"
                  onClick={() => onViewModeChange("raw")}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${viewMode === "raw" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  시트 원본
                </button>
              )}
              {hasNormalizedTable && (
                <button
                  type="button"
                  onClick={() => onViewModeChange("normalized")}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${viewMode === "normalized" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  시트 편집
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
            {viewMode === "normalized" && logicalTables && logicalTables.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {logicalTables.map((table) => {
                  const selected = table.id === activeLogicalTableId;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => onLogicalTableSelect?.(table.id)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"}`}
                    >
                      {table.name || table.id}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
