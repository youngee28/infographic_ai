import type { AnalysisData, LayoutPlan } from "@/lib/session-types";

interface GeminiInlineDataPart {
  mimeType?: string;
  data?: string;
}

interface GeminiContentPart {
  text?: string;
  inlineData?: GeminiInlineDataPart;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiContentPart[];
  };
}

interface GeminiGenerateContentResultLike {
  candidates?: GeminiCandidate[];
}

export function getSelectedLayoutPlan(analysisData?: AnalysisData | null): LayoutPlan | undefined {
  if (!analysisData) return undefined;
  const candidates = analysisData.generatedLayoutPlans;
  if (candidates && candidates.length > 0) {
    return candidates.find((candidate) => candidate.id === analysisData.selectedLayoutPlanId) ?? candidates[0];
  }
  return analysisData.layoutPlan ?? analysisData.generatedLayoutPlan;
}

export function buildInfographicContext(analysisData?: AnalysisData | null, promptOverride?: string) {
  if (!analysisData) return "";

  const summaryLines = analysisData.summaries.flatMap((summary) => summary.lines?.map((line) => line.text) ?? []);
  const issueLines = Array.isArray(analysisData.issues)
    ? analysisData.issues.map((issue) => issue.text)
    : typeof analysisData.issues === "string" && analysisData.issues.trim()
      ? [analysisData.issues.trim()]
      : [];

  const activeLayoutPlan = getSelectedLayoutPlan(analysisData);
  const layoutPlanContext = activeLayoutPlan
    ? [
        `레이아웃 타입: ${activeLayoutPlan.layoutType}`,
        `레이아웃 비율: ${activeLayoutPlan.aspectRatio}`,
        `시각 비중 정책: 텍스트 ${Math.round(activeLayoutPlan.visualPolicy.textRatio * 100)}%, 차트 ${Math.round(activeLayoutPlan.visualPolicy.chartRatio * 100)}%, 아이콘 ${Math.round(activeLayoutPlan.visualPolicy.iconRatio * 100)}%`,
        activeLayoutPlan.sections.length > 0
          ? `섹션 배치 계획:\n${activeLayoutPlan.sections
              .map((section, index) => {
                const chartSummary = section.charts?.length
                  ? ` / 차트: ${section.charts.map((chart) => `${chart.chartType}(${chart.title})`).join(", ")}`
                  : "";
                const itemSummary = section.items?.length ? ` / KPI: ${section.items.map((item) => `${item.label}:${item.value}`).join(", ")}` : "";
                const noteSummary = section.note ? ` / 메모: ${section.note}` : "";
                return `${index + 1}. ${section.type}${section.title ? ` - ${section.title}` : ""}${chartSummary}${itemSummary}${noteSummary}`;
              })
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return [
    analysisData.title ? `데이터셋 제목: ${analysisData.title}` : "",
    layoutPlanContext ? `확정된 레이아웃 계획:\n${layoutPlanContext}` : "",
    analysisData.keywords.length > 0 ? `핵심 키워드: ${analysisData.keywords.join(", ")}` : "",
    summaryLines.length > 0 ? `핵심 인사이트: ${summaryLines.slice(0, 6).join(" | ")}` : "",
    issueLines.length > 0 ? `주의 포인트: ${issueLines.slice(0, 4).join(" | ")}` : "",
    (promptOverride ?? analysisData.infographicPrompt)?.trim()
      ? activeLayoutPlan
        ? `스타일/연출 브리프: ${(promptOverride ?? analysisData.infographicPrompt)?.trim()}`
        : `기본 인포그래픽 브리프: ${(promptOverride ?? analysisData.infographicPrompt)?.trim()}`
      : "",
    analysisData.tableContext ? `테이블 컨텍스트:\n${analysisData.tableContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function extractGeneratedImageResult(result: GeminiGenerateContentResultLike) {
  const parts = result.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const generatedImagePart = parts.find(
    (part) => part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")
  );
  const generatedText = parts
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");

  return {
    generatedText,
    generatedImageDataUrl: generatedImagePart?.inlineData
      ? `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`
      : undefined,
  };
}
