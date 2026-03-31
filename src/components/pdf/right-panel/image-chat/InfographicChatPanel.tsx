"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import { useAppStore } from "@/lib/app-store";
import { store } from "@/lib/store";
import type {
  AnalysisData,
  InfographicControls,
} from "@/lib/session-types";
import { ImageChatInput } from "./ImageChatInput";
import { ImageChatTimeline } from "./ImageChatTimeline";
import type { ImageChatMessage } from "./types";

interface InfographicChatPanelProps {
  sessionId?: string | null;
  analysisData?: AnalysisData | null;
  isAnalyzing?: boolean;
}

interface ToastState {
  message: string;
  type: "success" | "error";
}

interface ControlOptionDefinition {
  label: string;
  prompt: string;
}

const ASPECT_RATIO_OPTIONS = {
  portrait: {
    label: "세로형",
    prompt: "세로로 긴 캔버스를 기준으로 위에서 아래로 읽히는 정보 흐름과 단계적 구성을 우선하세요.",
  },
  square: {
    label: "정사각",
    prompt: "1:1에 가까운 정사각 구도에서 핵심 카드와 비교 블록이 균형 있게 보이도록 구성하세요.",
  },
  landscape: {
    label: "가로형",
    prompt: "가로로 넓은 캔버스에서 좌우 비교, 시계열 흐름, 여러 섹션 병렬 배치를 우선하세요.",
  },
} as const;

const COLOR_TONE_OPTIONS = {
  clean: {
    label: "클린 블루",
    prompt: "화이트와 블루 계열을 중심으로 선명하고 신뢰감 있는 데이터 시각 톤을 사용하세요.",
  },
  neutral: {
    label: "뉴트럴",
    prompt: "채도를 낮춘 뉴트럴 톤으로 차분하고 문서형에 가까운 인포그래픽 무드를 유지하세요.",
  },
  warm: {
    label: "웜 포인트",
    prompt: "따뜻한 강조색을 사용해 주요 수치와 액션 포인트가 더 눈에 띄도록 구성하세요.",
  },
} as const;

const EMPHASIS_OPTIONS = {
  visual: {
    label: "그래픽 중심",
    prompt: "도식, 수치 카드, 아이콘, 차트형 레이아웃 비중을 높이고 설명 텍스트는 최소화하세요.",
  },
  balanced: {
    label: "균형형",
    prompt: "그래픽 요소와 짧은 설명 텍스트를 균형 있게 섞어 빠른 이해와 맥락 전달을 함께 노리세요.",
  },
  text: {
    label: "텍스트 중심",
    prompt: "설명 문구와 요약 카피 비중을 높여 읽는 흐름과 해석 포인트가 분명하게 보이도록 하세요.",
  },
} as const;

const DEFAULT_INFOGRAPHIC_CONTROLS: InfographicControls = {};

