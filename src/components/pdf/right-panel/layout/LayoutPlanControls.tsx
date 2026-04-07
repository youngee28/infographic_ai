import { RotateCcw } from "lucide-react";

interface LayoutPlanSourceTable {
  id: string;
  name: string;
}

interface LayoutPlanControlsProps {
  promptDraft: string;
  isSubmittingPrompt: boolean;
  isAnalyzing?: boolean;
  sourceTables: LayoutPlanSourceTable[];
  selectedSourceTableIds: string[];
  onPromptDraftChange: (value: string) => void;
  onResetPrompt: () => void;
  onSaveAndRegenerate: () => void;
  onToggleSourceTableSelection: (tableId: string) => void;
}

export function LayoutPlanControls({
  promptDraft,
  isSubmittingPrompt,
  isAnalyzing,
  sourceTables,
  selectedSourceTableIds,
  onPromptDraftChange,
  onResetPrompt,
  onSaveAndRegenerate,
  onToggleSourceTableSelection,
}: LayoutPlanControlsProps) {
  return (
    <section className="rounded-[28px] border border-gray-200/80 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Image Direction</p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900">이미지 생성 보조 지침</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">레이아웃 구조는 앱이 분석 결과로 자동 계산합니다. 아래 지침은 인포그래픽 이미지 생성 시 연출 방향을 보강할 때 사용됩니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResetPrompt}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 기본값
          </button>
          <button
            type="button"
            onClick={onSaveAndRegenerate}
            disabled={isSubmittingPrompt || isAnalyzing}
            className="inline-flex items-center rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            {isSubmittingPrompt || isAnalyzing ? "다시 계산 중..." : "저장 후 다시 계산"}
          </button>
        </div>
      </div>

      <textarea
        value={promptDraft}
        onChange={(event) => onPromptDraftChange(event.target.value)}
        rows={3}
        placeholder="이미지 생성 시 추가로 반영할 연출 지침을 입력하세요"
        className="mt-4 min-h-[96px] w-full resize-y rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3 text-[12.5px] leading-relaxed text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:bg-white"
      />

      {sourceTables.length > 0 && (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Source Tables</p>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">선택한 표는 저장되며, 다시 계산할 때 레이아웃과 이미지 문맥에 우선 반영됩니다.</p>
            </div>
            <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10.5px] font-medium text-gray-500">{selectedSourceTableIds.length}개 선택</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {sourceTables.map((table) => {
              const selected = selectedSourceTableIds.includes(table.id);
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => onToggleSourceTableSelection(table.id)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"}`}
                >
                  {table.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
