import { Rows3 } from "lucide-react";
import type { TableChartRecommendationCaptionItem } from "@/lib/session-types";

interface TableContextCaptionProps {
  items: TableChartRecommendationCaptionItem[];
}

export function TableContextCaption({ items }: TableContextCaptionProps) {
  if (items.length === 0) return null;

  return (
    <div className="mb-5 animate-in fade-in duration-500 delay-100">
      <div className="text-[12px] font-bold text-slate-700 mb-2.5 flex items-center tracking-tight">
        <Rows3 className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> 표별 추천 차트 결과
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.tableId} className="rounded-md border border-slate-200/70 bg-white/80 px-3 py-3 text-[12.5px] leading-relaxed text-slate-700">
              <div className="space-y-1">
                <div><span className="font-semibold text-slate-900">표 제목</span>: {item.tableTitle}</div>
                <div><span className="font-semibold text-slate-900">추천 차트</span>: {item.recommendedChart}</div>
                <div><span className="font-semibold text-slate-900">추천 근거</span>: {item.rationale}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