const buildControlSummary = ({ aspectRatio, colorTone, emphasis }: InfographicControls) => {
  return [
    aspectRatio ? ASPECT_RATIO_OPTIONS[aspectRatio].label : null,
    colorTone ? COLOR_TONE_OPTIONS[colorTone].label : null,
    emphasis ? EMPHASIS_OPTIONS[emphasis].label : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const buildControlPrompt = ({ aspectRatio, colorTone, emphasis }: InfographicControls) => {
  return [
    aspectRatio ? `- 화면 비율: ${ASPECT_RATIO_OPTIONS[aspectRatio].label} — ${ASPECT_RATIO_OPTIONS[aspectRatio].prompt}` : null,
    colorTone ? `- 컬러 톤: ${COLOR_TONE_OPTIONS[colorTone].label} — ${COLOR_TONE_OPTIONS[colorTone].prompt}` : null,
    emphasis ? `- 그래픽/텍스트 비중: ${EMPHASIS_OPTIONS[emphasis].label} — ${EMPHASIS_OPTIONS[emphasis].prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildEffectiveRequest = (
  content: string,
  controls: InfographicControls,
  options?: { includeSelectionLabel?: boolean; includeControlSummary?: boolean }
) => {
  const trimmedContent = content.trim();
  if (options?.includeControlSummary === false) {
    return trimmedContent;
  }

  const controlSummary = buildControlSummary(controls);
  const selectionSummary = controlSummary
    ? options?.includeSelectionLabel === false
      ? controlSummary
      : `선택 속성: ${controlSummary}`
    : "";

  if (!trimmedContent) {
    return selectionSummary;
  }

  if (!selectionSummary) {
    return trimmedContent;
  }

  return `${trimmedContent}\n\n${selectionSummary}`;
};

const buildInfographicContext = (analysisData?: AnalysisData | null, promptOverride?: string) => {
  if (!analysisData) return "";

  const summaryLines = analysisData.summaries.flatMap((summary) => summary.lines?.map((line) => line.text) ?? []);
  const issueLines = Array.isArray(analysisData.issues)
    ? analysisData.issues.map((issue) => issue.text)
    : typeof analysisData.issues === "string" && analysisData.issues.trim()
      ? [analysisData.issues.trim()]
      : [];

  return [
    analysisData.title ? `데이터셋 제목: ${analysisData.title}` : "",
    analysisData.keywords.length > 0 ? `핵심 키워드: ${analysisData.keywords.join(", ")}` : "",
    summaryLines.length > 0 ? `핵심 인사이트: ${summaryLines.slice(0, 6).join(" | ")}` : "",
    issueLines.length > 0 ? `주의 포인트: ${issueLines.slice(0, 4).join(" | ")}` : "",
    (promptOverride ?? analysisData.infographicPrompt)?.trim()
      ? `기본 인포그래픽 브리프: ${(promptOverride ?? analysisData.infographicPrompt)?.trim()}`
      : "",
    analysisData.tableContext ? `테이블 컨텍스트:\n${analysisData.tableContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildDerivedPrompt = (analysisData?: AnalysisData | null) => {
  if (!analysisData) {
    return "핵심 수치와 비교 구조가 잘 드러나는 세로형 인포그래픽으로 구성해줘.";
  }

  const keywordText = analysisData.keywords.slice(0, 3).join(", ");
  return `${analysisData.title ?? "이 데이터"}를 바탕으로 핵심 수치와 비교 포인트가 잘 보이는 세로형 인포그래픽으로 구성해줘.${keywordText ? ` ${keywordText}를 우선 강조해줘.` : ""}`;
};

const getGeneratedPrompt = (analysisData?: AnalysisData | null) => {
  if (!analysisData) {
    return buildDerivedPrompt(analysisData);
  }

  return analysisData.generatedInfographicPrompt?.trim() || analysisData.infographicPrompt?.trim() || buildDerivedPrompt(analysisData);
};

const getActivePrompt = (analysisData?: AnalysisData | null) => {
  if (!analysisData) {
    return buildDerivedPrompt(analysisData);
  }

  return analysisData.infographicPrompt?.trim() || getGeneratedPrompt(analysisData);
};

export function InfographicChatPanel({ sessionId, analysisData, isAnalyzing }: InfographicChatPanelProps) {
  const [isHydrating, setIsHydrating] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ImageChatMessage[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [controls, setControls] = useState<InfographicControls>(DEFAULT_INFOGRAPHIC_CONTROLS);
  const [isBriefExpanded, setIsBriefExpanded] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [isPromptDirty, setIsPromptDirty] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const setAnalysisData = useAppStore((s) => s.setAnalysisData);
  const sessionKey = sessionId ?? "default-image-chat";
  const autoGeneratedRef = useRef<Record<string, string>>({});
  const activeSessionKeyRef = useRef(sessionKey);
  const requestCounterRef = useRef(0);
  const generatedPrompt = useMemo(() => getGeneratedPrompt(analysisData), [analysisData]);
  const activePrompt = useMemo(() => getActivePrompt(analysisData), [analysisData]);
  const hasCustomPrompt = activePrompt.trim() !== generatedPrompt.trim();
  const isPendingAnalysis = isHydrating || isAnalyzing || !analysisData || analysisData.status === "pending";

  const persistSessionInfographicState = useCallback(
    async (nextMessages: ImageChatMessage[], nextControls?: InfographicControls) => {
      if (!sessionId) return;
      const session = await store.getSession(sessionId);
      if (!session) return;
      await store.saveSession({
        ...session,
        infographicMessages: nextMessages,
        infographicControls: nextControls ?? session.infographicControls,
      });
    },
    [sessionId]
  );

  const setSessionMessages = useCallback(
    (nextMessages: ImageChatMessage[], nextControls?: InfographicControls) => {
      setMessages(nextMessages);
      void persistSessionInfographicState(nextMessages, nextControls);
    },
    [persistSessionInfographicState]
  );

  const showToast = useCallback((message: string, type: ToastState["type"]) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  }, []);

  const persistPrompt = useCallback(
    async (nextPrompt: string, options?: { toastMessage?: string }) => {
      const normalizedPrompt = nextPrompt.trim() || generatedPrompt;
      const nextAnalysisData = analysisData
        ? {
            ...analysisData,
            generatedInfographicPrompt: analysisData.generatedInfographicPrompt?.trim() || generatedPrompt,
            infographicPrompt: normalizedPrompt,
          }
        : null;

      if (sessionId) {
        const session = await store.getSession(sessionId);
        if (session) {
          const sessionAnalysisData = session.analysisData ?? nextAnalysisData;
          await store.saveSession({
            ...session,
            analysisData: sessionAnalysisData
              ? {
                  ...sessionAnalysisData,
                  generatedInfographicPrompt: sessionAnalysisData.generatedInfographicPrompt?.trim() || generatedPrompt,
                  infographicPrompt: normalizedPrompt,
                }
              : null,
          });
        }
      }

      if (nextAnalysisData) {
        setAnalysisData(nextAnalysisData);
      }
      setPromptDraft(normalizedPrompt);
      setIsPromptDirty(false);

      if (options?.toastMessage) {
        showToast(options.toastMessage, "success");
      }

      return normalizedPrompt;
    },
    [analysisData, generatedPrompt, sessionId, setAnalysisData, showToast]
  );

  const handleGenerate = useCallback(
    async (
      content: string,
      promptOverride?: string,
      options?: {
        showUserPrompt?: boolean;
        includeSelectionLabel?: boolean;
        includeControlPrompt?: boolean;
        includeControlSummary?: boolean;
      }
    ) => {
      if (isGenerating || !analysisData || analysisData.status === "pending") return;

      const startedSessionKey = sessionKey;
      const requestId = requestCounterRef.current + 1;
      requestCounterRef.current = requestId;
      const appliedControls = controls;
      const showUserPrompt = options?.showUserPrompt ?? true;
      const includeControlPrompt = options?.includeControlPrompt ?? true;
      const userContent = buildEffectiveRequest(content, controls, {
        includeSelectionLabel: options?.includeSelectionLabel,
        includeControlSummary: options?.includeControlSummary,
      });

      const history = showUserPrompt ? [...messages, { role: "user" as const, content: userContent }] : messages;

      if (showUserPrompt) {
        setSessionMessages(history);
      }
      setIsGenerating(true);

      try {
        const apiKey = localStorage.getItem("gemini_api_key");
        if (!apiKey) throw new Error("API 키가 없습니다.");

        const ai = new GoogleGenAI({ apiKey });
        const controlPrompt = includeControlPrompt ? buildControlPrompt(controls) : "";
        const imagePrompt = `${buildInfographicContext(analysisData, promptOverride)}

이전 인포그래픽 작업 내역:
${history
          .slice(-6)
          .map((message) => {
            if (message.role === "user") {
              return `[사용자 요청] ${message.content}`;
            }

            return `[직전 결과 메모] ${message.content}`;
          })
          .join("\n\n")}

${controlPrompt ? `선택된 인포그래픽 속성 (기존 브리프나 다른 요청과 충돌하더라도 아래 속성을 우선 반영):
${controlPrompt}

` : ""}최신 사용자 요청: ${userContent}

위 테이블 데이터와 작업 내역을 바탕으로 정보 밀도가 높은 인포그래픽 또는 데이터 비주얼을 생성하세요. 제목, 핵심 지표 강조, 비교 구조, 읽는 순서를 반영한 결과를 우선합니다.`;

        const imageResult = await ai.models.generateContent({
          model: selectedImageModel,
          contents: imagePrompt,
        });

        const parts = imageResult.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
        const generatedImagePart = parts.find(
          (part) => part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")
        );
        const generatedText = parts
          .map((part) => part.text?.trim() ?? "")
          .filter(Boolean)
          .join("\n\n");

        const generatedImageDataUrl = generatedImagePart?.inlineData
          ? `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`
          : undefined;

        const aiMessage: ImageChatMessage = {
          role: "ai",
          content: generatedImageDataUrl
            ? generatedText || "요청한 방향을 반영해 대표 인포그래픽 시안을 갱신했습니다."
            : generatedText || "인포그래픽을 생성하지 못했습니다. 강조할 지표나 레이아웃을 조금 더 구체적으로 입력해 주세요.",
          generatedImageDataUrl,
        };

        if (activeSessionKeyRef.current !== startedSessionKey || requestCounterRef.current !== requestId) {
          return;
        }
        setSessionMessages([...history, aiMessage], appliedControls);
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : "오류가 발생했습니다.";
        if (activeSessionKeyRef.current !== startedSessionKey || requestCounterRef.current !== requestId) {
          return;
        }
        setSessionMessages(
          [...history, { role: "ai", content: `요청 처리 중 오류가 발생했습니다: ${message}` }],
          appliedControls
        );
      } finally {
        if (activeSessionKeyRef.current === startedSessionKey && requestCounterRef.current === requestId) {
          setIsGenerating(false);
        }
      }
    },
    [analysisData, controls, isGenerating, messages, selectedImageModel, sessionKey, setSessionMessages]
  );

  useEffect(() => {
    activeSessionKeyRef.current = sessionKey;
    setIsGenerating(false);
  }, [sessionKey]);

  useEffect(() => {
    let cancelled = false;

    const loadSessionMessages = async () => {
      if (!sessionId) {
        setMessages([]);
        setControls(DEFAULT_INFOGRAPHIC_CONTROLS);
        setIsHydrating(false);
        return;
      }

      setIsHydrating(true);
      const session = await store.getSession(sessionId);
      if (cancelled) return;
      setMessages(session?.infographicMessages ?? []);
      setControls(session?.infographicControls ?? DEFAULT_INFOGRAPHIC_CONTROLS);
      setIsHydrating(false);
    };

    void loadSessionMessages();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionKey]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPromptDraft(activePrompt);
    setIsPromptDirty(false);
  }, [activePrompt, sessionKey]);

  useEffect(() => {
    if (isPendingAnalysis || isGenerating || messages.length > 0) return;

    const signature = `${sessionKey}:${analysisData?.title ?? ""}:${activePrompt}`;
    if (autoGeneratedRef.current[sessionKey] === signature) return;
    autoGeneratedRef.current[sessionKey] = signature;
    void handleGenerate(activePrompt, activePrompt, {
      showUserPrompt: false,
      includeSelectionLabel: false,
      includeControlPrompt: false,
      includeControlSummary: false,
    });
  }, [activePrompt, analysisData?.title, handleGenerate, isGenerating, isPendingAnalysis, messages.length, sessionKey]);

  const handleCopyImage = async (imageDataUrl: string) => {
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("clipboard unsupported");
      }
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast("이미지를 복사했습니다", "success");
    } catch (error) {
      console.error(error);
      showToast("이미지 복사에 실패했습니다", "error");
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40">
          <div
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow-md border ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden px-2 py-2 md:px-3 md:py-3 lg:px-4 lg:py-4 w-full">
        <ImageChatTimeline
          messages={messages}
          isGenerating={isGenerating}
          isPendingAnalysis={isPendingAnalysis}
          onCopyImage={handleCopyImage}
        />
      </div>

      <div className="border-t border-gray-200 bg-white px-3 pt-3">
        <div className="space-y-2.5">
          <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 px-2.5 py-2.5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ControlRow
                label="비율"
                options={ASPECT_RATIO_OPTIONS}
                value={controls.aspectRatio}
                onChange={(aspectRatio) => {
                  setControls((previous) => ({ ...previous, aspectRatio }));
                }}
              />
              <ControlRow
                label="톤"
                options={COLOR_TONE_OPTIONS}
                value={controls.colorTone}
                onChange={(colorTone) => {
                  setControls((previous) => ({ ...previous, colorTone }));
                }}
              />
              <ControlRow
                label="강조"
                options={EMPHASIS_OPTIONS}
                value={controls.emphasis}
                onChange={(emphasis) => {
                  setControls((previous) => ({ ...previous, emphasis }));
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-sm">
            <div className={`flex justify-between gap-3 ${isBriefExpanded ? "items-start" : "items-center"}`}>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">기본 브리프</p>
                {isBriefExpanded && (
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
                    자동 생성된 인포그래픽 기획 문구를 이 세션 안에서 바로 다듬고, 다음 생성부터 그대로 반영합니다.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10.5px] font-medium ${
                    hasCustomPrompt
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-gray-50 text-gray-500"
                  }`}
                >
                  {hasCustomPrompt ? "수정됨" : "기본값"}
                </span>
                <button
                  type="button"
                  onClick={() => setIsBriefExpanded((previous) => !previous)}
                  aria-expanded={isBriefExpanded}
                  className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                >
                  {isBriefExpanded ? "접기" : "펼치기"}
                </button>
              </div>
            </div>

            {isBriefExpanded && (
              <>
                <textarea
                  value={promptDraft}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPromptDraft(nextValue);
                    setIsPromptDirty(nextValue.trim() !== activePrompt.trim());
                  }}
                  disabled={isPendingAnalysis}
                  rows={5}
                  placeholder="인포그래픽 기본 브리프를 확인하고 필요한 부분만 수정하세요"
                  className="mt-3 min-h-[116px] w-full resize-y rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                />

                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-400">
                    {isPromptDirty
                      ? "저장하지 않은 브리프 변경사항이 있습니다. 생성 시 자동 반영됩니다."
                      : hasCustomPrompt
                        ? "현재 이 세션의 수정 브리프가 다음 생성에 사용됩니다."
                        : "현재 자동 생성된 기본 브리프가 사용됩니다."}
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void persistPrompt(generatedPrompt, { toastMessage: "기본 브리프로 되돌렸습니다" });
                      }}
                      disabled={isPendingAnalysis || (!hasCustomPrompt && promptDraft.trim() === generatedPrompt.trim())}
                      className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      기본값 복원
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void persistPrompt(promptDraft, { toastMessage: "브리프를 저장했습니다" });
                      }}
                      disabled={isPendingAnalysis || !isPromptDirty}
                      className="inline-flex items-center rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-blue-300 disabled:bg-blue-300"
                    >
                      저장
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <ImageChatInput
          onSend={(content) => {
            void (async () => {
              const promptOverride = isPromptDirty ? await persistPrompt(promptDraft) : activePrompt;
              await handleGenerate(content, promptOverride);
            })();
          }}
          disabled={isPendingAnalysis || isGenerating}
          placeholder="예: 상위 3개 지표를 강조해줘 · 비워두면 현재 옵션으로 바로 재생성됩니다"
          allowEmpty
          showTopBorder={false}
        />
      </div>
    </div>
  );
}

function ControlRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<T, ControlOptionDefinition>;
  value?: T;
  onChange: (nextValue?: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-full border border-white/80 bg-white/90 px-1.5 py-1 shadow-sm"
    >
      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-500">{label}</span>
      {(Object.entries(options) as Array<[T, ControlOptionDefinition]>).map(([optionValue, option]) => {
        const isSelected = optionValue === value;

        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(isSelected ? undefined : optionValue)}
            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[10.5px] font-medium whitespace-nowrap transition-colors ${
              isSelected
                ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
