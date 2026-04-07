import { resolveSelectedLayoutPlan } from "@/components/pdf/right-panel/layout/selection";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";
import {
  getAnalysisTitle,
  getFindings,
  getImplications,
  getSourceTables,
  getVisualizationBrief,
  getVisualizationPrompt,
} from "@/lib/analysis-selectors";

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
  return resolveSelectedLayoutPlan(analysisData);
}

export function buildInfographicContext(analysisData?: AnalysisData | null, promptOverride?: string) {
  if (!analysisData) return "";

  const tables = getSourceTables(analysisData);
  const selectedSourceTableIds = analysisData.selectedSourceTableIds ?? [];
  const effectiveTables = selectedSourceTableIds.length > 0
    ? tables.filter((table) => selectedSourceTableIds.includes(table.id))
    : tables;
  const scopedTables = effectiveTables.length > 0 ? effectiveTables : tables;
  const findings = getFindings(analysisData).map((item) => item.text);
  const implications = getImplications(analysisData).map((item) => item.text);
  const brief = getVisualizationBrief(analysisData);

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
    getAnalysisTitle(analysisData) ? `데이터셋 제목: ${getAnalysisTitle(analysisData)}` : "",
    analysisData.dataset?.summary ? `데이터셋 요약: ${analysisData.dataset.summary}` : "",
    scopedTables.length > 0 ? `표 구성: ${scopedTables.map((table) => `${table.name}(${table.role})`).join(" | ")}` : "",
    layoutPlanContext ? `앱이 계산한 레이아웃 계획:\n${layoutPlanContext}` : "",
    findings.length > 0 ? `핵심 신호: ${findings.slice(0, 6).join(" | ")}` : "",
    implications.length > 0 ? `실무 시사점: ${implications.slice(0, 4).join(" | ")}` : "",
    brief?.headline ? `헤드라인: ${brief.headline}` : "",
    brief?.coreMessage ? `핵심 메시지: ${brief.coreMessage}` : "",
    brief?.storyFlow.length ? `스토리 흐름: ${brief.storyFlow.join(" -> ")}` : "",
    (promptOverride ?? getVisualizationPrompt(analysisData))?.trim()
      ? activeLayoutPlan
        ? `스타일/연출 브리프: ${(promptOverride ?? getVisualizationPrompt(analysisData))?.trim()}`
        : `기본 인포그래픽 브리프: ${(promptOverride ?? getVisualizationPrompt(analysisData))?.trim()}`
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
