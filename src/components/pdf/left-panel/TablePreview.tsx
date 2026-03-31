"use client";

import { FileSpreadsheet, Menu, Sparkles, Table2 } from "lucide-react";
import type { SummaryVariant } from "@/lib/session-types";
import type { TableData } from "@/lib/table-utils";

interface TablePreviewProps {
  fileName?: string;
  summaries?: SummaryVariant[] | null;
  tableData?: TableData;
  isAnalyzing?: boolean;
  onOpenSidebar?: () => void;
}

export function TablePreview({ fileName, summaries, tableData, isAnalyzing, onOpenSidebar }: TablePreviewProps) {
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

  const primarySummary = getPrimarySummary(summaries);
  const summaryLines = getSummaryLines(primarySummary);
  const summaryContent = getSummaryContent(primarySummary);
  const hasSummary = summaryLines.length > 0 || summaryContent.length > 0;
  const resolvedFileName = fileName?.trim() || "업로드된 테이블";
  const metadataFileName = resolvedFileName.split(/[\\/]/).pop()?.trim() || resolvedFileName;

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
          </div>

          <div className="min-w-0 max-w-[45%] flex-1 text-right">
            <div className="text-[11px] leading-4 text-gray-400 break-all" title={metadataFileName}>
              {metadataFileName}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 bg-gray-50/70 border-b border-gray-200/60">
        <div className="rounded-xl border border-blue-100/70 bg-linear-to-r from-blue-50/80 via-white to-sky-50/70 px-3.5 py-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-100/80 bg-white text-blue-600 shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">AI Summary</p>
                {primarySummary?.title ? (
                  <span className="inline-flex items-center rounded-full border border-blue-100 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                    {primarySummary.title}
                  </span>
                ) : null}
              </div>

              {hasSummary ? (
                summaryLines.length > 0 ? (
                  <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-gray-700">
                    {summaryLines.map((line, index) => (
                      <li key={`${line}-${index}`} className="flex gap-2">
                        <span className="pt-0.5 text-[11px] font-semibold text-blue-600">{index + 1}.</span>
                        <span className="min-w-0">{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-gray-700 whitespace-pre-wrap">{summaryContent}</p>
                )
              ) : (
                <p className="text-[12px] leading-relaxed text-gray-500">
                  {isAnalyzing
                    ? "AI가 표 핵심 요약을 생성하는 중입니다. 미리보기 데이터는 먼저 확인할 수 있습니다."
                    : "아직 생성된 AI 요약이 없습니다. 표 미리보기는 계속 확인할 수 있습니다."}
                </p>
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

function getPrimarySummary(summaries?: SummaryVariant[] | null): SummaryVariant | null {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const firstSummary = summaries[0];
  if (hasSummaryBody(firstSummary)) {
    return firstSummary;
  }

  return summaries.find(hasSummaryBody) ?? firstSummary ?? null;
}

function hasSummaryBody(summary?: SummaryVariant | null): boolean {
  if (!summary) {
    return false;
  }

  return getSummaryLines(summary).length > 0 || getSummaryContent(summary).length > 0;
}

function getSummaryLines(summary?: SummaryVariant | null): string[] {
  if (!summary || !Array.isArray(summary.lines)) {
    return [];
  }

  return summary.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getSummaryContent(summary?: SummaryVariant | null): string {
  return summary?.content?.trim() ?? "";
}
