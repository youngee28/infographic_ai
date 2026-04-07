import type { ReactNode } from "react";

interface LayoutPlanCandidateCardProps {
  index: number;
  name: string;
  description: string;
  isSelected: boolean;
  isGeneratingPreview: boolean;
  layoutIntentLabel?: string;
  chartSectionCount: number;
  roleTagCount: number;
  onSelect: () => void;
  preview: ReactNode;
}

export function LayoutPlanCandidateCard({
  index,
  name,
  description,
  isSelected,
  isGeneratingPreview,
  layoutIntentLabel,
  chartSectionCount,
  roleTagCount,
  onSelect,
  preview,
}: LayoutPlanCandidateCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`rounded-[28px] border p-4 text-left transition-all md:p-5 ${
        isSelected ? "border-slate-300 bg-slate-50 shadow-sm shadow-slate-200/70" : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-gray-500">안 {index + 1}</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{name}</p>
        </div>
        {layoutIntentLabel && (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-medium text-violet-700">
            {layoutIntentLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-medium text-gray-500">
          {chartSectionCount}개 차트 섹션
        </div>
        {roleTagCount > 0 && (
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500">
            {roleTagCount}개 role 태그
          </div>
        )}
        {isGeneratingPreview && (
          <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-medium text-blue-600">
            이미지 미리보기 생성 중
          </div>
        )}
      </div>

      {preview}
    </div>
  );
}
