import type { ReactNode } from "react";
import { LayoutPlanCandidateCard } from "./LayoutPlanCandidateCard";
import type { PreviewMode } from "./LayoutPlanPreview";

export interface LayoutPlanCandidateListItem {
  id: string;
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

interface LayoutPlanCandidatesProps {
  previewMode: PreviewMode;
  candidates: LayoutPlanCandidateListItem[];
  onPreviewModeSelect: (mode: PreviewMode) => void;
}

export function LayoutPlanCandidates({ previewMode, candidates, onPreviewModeSelect }: LayoutPlanCandidatesProps) {
  return (
    <section className="rounded-[28px] border border-gray-200/80 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Layout Plan</p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900">앱 계산 레이아웃</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">HTML 모드에서는 앱이 계산한 layoutPlan의 제목·설명·sections를 읽기 전용으로 렌더링합니다. 이미지 모드에서는 같은 계획을 바탕으로 Gemini 미리보기를 생성합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-gray-200/80 bg-gray-100/80 p-1 shadow-sm shadow-gray-100/80">
            {([
              { id: "html", label: "HTML" },
              { id: "image", label: "이미지" },
            ] as const).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onPreviewModeSelect(mode.id)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  previewMode === mode.id ? "bg-white text-gray-900 shadow-sm shadow-gray-200/80" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10.5px] font-medium text-gray-500">{candidates.length}개 시안</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {candidates.map((candidate) => (
          <LayoutPlanCandidateCard
            key={candidate.id}
            index={candidate.index}
            name={candidate.name}
            description={candidate.description}
            isSelected={candidate.isSelected}
            isGeneratingPreview={candidate.isGeneratingPreview}
            layoutIntentLabel={candidate.layoutIntentLabel}
            chartSectionCount={candidate.chartSectionCount}
            roleTagCount={candidate.roleTagCount}
            onSelect={candidate.onSelect}
            preview={candidate.preview}
          />
        ))}
      </div>
    </section>
  );
}
