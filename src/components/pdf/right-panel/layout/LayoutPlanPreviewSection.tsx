import type { ReactNode } from "react";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";
import { LayoutPlanPreview, type PreviewMode } from "./LayoutPlanPreview";
import type { PreviewDataRegistry } from "./layout-preview-data";

interface LayoutPlanPreviewRendererProps {
  plan: LayoutPlan;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataRegistry;
}

function getLayoutIntentPresentation(layoutIntent?: string | null) {
  const normalized = layoutIntent?.trim();
  return normalized ? `Intent · ${normalized}` : undefined;
}

function hasRecognizedSectionRole(role?: string | null): boolean {
  const normalized = role?.trim().toUpperCase();
  return normalized === "HOOK" || normalized === "EVIDENCE" || normalized === "CONTEXT" || normalized === "CONCLUSION";
}

interface LayoutPlanPreviewSectionProps {
  plan: LayoutPlan;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataRegistry;
  previewMode: PreviewMode;
  isGeneratingPreview: boolean;
  renderHtmlPreview: (props: LayoutPlanPreviewRendererProps) => ReactNode;
  renderFallbackPreview: (props: LayoutPlanPreviewRendererProps) => ReactNode;
  onPreviewModeSelect: (mode: PreviewMode) => void;
}

export function LayoutPlanPreviewSection({
  plan,
  analysisData,
  previewDataContext,
  previewMode,
  isGeneratingPreview,
  renderHtmlPreview,
  renderFallbackPreview,
  onPreviewModeSelect,
}: LayoutPlanPreviewSectionProps) {
  const planName = plan.name || "시안";
  const description = plan.description || "저장된 레이아웃 시안";
  const layoutIntentLabel = getLayoutIntentPresentation(plan.layoutIntent);
  const chartSectionCount = plan.sections.filter((section) => section.type === "chart-group").length;
  const roleTagCount = plan.sections.filter((section) => hasRecognizedSectionRole(section.sectionRole)).length;

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
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10.5px] font-medium text-gray-500">단일 시안</span>
        </div>
      </div>

      <div className="mt-4 rounded-[28px] border border-slate-300 bg-slate-50 p-4 text-left shadow-sm shadow-slate-200/70 md:p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-gray-500">현재 계획</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{planName}</p>
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

        <LayoutPlanPreview
          previewMode={previewMode}
          candidateName={planName}
          previewImageDataUrl={plan.previewImageDataUrl}
          htmlPreview={renderHtmlPreview({ plan, analysisData, previewDataContext })}
          fallbackPreview={renderFallbackPreview({ plan, analysisData, previewDataContext })}
        />
      </div>
    </section>
  );
}
