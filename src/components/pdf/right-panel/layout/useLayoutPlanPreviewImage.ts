import { useEffect, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import type { ImageModel } from "@/lib/ai-models";
import { getVisualizationPrompt } from "@/lib/analysis-selectors";
import { buildInfographicContext, extractGeneratedImageResult } from "@/lib/infographic-generation";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";
import { buildAnalysisWithSingleLayoutPlan } from "./selection";
import type { PreviewMode } from "./LayoutPlanPreview";

interface UseLayoutPlanPreviewImageArgs {
  sessionId?: string | null;
  analysisData: AnalysisData | null;
  selectedPlan: LayoutPlan | null;
  selectedImageModel: ImageModel;
  persistLayoutPlanPreviewImage: (layoutPlanId: string, previewImageDataUrl: string) => Promise<LayoutPlan | null>;
}

export function useLayoutPlanPreviewImage({
  sessionId,
  analysisData,
  selectedPlan,
  selectedImageModel,
  persistLayoutPlanPreviewImage,
}: UseLayoutPlanPreviewImageArgs) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("html");
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const attemptedPreviewSignaturesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (previewMode !== "image" || !analysisData || analysisData.status === "pending" || !selectedPlan) {
      return;
    }

    let cancelled = false;

    const generateMissingPreviewImages = async () => {
      const apiKey = localStorage.getItem("gemini_api_key");
      if (!apiKey) return;

      const ai = new GoogleGenAI({ apiKey });
      if (selectedPlan.previewImageDataUrl || cancelled) {
        return;
      }

      const promptOverride = getVisualizationPrompt(analysisData) || analysisData.infographicPrompt?.trim() || analysisData.generatedInfographicPrompt?.trim();
      const previewSignature = JSON.stringify({
        sessionId: sessionId ?? "layout-preview",
        model: selectedImageModel,
        layoutPlanId: selectedPlan.id,
        promptOverride,
        layoutPlan: selectedPlan,
      });

      if (attemptedPreviewSignaturesRef.current[selectedPlan.id] === previewSignature) {
        return;
      }

      attemptedPreviewSignaturesRef.current[selectedPlan.id] = previewSignature;
      setActivePreviewId(selectedPlan.id);

      try {
        const previewAnalysisData = buildAnalysisWithSingleLayoutPlan(analysisData, selectedPlan);
        const previewPrompt = `${buildInfographicContext(previewAnalysisData, promptOverride)}

이 이미지는 현재 layoutPlan 미리보기입니다.
위 앱이 계산한 layoutPlan을 최우선으로 따라 인포그래픽을 생성하세요. 섹션 순서, 차트 유형, KPI 블록, 정보 비중 정책은 유지하고, 전체 구성과 시각적 위계를 뚜렷하게 표현하세요.
설명 텍스트보다 이미지 생성이 우선이며, 흰 배경의 깔끔한 데이터 인포그래픽 시안으로 출력하세요.`;

        const imageResult = await ai.models.generateContent({
          model: selectedImageModel,
          contents: previewPrompt,
        });

        if (cancelled) {
          delete attemptedPreviewSignaturesRef.current[selectedPlan.id];
          return;
        }

        const { generatedImageDataUrl } = extractGeneratedImageResult(imageResult);
        if (!generatedImageDataUrl) {
          delete attemptedPreviewSignaturesRef.current[selectedPlan.id];
          return;
        }

        await persistLayoutPlanPreviewImage(selectedPlan.id, generatedImageDataUrl);
      } catch (error) {
        delete attemptedPreviewSignaturesRef.current[selectedPlan.id];
        console.error(error);
      }

      if (!cancelled) {
        setActivePreviewId(null);
      }
    };

    void generateMissingPreviewImages();

    return () => {
      cancelled = true;
    };
  }, [analysisData, persistLayoutPlanPreviewImage, previewMode, previewRetryNonce, selectedImageModel, selectedPlan, sessionId]);

  const handlePreviewModeSelect = (mode: PreviewMode) => {
    if (mode === "image" && previewMode === "image") {
      setPreviewRetryNonce((value) => value + 1);
    }
    if (mode !== "image") {
      setActivePreviewId(null);
    }
    setPreviewMode(mode);
  };

  return {
    previewMode,
    isGeneratingPreview: previewMode === "image" && activePreviewId === selectedPlan?.id && !selectedPlan?.previewImageDataUrl,
    onPreviewModeSelect: handlePreviewModeSelect,
  };
}
