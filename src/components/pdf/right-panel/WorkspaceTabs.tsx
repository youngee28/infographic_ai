import { IMAGE_MODELS, LAYOUT_MODELS, QNA_MODELS, type ImageModel, type LayoutModel, type QnaModel } from "@/lib/ai-models";

interface WorkspaceTabsProps {
  activeTab: "summary" | "layout" | "image";
  onChange: (tab: "summary" | "layout" | "image") => void;
  showImageTab?: boolean;
  selectedQnaModel: QnaModel;
  selectedLayoutModel: LayoutModel;
  selectedImageModel: ImageModel;
  onChangeQnaModel: (model: QnaModel) => void;
  onChangeLayoutModel: (model: LayoutModel) => void;
  onChangeImageModel: (model: ImageModel) => void;
}

export function WorkspaceTabs({
  activeTab,
  onChange,
  showImageTab = true,
  selectedQnaModel,
  selectedLayoutModel,
  selectedImageModel,
  onChangeQnaModel,
  onChangeLayoutModel,
  onChangeImageModel,
}: WorkspaceTabsProps) {
  const isImageActive = showImageTab && activeTab === "image";
  const isSummaryActive = activeTab === "summary";
  const isLayoutActive = showImageTab && activeTab === "layout";

  return (
    <div className="shrink-0 border-b border-gray-200/70 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-xl border border-gray-200/80 bg-gray-100/80 p-1 shadow-sm shadow-gray-100/80">
          <button
            type="button"
            onClick={() => onChange("summary")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "summary"
                ? "bg-white text-gray-900 shadow-sm shadow-gray-200/80"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            요약
          </button>
          {showImageTab && (
            <button
              type="button"
              onClick={() => onChange("layout")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "layout"
                  ? "bg-white text-gray-900 shadow-sm shadow-gray-200/80"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              레이아웃
            </button>
          )}
          {showImageTab && (
            <button
              type="button"
              onClick={() => onChange("image")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "image"
                  ? "bg-white text-gray-900 shadow-sm shadow-gray-200/80"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              이미지 생성
            </button>
          )}
        </div>

        {isSummaryActive ? (
          <select
            value={selectedQnaModel}
            onChange={(e) => onChangeQnaModel(e.target.value as QnaModel)}
            className="h-9 max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition-colors focus:border-blue-500"
            aria-label="요약 모델 선택"
          >
            {QNA_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : isLayoutActive ? (
          <select
            value={selectedLayoutModel}
            onChange={(e) => onChangeLayoutModel(e.target.value as LayoutModel)}
            className="h-9 max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition-colors focus:border-blue-500"
            aria-label="레이아웃 생성 모델 선택"
          >
            {LAYOUT_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : isImageActive ? (
          <select
            value={selectedImageModel}
            onChange={(e) => onChangeImageModel(e.target.value as ImageModel)}
            className="h-9 max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition-colors focus:border-blue-500"
            aria-label="이미지 생성 모델 선택"
          >
            {IMAGE_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
