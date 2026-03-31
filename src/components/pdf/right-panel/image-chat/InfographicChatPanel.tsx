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

const DEFAULT_INFOGRAPHIC_CONTROLS: InfographicControls = {
  aspectRatio: "portrait",
  colorTone: "clean",
  emphasis: "visual",
};

const buildControlSummary = ({ aspectRatio, colorTone, emphasis }: InfographicControls) => {
  return [
    ASPECT_RATIO_OPTIONS[aspectRatio].label,
    COLOR_TONE_OPTIONS[colorTone].label,
    EMPHASIS_OPTIONS[emphasis].label,
  ].join(" · ");
};

const buildControlPrompt = ({ aspectRatio, colorTone, emphasis }: InfographicControls) => {
  return [
    `- 화면 비율: ${ASPECT_RATIO_OPTIONS[aspectRatio].label} — ${ASPECT_RATIO_OPTIONS[aspectRatio].prompt}`,
    `- 컬러 톤: ${COLOR_TONE_OPTIONS[colorTone].label} — ${COLOR_TONE_OPTIONS[colorTone].prompt}`,
    `- 그래픽/텍스트 비중: ${EMPHASIS_OPTIONS[emphasis].label} — ${EMPHASIS_OPTIONS[emphasis].prompt}`,
  ].join("\n");
};

const buildEffectiveRequest = (content: string, controls: InfographicControls) => {
  const trimmedContent = content.trim();
  const controlSummary = buildControlSummary(controls);

  if (!trimmedContent) {
    return `${controlSummary} 방향으로 현재 데이터를 다시 인포그래픽으로 구성해줘.`;
  }

  return `${trimmedContent}\n\n선택 속성: ${controlSummary}`;
};

const buildInfographicContext = (analysisData?: AnalysisData | null) => {
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
    analysisData.infographicPrompt ? `기본 인포그래픽 브리프: ${analysisData.infographicPrompt}` : "",
    analysisData.tableContext ? `테이블 컨텍스트:\n${analysisData.tableContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildFallbackPrompt = (analysisData?: AnalysisData | null) => {
  if (!analysisData) {
    return "핵심 수치와 비교 구조가 잘 드러나는 세로형 인포그래픽으로 구성해줘.";
  }

  if (analysisData.infographicPrompt?.trim()) {
    return analysisData.infographicPrompt.trim();
  }

  const keywordText = analysisData.keywords.slice(0, 3).join(", ");
  return `${analysisData.title ?? "이 데이터"}를 바탕으로 핵심 수치와 비교 포인트가 잘 보이는 세로형 인포그래픽으로 구성해줘.${keywordText ? ` ${keywordText}를 우선 강조해줘.` : ""}`;
};

export function InfographicChatPanel({ sessionId, analysisData, isAnalyzing }: InfographicChatPanelProps) {
  const [isHydrating, setIsHydrating] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ImageChatMessage[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [controls, setControls] = useState<InfographicControls>(DEFAULT_INFOGRAPHIC_CONTROLS);
  const toastTimerRef = useRef<number | null>(null);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const sessionKey = sessionId ?? "default-image-chat";
  const autoGeneratedRef = useRef<Record<string, string>>({});
  const activeSessionKeyRef = useRef(sessionKey);
  const requestCounterRef = useRef(0);
  const defaultPrompt = useMemo(() => buildFallbackPrompt(analysisData), [analysisData]);
  const latestResult = useMemo(
    () => [...messages].reverse().find((message) => message.role === "ai") ?? null,
    [messages]
  );
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

  const showToast = (message: string, type: ToastState["type"]) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  };

  const handleGenerate = useCallback(async (content: string) => {
    if (isGenerating || !analysisData || analysisData.status === "pending") return;

    const startedSessionKey = sessionKey;
    const requestId = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;
    const appliedControls = controls;
    const userContent = buildEffectiveRequest(content, controls);

    const userMessage: ImageChatMessage = {
      role: "user",
      content: userContent,
    };

    const history = [...messages, userMessage];
    setSessionMessages(history);
    setIsGenerating(true);

    try {
      const apiKey = localStorage.getItem("gemini_api_key");
      if (!apiKey) throw new Error("API 키가 없습니다.");

      const ai = new GoogleGenAI({ apiKey });
      const imagePrompt = `${buildInfographicContext(analysisData)}

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

선택된 인포그래픽 속성 (기존 브리프나 다른 요청과 충돌하더라도 아래 속성을 우선 반영):
${buildControlPrompt(controls)}

최신 사용자 요청: ${userContent}

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
      setSessionMessages([...history, { role: "ai", content: `요청 처리 중 오류가 발생했습니다: ${message}` }], appliedControls);
    } finally {
      if (activeSessionKeyRef.current === startedSessionKey && requestCounterRef.current === requestId) {
        setIsGenerating(false);
      }
    }
  }, [analysisData, controls, isGenerating, messages, selectedImageModel, sessionKey, setSessionMessages]);

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
    if (isPendingAnalysis || isGenerating || messages.length > 0) return;

    const signature = `${sessionKey}:${analysisData?.title ?? ""}:${analysisData?.infographicPrompt ?? defaultPrompt}:${controls.aspectRatio}:${controls.colorTone}:${controls.emphasis}`;
    if (autoGeneratedRef.current[sessionKey] === signature) return;
    autoGeneratedRef.current[sessionKey] = signature;
    void handleGenerate(defaultPrompt);
  }, [analysisData?.infographicPrompt, analysisData?.title, controls.aspectRatio, controls.colorTone, controls.emphasis, defaultPrompt, handleGenerate, isGenerating, isPendingAnalysis, messages.length, sessionKey]);

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

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 md:p-6 lg:p-7 w-full">
        <ImageChatTimeline
          latestResult={latestResult}
          isGenerating={isGenerating}
          isPendingAnalysis={isPendingAnalysis}
          onCopyImage={handleCopyImage}
        />
      </div>

      <div className="border-t border-gray-200 bg-white px-3 pt-3">
        <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-3 shadow-sm">
          <div className="space-y-2.5">
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
      </div>

      <ImageChatInput
        onSend={(content) => {
          void handleGenerate(content);
        }}
        disabled={isPendingAnalysis || isGenerating}
        placeholder="예: 상위 3개 지표를 강조해줘 · 비워두면 현재 옵션으로 바로 재생성됩니다"
        allowEmpty
        showTopBorder={false}
      />
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
  value: T;
  onChange: (nextValue: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      {(Object.entries(options) as Array<[T, ControlOptionDefinition]>).map(([optionValue, option]) => {
        const isSelected = optionValue === value;

        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(optionValue)}
            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
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
