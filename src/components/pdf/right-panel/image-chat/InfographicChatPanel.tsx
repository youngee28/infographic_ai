"use client";

import { useMemo, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import { Pencil, X } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import type { AnalysisData } from "@/lib/session-types";
import { ImageChatInput } from "./ImageChatInput";
import { ImageChatTimeline } from "./ImageChatTimeline";
import { ImageUploadCanvas } from "./ImageUploadCanvas";
import type { ImageChatMessage } from "./types";
import { dataUrlToInlineData, looksLikeImageRequest } from "./utils";

interface InfographicChatPanelProps {
  sessionId?: string | null;
  analysisData?: AnalysisData | null;
}

const IMAGE_CLASSIFIER_PROMPT =
  '다음 사용자 요청을 분류해줘. 이미지 생성/편집 요청이면 IMAGE, 이미지 설명/질문 또는 일반 대화면 TEXT를 출력해. 응답은 IMAGE 또는 TEXT 한 단어만 출력.';

interface ToastState {
  message: string;
  type: "success" | "error";
}

interface DraftImage {
  id: string;
  dataUrl: string;
}

const MAX_ATTACHMENTS = 10;

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

export function InfographicChatPanel({ sessionId, analysisData }: InfographicChatPanelProps) {
  const [isTyping, setIsTyping] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ImageChatMessage[]>>({});
  const selectedQnaModel = useAppStore((s) => s.selectedQnaModel);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const sessionKey = sessionId ?? "default-image-chat";
  const messages = useMemo(() => messagesBySession[sessionKey] ?? [], [messagesBySession, sessionKey]);
  const editingImage = useMemo(
    () => (editingImageId ? draftImages.find((image) => image.id === editingImageId) ?? null : null),
    [draftImages, editingImageId]
  );

  const setSessionMessages = (next: ImageChatMessage[]) => {
    setMessagesBySession((prev) => ({ ...prev, [sessionKey]: next }));
  };

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

  const handlePickImage = (file: File) => {
    if (draftImages.length >= MAX_ATTACHMENTS) {
      showToast(`이미지는 최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`, "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `img-${Date.now()}-${Math.random()}`;
      setDraftImages((prev) => {
        if (prev.length >= MAX_ATTACHMENTS) return prev;
        return [...prev, { id, dataUrl }];
      });
    };
    reader.readAsDataURL(file);
  };

  const removeDraftImage = (id: string) => {
    setDraftImages((prev) => prev.filter((image) => image.id !== id));
    if (editingImageId === id) {
      setEditingImageId(null);
      setIsEditorOpen(false);
    }
  };

  const handleSend = async (content: string) => {
    if (isTyping) return;

    const normalizedContent = content.trim();
    const editedImageDataUrls = draftImages.map((image) => image.dataUrl);
    const userContent = normalizedContent || (editedImageDataUrls.length > 0 ? "이미지 참고 요청" : "");
    if (!userContent && editedImageDataUrls.length === 0) return;

    const userMessage: ImageChatMessage = {
      role: "user",
      content: userContent,
      imageDataUrls: editedImageDataUrls.length > 0 ? editedImageDataUrls : undefined,
    };

    const history = [...messages, userMessage];
    setSessionMessages(history);
    setIsTyping(true);
    setDraftImages([]);
    setEditingImageId(null);

    try {
      const apiKey = localStorage.getItem("gemini_api_key");
      if (!apiKey) throw new Error("API 키가 없습니다.");

      const ai = new GoogleGenAI({ apiKey });
      const inlineDataParts = editedImageDataUrls
        .map((dataUrl) => dataUrlToInlineData(dataUrl))
        .filter((part): part is { data: string; mimeType: string } => Boolean(part))
        .map((inlineData) => ({ inlineData }));

      let isImageRequest = false;
      try {
        const classificationPrompt = `${IMAGE_CLASSIFIER_PROMPT}\n이미지 첨부 개수: ${inlineDataParts.length}\n사용자 요청: "${userContent}"`;
        const decisionResult = await ai.models.generateContent({
          model: selectedQnaModel,
          contents: classificationPrompt,
        });
        const decision = decisionResult.text?.trim().toUpperCase() ?? "";
        isImageRequest = decision.includes("IMAGE");
      } catch (classificationError) {
        console.error("Image chat classification failed", classificationError);
        isImageRequest = looksLikeImageRequest(userContent) || inlineDataParts.length > 0;
      }

      if (isImageRequest) {
        const imagePrompt = `${buildInfographicContext(analysisData)}

이전 대화:
${history
          .map((m) => `[${m.role === "user" ? "사용자" : "AI"}] ${m.content}`)
          .join("\n\n")}

위 테이블 데이터와 대화를 바탕으로 정보 밀도가 높은 인포그래픽 또는 데이터 비주얼을 생성하세요. 제목, 핵심 지표 강조, 비교 구조, 읽는 순서를 반영한 결과를 우선합니다.`;

        const imageResult = await ai.models.generateContent({
          model: selectedImageModel,
          contents: inlineDataParts.length > 0 ? [imagePrompt, ...inlineDataParts] : imagePrompt,
        });

        const parts = imageResult.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
        const generatedImagePart = parts.find(
          (part) => part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")
        );

        const generatedImageDataUrl = generatedImagePart?.inlineData
          ? `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`
          : undefined;

        const aiMessage: ImageChatMessage = {
          role: "ai",
          content: generatedImageDataUrl
            ? "테이블 인사이트를 바탕으로 인포그래픽 시안을 생성했습니다."
            : "인포그래픽을 생성하지 못했습니다. 강조할 지표나 레이아웃을 조금 더 구체적으로 입력해 주세요.",
          imageDataUrls: generatedImageDataUrl ? [generatedImageDataUrl] : undefined,
        };

        setSessionMessages([...history, aiMessage]);
      } else {
        const prompt = `${buildInfographicContext(analysisData)}

이전 대화:\n${history
          .map((m) => `[${m.role === "user" ? "사용자" : "AI"}] ${m.content}`)
          .join("\n\n")}\n\n사용자 최신 요청: ${userContent}`;

        const streamResult = await ai.models.generateContentStream({
          model: selectedQnaModel,
          contents: inlineDataParts.length > 0 ? [prompt, ...inlineDataParts] : [prompt],
          config: {
            systemInstruction:
              "당신은 인포그래픽 기획을 도와주는 AI 어시스턴트입니다. 표 인사이트를 시각 구조로 옮기는 방법을 한국어로 간결하고 실무적으로 설명하세요.",
          },
        });

        let botResponse = "";
        setSessionMessages([...history, { role: "ai", content: "" }]);

        for await (const chunk of streamResult) {
          const text = chunk.text;
          if (!text) continue;
          botResponse += text;
          setSessionMessages([...history, { role: "ai", content: botResponse }]);
        }
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "오류가 발생했습니다.";
      setSessionMessages([...history, { role: "ai", content: `요청 처리 중 오류가 발생했습니다: ${message}` }]);
    } finally {
      setIsTyping(false);
    }
  };

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
        <div className="min-h-full flex flex-col justify-end">
          <ImageChatTimeline messages={messages} isTyping={isTyping} onCopyImage={handleCopyImage} />
        </div>
      </div>

      {draftImages.length > 0 && (
        <div className="px-3 pb-2 bg-white border-t border-gray-100">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2">
            {draftImages.map((image) => (
              <div key={image.id} className="relative group">
                <img src={image.dataUrl} alt="첨부 이미지 미리보기" className="w-full h-16 rounded-md object-cover border border-gray-200" />
                <div className="absolute top-1 right-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingImageId(image.id);
                      setIsEditorOpen(true);
                    }}
                    className="p-1 rounded-md bg-black/45 text-white hover:bg-black/60"
                    title="편집"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDraftImage(image.id)}
                    className="p-1 rounded-md bg-black/45 text-white hover:bg-black/60"
                    title="첨부 제거"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ImageChatInput
        onSend={handleSend}
        onPickImage={handlePickImage}
        hasAttachment={draftImages.length > 0}
        attachmentCount={draftImages.length}
        maxAttachments={MAX_ATTACHMENTS}
        canAttachMore={draftImages.length < MAX_ATTACHMENTS}
        disabled={isTyping}
      />

      {isEditorOpen && editingImage && (
        <ImageUploadCanvas
          key={editingImage.id}
          imageDataUrl={editingImage.dataUrl}
          disabled={isTyping}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingImageId(null);
          }}
          onApply={(next) => {
            setDraftImages((prev) => prev.map((image) => (
              image.id === editingImageId ? { ...image, dataUrl: next } : image
            )));
            setIsEditorOpen(false);
            setEditingImageId(null);
          }}
        />
      )}
    </div>
  );
}
