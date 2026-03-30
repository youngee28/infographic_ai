"use client";

import type { ReactNode } from "react";
import { Database, FileSpreadsheet, Menu, Rows3, Table2 } from "lucide-react";
import type { TableData } from "@/lib/table-utils";

interface TablePreviewProps {
  fileName?: string;
  tableData?: TableData;
  isAnalyzing?: boolean;
  onOpenSidebar?: () => void;
}

export function TablePreview({ fileName, tableData, isAnalyzing, onOpenSidebar }: TablePreviewProps) {
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

  return (
    <div className="h-full bg-white rounded-2xl border border-gray-200/60 shadow-lg overflow-hidden flex flex-col relative z-10">
      <div className="shrink-0 border-b border-gray-200/60 bg-white/90 backdrop-blur-sm">
        <div className="px-4 py-3 flex items-center gap-3">
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
            <h2 className="text-sm font-semibold text-gray-800 truncate mt-1">{fileName ?? "업로드된 테이블"}</h2>
          </div>

          <div className="text-right text-xs text-gray-500 shrink-0">
            <div className="font-semibold text-gray-700">{(tableData.sourceType ?? "csv").toUpperCase()}</div>
            {tableData.sheetName && <div>{tableData.sheetName}</div>}
          </div>
        </div>

        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard icon={<Rows3 className="w-4 h-4 text-blue-600" />} label="행" value={`${tableData.rowCount.toLocaleString()} rows`} />
          <MetricCard icon={<Database className="w-4 h-4 text-blue-600" />} label="열" value={`${tableData.columnCount.toLocaleString()} cols`} />
          <MetricCard
            icon={<Table2 className="w-4 h-4 text-blue-600" />}
            label="상태"
            value={isAnalyzing ? "인사이트 생성 중" : "미리보기 준비 완료"}
          />
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 bg-gray-50/70 border-b border-gray-200/60 space-y-2">
        <p className="text-xs font-semibold text-gray-700">정규화 메모</p>
        <div className="flex flex-wrap gap-2">
          {(tableData.normalizationNotes ?? []).map((note) => (
            <span
              key={note}
              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600"
            >
              {note}
            </span>
          ))}
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
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`preview-cell-${rowIndex}-${cellIndex}`}
                        className="max-w-[240px] border-b border-r last:border-r-0 border-gray-200/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 align-top whitespace-pre-wrap break-words"
                      >
                        {cell || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
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

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-gray-800">{value}</div>
    </div>
  );
}
