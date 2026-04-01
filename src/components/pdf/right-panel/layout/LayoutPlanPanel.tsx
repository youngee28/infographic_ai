"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PieController,
  PointElement,
  Tooltip,
} from "chart.js";
import Image from "next/image";
import { GoogleGenAI } from "@google/genai";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { buildInfographicContext, extractGeneratedImageResult } from "@/lib/infographic-generation";
import { DEFAULT_LAYOUT_SYSTEM_PROMPT } from "@/lib/layout-prompts";
import { store } from "@/lib/store";
import type { AnalysisData, LayoutChartSpec, LayoutChartType, LayoutPlan, LayoutSection, LayoutSectionType } from "@/lib/session-types";

const SECTION_TYPE_LABELS: Record<LayoutSectionType, string> = {
  header: "헤더",
  "chart-group": "차트 그룹",
  "kpi-group": "KPI 그룹",
  takeaway: "결론",
  note: "노트",
};

type PreviewMode = "html" | "image";
type PreviewCanvasType = "bar" | "line" | "doughnut" | "pie";
type PreviewColumnKind = "text" | "number" | "currency" | "percent" | "date";

interface PreviewColumnProfile {
  index: number;
  name: string;
  kind: PreviewColumnKind;
  distinctCount: number;
  numericCoverage: number;
  dateCoverage: number;
  uniqueRatio: number;
  isGeoLike: boolean;
  isIdLike: boolean;
}

interface PreviewDataContext {
  columns: string[];
  rows: string[][];
  profiles: PreviewColumnProfile[];
  primaryMetricIndex: number;
  primaryDimensionIndex: number;
  secondaryDimensionIndex: number;
}

interface AggregatedPreviewDatum {
  label: string;
  value: number;
  order: number;
}

interface PreparedPreviewChart {
  renderKind: "canvas" | "geo-rank" | "empty";
  chartType: LayoutChartType;
  canvasType?: PreviewCanvasType;
  title: string;
  goal: string;
  dimensionLabel: string;
  metricLabel: string;
  labels: string[];
  values: number[];
  stackedSeries?: Array<{ label: string; values: number[] }>;
  items: AggregatedPreviewDatum[];
  infoNote: string;
}

interface PreviewKpiItem {
  label: string;
  value: string;
  note: string;
}

const NUMBER_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PERCENT_VALUE_REGEX = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%$/;
const CURRENCY_SYMBOL_REGEX = /^[₩$€¥£]\s*/;
const DATE_VALUE_REGEXES = [/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/, /^\d{4}[-/.]\d{1,2}$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/];
const DIMENSION_HEADER_HINTS = ["date", "time", "month", "year", "day", "category", "type", "group", "segment", "region", "country", "city", "name", "제품", "카테고리", "유형", "구분", "지역", "국가", "도시", "이름", "항목", "월", "연도", "일자", "날짜"];
const GEO_HEADER_HINTS = ["country", "region", "state", "city", "nation", "국가", "지역", "도시", "시도"];
const ID_HEADER_HINTS = ["id", "code", "key", "uuid", "identifier", "번호", "코드", "식별", "순번"];
const PREVIEW_ASPECT_RATIOS: Record<NonNullable<LayoutPlan["aspectRatio"]>, string> = {
  portrait: "4 / 5",
  square: "1 / 1",
  landscape: "16 / 10",
};
const PREVIEW_SERIES_COLORS = ["#2563eb", "#0ea5e9", "#f97316", "#14b8a6", "#8b5cf6", "#ef4444"];

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PieController,
  PointElement,
  Tooltip
);

interface LayoutPlanPanelProps {
  sessionId?: string | null;
  analysisData: AnalysisData | null;
  isAnalyzing?: boolean;
  onRegenerateLayoutCandidates?: (layoutPromptOverride: string) => Promise<void>;
}

function cloneLayoutPlan(layoutPlan?: LayoutPlan | null): LayoutPlan | null {
  return layoutPlan
      ? {
          ...layoutPlan,
          previewImageDataUrl: layoutPlan.previewImageDataUrl,
          sections: layoutPlan.sections.map((section) => ({
            ...section,
            charts: section.charts?.map((chart) => ({ ...chart })),
            items: section.items?.map((item) => ({ ...item })),
          })),
        visualPolicy: { ...layoutPlan.visualPolicy },
      }
    : null;
}

function buildFallbackLayoutPlans(analysisData: AnalysisData | null): LayoutPlan[] {
  if (!analysisData) return [];

  const title = analysisData.title?.trim() || "데이터 요약";
  const firstIssue = Array.isArray(analysisData.issues) ? analysisData.issues[0]?.text : analysisData.issues || undefined;
  const firstDimension = analysisData.tableData?.columns[0];
  const firstMetric = analysisData.tableData?.columns[1];

  return [
    {
      id: "layout-option-1",
      name: "시안 1",
      description: "메인 비교 차트를 가장 크게 배치한 시안",
      layoutType: "dashboard",
      aspectRatio: "portrait",
      sections: [
        { id: "header", type: "header", title },
        {
          id: "comparison",
          type: "chart-group",
          title: "핵심 비교 차트",
          charts: [{ id: "bar-1", chartType: "bar", title: "핵심 비교", goal: "중요 지표 비교", dimension: firstDimension, metric: firstMetric }],
        },
        { id: "takeaway", type: "takeaway", title: "요약 메모", note: firstIssue },
      ],
      visualPolicy: { textRatio: 0.15, chartRatio: 0.75, iconRatio: 0.1 },
    },
    {
      id: "layout-option-2",
      name: "시안 2",
      description: "KPI 카드와 보조 차트를 함께 배치한 시안",
      layoutType: "dashboard",
      aspectRatio: "portrait",
      sections: [
        { id: "header", type: "header", title },
        {
          id: "kpis",
          type: "kpi-group",
          title: "핵심 수치",
          items: [
            { label: firstMetric || "지표 1", value: "핵심" },
            { label: analysisData.keywords[0] || "키워드", value: "강조" },
            { label: analysisData.keywords[1] || "포인트", value: "요약" },
          ],
        },
        {
          id: "distribution",
          type: "chart-group",
          title: "비중 구조",
          charts: [{ id: "donut-1", chartType: "donut", title: "비중 비교", goal: "구성 비율 전달", dimension: firstDimension, metric: firstMetric }],
        },
        {
          id: "detail-compare",
          type: "chart-group",
          title: "세부 비교",
          charts: [{ id: "bar-2", chartType: "bar", title: "세부 지표 비교", goal: "KPI를 뒷받침하는 보조 비교", dimension: firstDimension, metric: firstMetric }],
        },
      ],
      visualPolicy: { textRatio: 0.2, chartRatio: 0.65, iconRatio: 0.15 },
    },
    {
      id: "layout-option-3",
      name: "시안 3",
      description: "반복 섹션으로 항목별 비교를 이어가는 시안",
      layoutType: "dashboard",
      aspectRatio: "portrait",
      sections: [
        { id: "header", type: "header", title },
        {
          id: "report-a",
          type: "chart-group",
          title: "주요 섹션 A",
          charts: [{ id: "line-1", chartType: "line", title: "흐름 비교", goal: "추이와 변화 전달", dimension: firstDimension, metric: firstMetric }],
        },
        {
          id: "report-b",
          type: "chart-group",
          title: "주요 섹션 B",
          charts: [{ id: "bar-2", chartType: "bar", title: "구간 비교", goal: "항목 간 차이 강조", dimension: firstDimension, metric: firstMetric }],
        },
        {
          id: "report-c",
          type: "chart-group",
          title: "주요 섹션 C",
          charts: [{ id: "donut-2", chartType: "donut", title: "구성 요약", goal: "반복 섹션 끝에서 비중 요약", dimension: firstDimension, metric: firstMetric }],
        },
      ],
      visualPolicy: { textRatio: 0.18, chartRatio: 0.7, iconRatio: 0.12 },
    },
  ];
}

function resolveLayoutPlans(analysisData: AnalysisData | null): LayoutPlan[] {
  const candidates = analysisData?.generatedLayoutPlans;
  if (candidates && candidates.length > 0) {
      return candidates.map((candidate, index) => ({
        ...candidate,
        id: candidate.id || `layout-option-${index + 1}`,
        name: candidate.name || `시안 ${index + 1}`,
        description: candidate.description || `구성 전략이 다른 대시보드 시안 ${index + 1}`,
      }));
  }

  const legacy = analysisData?.layoutPlan ?? analysisData?.generatedLayoutPlan;
  if (legacy) {
    return [
      {
        ...legacy,
        id: legacy.id || "layout-option-1",
        name: legacy.name || "시안 1",
        description: legacy.description || "기존 레이아웃 시안",
      },
    ];
  }

  return buildFallbackLayoutPlans(analysisData);
}

function getSelectedPlan(analysisData: AnalysisData | null, candidates: LayoutPlan[]): LayoutPlan | null {
  if (candidates.length === 0) return null;
  const selectedId = analysisData?.selectedLayoutPlanId;
  return candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
}

function buildAnalysisWithLayoutCandidates(
  analysisData: AnalysisData,
  candidates: LayoutPlan[],
  selectedCandidateId = analysisData.selectedLayoutPlanId
): AnalysisData {
  const selectedPlan = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0];
  const generatedPlanId = analysisData.generatedLayoutPlan?.id ?? candidates[0]?.id ?? selectedPlan?.id;
  const generatedPlan = generatedPlanId ? candidates.find((candidate) => candidate.id === generatedPlanId) ?? analysisData.generatedLayoutPlan : undefined;

  return {
    ...analysisData,
    generatedLayoutPlans: candidates,
    selectedLayoutPlanId: selectedPlan?.id,
    generatedLayoutPlan: generatedPlan ? cloneLayoutPlan(generatedPlan) ?? generatedPlan : undefined,
    layoutPlan: selectedPlan ? cloneLayoutPlan(selectedPlan) ?? selectedPlan : undefined,
  };
}

export function LayoutPlanPanel({ sessionId, analysisData, isAnalyzing, onRegenerateLayoutCandidates }: LayoutPlanPanelProps) {
  const setAnalysisData = useAppStore((s) => s.setAnalysisData);
  const layoutSystemPrompt = useAppStore((s) => s.layoutSystemPrompt);
  const setLayoutSystemPrompt = useAppStore((s) => s.setLayoutSystemPrompt);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const candidates = useMemo(() => resolveLayoutPlans(analysisData), [analysisData]);
  const selectedPlan = useMemo(() => getSelectedPlan(analysisData, candidates), [analysisData, candidates]);
  const [promptDraft, setPromptDraft] = useState(layoutSystemPrompt);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("html");
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const attemptedPreviewSignaturesRef = useRef<Record<string, string>>({});
  const previewDataContext = useMemo(() => buildPreviewDataContext(analysisData?.tableData), [analysisData?.tableData]);

  useEffect(() => {
    setPromptDraft(layoutSystemPrompt);
  }, [layoutSystemPrompt]);

  const persistAnalysisData = useCallback(
    async (nextAnalysisData: AnalysisData) => {
      if (sessionId) {
        const session = await store.getSession(sessionId);
        if (session) {
          await store.saveSession({
            ...session,
            analysisData: nextAnalysisData,
          });
        }
      }

      setAnalysisData(nextAnalysisData);
    },
    [sessionId, setAnalysisData]
  );

  const persistCandidatePreviewImage = useCallback(
    async (candidateId: string, previewImageDataUrl: string) => {
      const latestSession = sessionId ? await store.getSession(sessionId) : null;
      const latestAnalysisData = latestSession?.analysisData ?? analysisData;
      if (!latestAnalysisData) {
        return null;
      }

      const mergedCandidates = resolveLayoutPlans(latestAnalysisData).map((plan) =>
        plan.id === candidateId
          ? {
              ...plan,
              previewImageDataUrl,
            }
          : plan
      );

      await persistAnalysisData(
        buildAnalysisWithLayoutCandidates(latestAnalysisData, mergedCandidates, latestAnalysisData.selectedLayoutPlanId)
      );

      return mergedCandidates;
    },
    [analysisData, persistAnalysisData, sessionId]
  );

  const selectCandidate = useCallback(
    async (candidate: LayoutPlan) => {
      const latestSession = sessionId ? await store.getSession(sessionId) : null;
      const latestAnalysisData = latestSession?.analysisData ?? analysisData;
      if (!latestAnalysisData) return;

      const nextAnalysisData = buildAnalysisWithLayoutCandidates(latestAnalysisData, resolveLayoutPlans(latestAnalysisData), candidate.id);
      await persistAnalysisData(nextAnalysisData);
    },
    [analysisData, persistAnalysisData, sessionId]
  );

  const handleSaveAndRegenerate = useCallback(async () => {
    const normalizedPrompt = promptDraft.trim() || DEFAULT_LAYOUT_SYSTEM_PROMPT;
    setLayoutSystemPrompt(normalizedPrompt);

    if (!sessionId || !onRegenerateLayoutCandidates) {
      return;
    }

    setIsSubmittingPrompt(true);
    try {
      await onRegenerateLayoutCandidates(normalizedPrompt);
    } finally {
      setIsSubmittingPrompt(false);
    }
  }, [onRegenerateLayoutCandidates, promptDraft, sessionId, setLayoutSystemPrompt]);

  useEffect(() => {
    if (previewMode !== "image" || !analysisData || analysisData.status === "pending" || candidates.length === 0) {
      setActivePreviewId(null);
      return;
    }

    let cancelled = false;

    const generateMissingPreviewImages = async () => {
      const apiKey = localStorage.getItem("gemini_api_key");
      if (!apiKey) return;

      const ai = new GoogleGenAI({ apiKey });
      let nextCandidates = candidates;

      for (const candidate of nextCandidates) {
        if (cancelled || candidate.previewImageDataUrl) {
          continue;
        }

        const promptOverride = analysisData.infographicPrompt?.trim() || analysisData.generatedInfographicPrompt?.trim();
        const previewSignature = JSON.stringify({
          sessionId: sessionId ?? "layout-preview",
          model: selectedImageModel,
          candidateId: candidate.id,
          promptOverride,
          layoutPlan: candidate,
        });

        if (attemptedPreviewSignaturesRef.current[candidate.id] === previewSignature) {
          continue;
        }

        attemptedPreviewSignaturesRef.current[candidate.id] = previewSignature;
        setActivePreviewId(candidate.id);

        try {
          const previewAnalysisData = buildAnalysisWithLayoutCandidates(analysisData, nextCandidates, candidate.id);
          const previewPrompt = `${buildInfographicContext(previewAnalysisData, promptOverride)}

이 이미지는 레이아웃 후보 선택용 미리보기입니다.
위 확정된 layoutPlan을 최우선으로 따라 인포그래픽을 생성하세요. 섹션 순서, 차트 유형, KPI 블록, 정보 비중 정책은 유지하고, 후보 카드에서 한눈에 비교할 수 있게 전체 구성과 시각적 위계를 뚜렷하게 표현하세요.
설명 텍스트보다 이미지 생성이 우선이며, 흰 배경의 깔끔한 데이터 인포그래픽 시안으로 출력하세요.`;

          const imageResult = await ai.models.generateContent({
            model: selectedImageModel,
            contents: previewPrompt,
          });

          if (cancelled) {
            delete attemptedPreviewSignaturesRef.current[candidate.id];
            return;
          }

          const { generatedImageDataUrl } = extractGeneratedImageResult(imageResult);
          if (!generatedImageDataUrl) {
            delete attemptedPreviewSignaturesRef.current[candidate.id];
            continue;
          }

          const persistedCandidates = await persistCandidatePreviewImage(candidate.id, generatedImageDataUrl);
          if (persistedCandidates) {
            nextCandidates = persistedCandidates;
          }
        } catch (error) {
          delete attemptedPreviewSignaturesRef.current[candidate.id];
          console.error(error);
        }
      }

      if (!cancelled) {
        setActivePreviewId(null);
      }
    };

    void generateMissingPreviewImages();

    return () => {
      cancelled = true;
    };
  }, [analysisData, candidates, persistCandidatePreviewImage, previewMode, previewRetryNonce, selectedImageModel, sessionId]);

  if (isAnalyzing || !analysisData || analysisData.status === "pending") {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm font-medium text-gray-500 animate-pulse">AI가 레이아웃 시안을 생성하고 있습니다...</p>
        </div>
      </div>
    );
  }

  if (!selectedPlan) {
    return <div className="flex h-full items-center justify-center bg-white px-6 text-center text-sm text-gray-500">현재 세션에는 레이아웃 시안이 없습니다.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 md:px-5 md:py-5">
        <div className="space-y-4">
          <section className="rounded-[28px] border border-gray-200/80 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Layout System Prompt</p>
                <h3 className="mt-1 text-sm font-semibold text-gray-900">레이아웃 생성 지침</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-500">이 프롬프트가 Gemini의 layoutPlan 후보 생성에 직접 들어갑니다. 저장 후 다시 분석하면 새 시안에 반영됩니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPromptDraft(DEFAULT_LAYOUT_SYSTEM_PROMPT)}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> 기본값
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveAndRegenerate();
                  }}
                  disabled={isSubmittingPrompt || isAnalyzing}
                  className="inline-flex items-center rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                  {isSubmittingPrompt || isAnalyzing ? "새 시안 생성 중..." : "새 시안 생성"}
                </button>
              </div>
            </div>

            <textarea
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              rows={8}
              placeholder="레이아웃 시안 생성 규칙을 입력하세요"
              className="mt-4 min-h-[180px] w-full resize-y rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3 text-[12.5px] leading-relaxed text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:bg-white"
            />
          </section>

          <section className="rounded-[28px] border border-gray-200/80 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Layout Candidates</p>
                <h3 className="mt-1 text-sm font-semibold text-gray-900">AI 레이아웃 시안 선택</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-500">기본값인 HTML 모드에서 layoutPlan과 표 데이터를 합쳐 실제 구조에 가까운 시안을 비교할 수 있습니다. 이미지 모드는 기존 생성 경로를 그대로 사용합니다.</p>
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
                      onClick={() => {
                        if (mode.id === "image" && previewMode === "image") {
                          setPreviewRetryNonce((value) => value + 1);
                        }
                        setPreviewMode(mode.id);
                      }}
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

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              {candidates.map((candidate, index) => {
                const isSelected = selectedPlan.id === candidate.id;
                const isGeneratingPreview = activePreviewId === candidate.id && !candidate.previewImageDataUrl;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      void selectCandidate(candidate);
                    }}
                    className={`rounded-[28px] border p-4 text-left transition-all md:p-5 ${
                      isSelected ? "border-blue-500 bg-blue-50 shadow-sm shadow-blue-100/70" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-500">안 {index + 1}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{candidate.name || `시안 ${index + 1}`}</p>
                      </div>
                      {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />}
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{candidate.description || "대시보드 시안"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-medium text-gray-500">
                        {candidate.sections.filter((section) => section.type === "chart-group").length}개 차트 섹션
                      </div>
                      {isGeneratingPreview && (
                        <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-medium text-blue-600">
                          이미지 미리보기 생성 중
                        </div>
                      )}
                    </div>

                    <div className="mt-4 overflow-hidden rounded-[24px] border border-gray-200 bg-[#f7f8fb] p-3 shadow-inner md:p-4">
                      {previewMode === "html" ? (
                        <LayoutHtmlPreview plan={candidate} analysisData={analysisData} previewDataContext={previewDataContext} compact />
                      ) : candidate.previewImageDataUrl ? (
                        <div className="overflow-hidden rounded-[18px] border border-gray-200 bg-white shadow-sm">
                          <Image
                            src={candidate.previewImageDataUrl}
                            alt={`${candidate.name || `시안 ${index + 1}`} 미리보기`}
                            width={1600}
                            height={1200}
                            unoptimized
                            className="h-auto w-full bg-white object-contain"
                          />
                        </div>
                      ) : (
                        <VisualDraftBoard plan={candidate} analysisData={analysisData} compact />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function normalizePreviewText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePreviewKey(value?: string | null): string {
  return normalizePreviewText(value).toLowerCase().replace(/\s+/g, " ");
}

function isHeaderHint(header: string, hints: string[]): boolean {
  const normalized = normalizePreviewKey(header);
  return hints.some((hint) => normalized.includes(hint));
}

function parsePlainNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!NUMBER_VALUE_REGEX.test(value.trim()) && !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentNumber(value: string): number | null {
  const normalized = value.trim();
  if (!PERCENT_VALUE_REGEX.test(normalized)) return null;
  return parsePlainNumber(normalized.replace(/%/g, "").trim());
}

function parseCurrencyNumber(value: string): number | null {
  const normalized = value.trim();
  if (!CURRENCY_SYMBOL_REGEX.test(normalized)) return null;
  return parsePlainNumber(normalized.replace(CURRENCY_SYMBOL_REGEX, ""));
}

function parseMetricValue(value: string): number | null {
  return parsePercentNumber(value) ?? parseCurrencyNumber(value) ?? parsePlainNumber(value);
}

function parseDateOrder(value: string): number | null {
  const normalized = value.trim();
  if (!DATE_VALUE_REGEXES.some((regex) => regex.test(normalized))) {
    return null;
  }

  const timestamp = Date.parse(normalized.replace(/\./g, "-"));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000000) {
    return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return value.toLocaleString("ko-KR", { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 });
}

function buildPreviewDataContext(tableData?: AnalysisData["tableData"]): PreviewDataContext {
  if (!tableData) {
    return { columns: [], rows: [], profiles: [], primaryMetricIndex: -1, primaryDimensionIndex: -1, secondaryDimensionIndex: -1 };
  }

  const columns = tableData.columns;
  const rows = tableData.rows;
  const profiles = columns.map<PreviewColumnProfile>((name, index) => {
    const values = rows.map((row) => normalizePreviewText(row[index]));
    const nonEmptyValues = values.filter(Boolean);
    const distinctCount = new Set(nonEmptyValues).size;
    const numericMatches = nonEmptyValues.filter((value) => parseMetricValue(value) !== null).length;
    const percentMatches = nonEmptyValues.filter((value) => parsePercentNumber(value) !== null).length;
    const currencyMatches = nonEmptyValues.filter((value) => parseCurrencyNumber(value) !== null).length;
    const dateMatches = nonEmptyValues.filter((value) => parseDateOrder(value) !== null).length;
    const numericCoverage = numericMatches / Math.max(nonEmptyValues.length, 1);
    const dateCoverage = dateMatches / Math.max(nonEmptyValues.length, 1);
    const uniqueRatio = distinctCount / Math.max(nonEmptyValues.length, 1);
    const averageTextLength = nonEmptyValues.reduce((sum, value) => sum + value.length, 0) / Math.max(nonEmptyValues.length, 1);
    const isIdLike =
      uniqueRatio >= 0.95 &&
      averageTextLength <= 36 &&
      numericCoverage < 0.4 &&
      !isHeaderHint(name, GEO_HEADER_HINTS) &&
      isHeaderHint(name, ID_HEADER_HINTS);

    let kind: PreviewColumnKind = "text";
    if (dateCoverage >= 0.7) kind = "date";
    else if (percentMatches / Math.max(nonEmptyValues.length, 1) >= 0.7) kind = "percent";
    else if (currencyMatches / Math.max(nonEmptyValues.length, 1) >= 0.7) kind = "currency";
    else if (numericCoverage >= 0.7) kind = "number";

    return {
      index,
      name,
      kind,
      distinctCount,
      numericCoverage,
      dateCoverage,
      uniqueRatio,
      isGeoLike: isHeaderHint(name, GEO_HEADER_HINTS),
      isIdLike,
    };
  });

  const primaryMetricIndex = profiles
    .slice()
    .sort((left, right) => {
      const leftScore = left.numericCoverage * 100 + (isHeaderHint(left.name, ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"]) ? 12 : 0);
      const rightScore = right.numericCoverage * 100 + (isHeaderHint(right.name, ["amount", "total", "sum", "count", "price", "sales", "revenue", "profit", "rate", "score", "매출", "금액", "수량", "비율", "점수", "이익", "합계", "건수"]) ? 12 : 0);
      return rightScore - leftScore || left.index - right.index;
    })
    .find((profile) => profile.numericCoverage >= 0.5 && !profile.isIdLike)?.index ?? -1;

  const orderedDimensions = profiles
    .filter((profile) => profile.index !== primaryMetricIndex && !profile.isIdLike)
    .slice()
    .sort((left, right) => {
      const scoreDimension = (profile: PreviewColumnProfile) => {
        let score = 0;
        if (profile.kind === "date") score += 40;
        if (profile.kind === "text") score += 25;
        if (profile.kind === "number" && profile.distinctCount <= 12) score += 12;
        if (profile.distinctCount <= 12) score += 15;
        else if (profile.distinctCount <= 40) score += 6;
        else score -= 15;
        if (isHeaderHint(profile.name, DIMENSION_HEADER_HINTS)) score += 10;
        if (profile.isGeoLike) score += 8;
        score -= profile.uniqueRatio > 0.95 ? 25 : 0;
        return score;
      };
      return scoreDimension(right) - scoreDimension(left) || left.index - right.index;
    });

  return {
    columns,
    rows,
    profiles,
    primaryMetricIndex,
    primaryDimensionIndex: orderedDimensions[0]?.index ?? -1,
    secondaryDimensionIndex: orderedDimensions.find((profile) => profile.distinctCount <= 8)?.index ?? orderedDimensions[1]?.index ?? -1,
  };
}

function findColumnIndex(context: PreviewDataContext, preferredName?: string, options?: { requireNumeric?: boolean; exclude?: number[] }): number {
  const normalizedName = normalizePreviewKey(preferredName);
  const excluded = new Set(options?.exclude ?? []);

  if (normalizedName) {
    const exactMatch = context.profiles.find((profile) => !excluded.has(profile.index) && normalizePreviewKey(profile.name) === normalizedName);
    if (exactMatch && (!options?.requireNumeric || exactMatch.numericCoverage >= 0.5)) {
      return exactMatch.index;
    }

    const partialMatch = context.profiles.find((profile) => !excluded.has(profile.index) && normalizePreviewKey(profile.name).includes(normalizedName));
    if (partialMatch && (!options?.requireNumeric || partialMatch.numericCoverage >= 0.5)) {
      return partialMatch.index;
    }
  }

  return -1;
}

function resolveMetricIndex(context: PreviewDataContext, preferredName?: string, exclude?: number[]): number {
  const matchedIndex = findColumnIndex(context, preferredName, { requireNumeric: true, exclude });
  if (matchedIndex >= 0) return matchedIndex;
  if (context.primaryMetricIndex >= 0 && !(exclude ?? []).includes(context.primaryMetricIndex)) {
    return context.primaryMetricIndex;
  }
  return -1;
}

function resolveDimensionIndex(context: PreviewDataContext, preferredName: string | undefined, metricIndex: number): number {
  const matchedIndex = findColumnIndex(context, preferredName, { exclude: [metricIndex] });
  if (matchedIndex >= 0) return matchedIndex;
  if (context.primaryDimensionIndex >= 0 && context.primaryDimensionIndex !== metricIndex) {
    return context.primaryDimensionIndex;
  }
  return context.profiles.find((profile) => profile.index !== metricIndex)?.index ?? -1;
}

function resolveSplitDimensionIndex(context: PreviewDataContext, dimensionIndex: number, metricIndex: number): number {
  if (context.secondaryDimensionIndex >= 0 && context.secondaryDimensionIndex !== dimensionIndex && context.secondaryDimensionIndex !== metricIndex) {
    return context.secondaryDimensionIndex;
  }

  return (
    context.profiles
      .filter((profile) => profile.index !== dimensionIndex && profile.index !== metricIndex && !profile.isIdLike)
      .sort((left, right) => left.distinctCount - right.distinctCount || left.index - right.index)
      .find((profile) => profile.distinctCount <= 8)?.index ?? -1
  );
}

function aggregateByDimension(context: PreviewDataContext, dimensionIndex: number, metricIndex: number): AggregatedPreviewDatum[] {
  const dimensionProfile = context.profiles[dimensionIndex];
  const aggregated = new Map<string, AggregatedPreviewDatum>();

  context.rows.forEach((row, rowIndex) => {
    const label = normalizePreviewText(row[dimensionIndex]) || "미분류";
    const metricValue = parseMetricValue(normalizePreviewText(row[metricIndex]));
    if (metricValue === null) return;

    const order = dimensionProfile?.kind === "date" ? parseDateOrder(label) ?? rowIndex : rowIndex;
    const existing = aggregated.get(label);
    if (existing) {
      existing.value += metricValue;
      existing.order = Math.min(existing.order, order);
      return;
    }

    aggregated.set(label, { label, value: metricValue, order });
  });

  return Array.from(aggregated.values());
}

function sortPreviewItems(items: AggregatedPreviewDatum[], chartType: LayoutChartType, dimensionKind: PreviewColumnKind | undefined): AggregatedPreviewDatum[] {
  const sorted = items.slice();
  if (chartType === "line" && dimensionKind === "date") {
    return sorted.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  if (chartType === "line") {
    return sorted.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  return sorted.sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function buildPieLikeItems(items: AggregatedPreviewDatum[]): AggregatedPreviewDatum[] {
  if (items.length <= 5) return items;
  const head = items.slice(0, 4);
  const otherValue = items.slice(4).reduce((sum, item) => sum + item.value, 0);
  return otherValue > 0 ? [...head, { label: "기타", value: otherValue, order: Number.MAX_SAFE_INTEGER }] : head;
}

function buildStackedPreviewChart(
  chart: LayoutChartSpec,
  context: PreviewDataContext,
  dimensionIndex: number,
  metricIndex: number,
  splitIndex: number
): PreparedPreviewChart {
  const dimensionProfile = context.profiles[dimensionIndex];
  const categoryMap = new Map<string, { label: string; total: number; order: number; splits: Map<string, number> }>();
  const splitTotals = new Map<string, number>();

  context.rows.forEach((row, rowIndex) => {
    const categoryLabel = normalizePreviewText(row[dimensionIndex]) || "미분류";
    const splitLabel = normalizePreviewText(row[splitIndex]) || "기타";
    const metricValue = parseMetricValue(normalizePreviewText(row[metricIndex]));
    if (metricValue === null) return;

    const order = dimensionProfile?.kind === "date" ? parseDateOrder(categoryLabel) ?? rowIndex : rowIndex;
    const category = categoryMap.get(categoryLabel) ?? {
      label: categoryLabel,
      total: 0,
      order,
      splits: new Map<string, number>(),
    };

    category.total += metricValue;
    category.order = Math.min(category.order, order);
    category.splits.set(splitLabel, (category.splits.get(splitLabel) ?? 0) + metricValue);
    categoryMap.set(categoryLabel, category);
    splitTotals.set(splitLabel, (splitTotals.get(splitLabel) ?? 0) + metricValue);
  });

  const categories = sortPreviewItems(
    Array.from(categoryMap.values()).map((item) => ({ label: item.label, value: item.total, order: item.order })),
    chart.chartType,
    dimensionProfile?.kind
  ).slice(0, 5);
  const primarySplits = Array.from(splitTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label]) => label);

  const stackedSeries = primarySplits.map((label, index) => ({
    label,
    values: categories.map((category) => categoryMap.get(category.label)?.splits.get(label) ?? 0),
    color: PREVIEW_SERIES_COLORS[index],
  }));

  const otherValues = categories.map((category) => {
    const categoryItem = categoryMap.get(category.label);
    if (!categoryItem) return 0;
    const selectedTotal = primarySplits.reduce((sum, splitLabel) => sum + (categoryItem.splits.get(splitLabel) ?? 0), 0);
    return Math.max(categoryItem.total - selectedTotal, 0);
  });

  if (otherValues.some((value) => value > 0)) {
    stackedSeries.push({ label: "기타", values: otherValues, color: PREVIEW_SERIES_COLORS[3] });
  }

  return {
    renderKind: categories.length > 0 ? "canvas" : "empty",
    chartType: chart.chartType,
    canvasType: "bar",
    title: chart.title,
    goal: chart.goal,
    dimensionLabel: context.columns[dimensionIndex] ?? chart.dimension ?? "dimension",
    metricLabel: context.columns[metricIndex] ?? chart.metric ?? "metric",
    labels: categories.map((category) => category.label),
    values: categories.map((category) => category.value),
    stackedSeries: stackedSeries.map((series) => ({ label: series.label, values: series.values })),
    items: categories,
    infoNote: `${context.columns[splitIndex] ?? "세그먼트"} 기준 분해`,
  };
}

function buildPreparedPreviewChart(chart: LayoutChartSpec, context: PreviewDataContext): PreparedPreviewChart {
  const metricIndex = resolveMetricIndex(context, chart.metric);
  const dimensionIndex = resolveDimensionIndex(context, chart.dimension, metricIndex);

  if (metricIndex < 0 || dimensionIndex < 0) {
    return {
      renderKind: "empty",
      chartType: chart.chartType,
      title: chart.title,
      goal: chart.goal,
      dimensionLabel: chart.dimension ?? "dimension",
      metricLabel: chart.metric ?? "metric",
      labels: [],
      values: [],
      items: [],
      infoNote: "표에서 연결 가능한 차트 데이터를 찾지 못했습니다.",
    };
  }

  if (chart.chartType === "stacked-bar") {
    const splitIndex = resolveSplitDimensionIndex(context, dimensionIndex, metricIndex);
    if (splitIndex >= 0) {
      return buildStackedPreviewChart(chart, context, dimensionIndex, metricIndex, splitIndex);
    }
  }

  const dimensionProfile = context.profiles[dimensionIndex];
  const aggregatedItems = sortPreviewItems(aggregateByDimension(context, dimensionIndex, metricIndex), chart.chartType, dimensionProfile?.kind);
  const slicedItems =
    chart.chartType === "donut" || chart.chartType === "pie"
      ? buildPieLikeItems(aggregatedItems)
      : aggregatedItems.slice(0, chart.chartType === "map" ? 5 : 6);

  return {
    renderKind: slicedItems.length > 0 ? (chart.chartType === "map" ? "geo-rank" : "canvas") : "empty",
    chartType: chart.chartType,
    canvasType:
      chart.chartType === "line" ? "line" : chart.chartType === "donut" ? "doughnut" : chart.chartType === "pie" ? "pie" : "bar",
    title: chart.title,
    goal: chart.goal,
    dimensionLabel: context.columns[dimensionIndex] ?? chart.dimension ?? "dimension",
    metricLabel: context.columns[metricIndex] ?? chart.metric ?? "metric",
    labels: slicedItems.map((item) => item.label),
    values: slicedItems.map((item) => item.value),
    items: slicedItems,
    infoNote: chart.chartType === "map" ? "지도 대신 지역 랭킹으로 비교" : `${context.rows.length.toLocaleString("ko-KR")}개 행 기준 집계`,
  };
}

function buildPreviewChartConfig(preview: PreparedPreviewChart): ChartConfiguration<PreviewCanvasType, number[], string> | null {
  if (preview.renderKind !== "canvas" || !preview.canvasType) {
    return null;
  }

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: Boolean(preview.stackedSeries && preview.stackedSeries.length > 1),
        position: "bottom" as const,
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          color: "#64748b",
          font: { size: 10, weight: 600 },
          padding: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: (context: { dataset: { label?: string }; parsed: { y?: number; x?: number } | number }) => {
            const numericValue = typeof context.parsed === "number" ? context.parsed : context.parsed.y ?? context.parsed.x ?? 0;
            return `${context.dataset.label ? `${context.dataset.label}: ` : ""}${formatPreviewNumber(numericValue)}`;
          },
        },
      },
    },
  };

  if (preview.canvasType === "line") {
    return {
      type: "line",
      data: {
        labels: preview.labels,
        datasets: [
          {
            label: preview.metricLabel,
            data: preview.values,
            borderColor: PREVIEW_SERIES_COLORS[0],
            backgroundColor: "rgba(37,99,235,0.14)",
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 2,
            pointHoverRadius: 2,
          },
        ],
      },
      options: {
        ...baseOptions,
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.16)" } },
        },
      },
    };
  }

  if (preview.canvasType === "doughnut" || preview.canvasType === "pie") {
    return {
      type: preview.canvasType,
      data: {
        labels: preview.labels,
        datasets: [
          {
            label: preview.metricLabel,
            data: preview.values,
            backgroundColor: preview.labels.map((_, index) => PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length]),
            borderColor: "#ffffff",
            borderWidth: 2,
            hoverOffset: 0,
          },
        ],
      },
      options: {
        ...baseOptions,
        cutout: preview.canvasType === "doughnut" ? "58%" : 0,
      },
    };
  }

  return {
    type: "bar",
    data: {
      labels: preview.labels,
      datasets: preview.stackedSeries && preview.stackedSeries.length > 0
        ? preview.stackedSeries.map((series, index) => ({
            label: series.label,
            data: series.values,
            backgroundColor: PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length],
            borderRadius: 8,
            borderSkipped: false as const,
            maxBarThickness: 26,
          }))
        : [
            {
              label: preview.metricLabel,
              data: preview.values,
              backgroundColor: preview.labels.map((_, index) => PREVIEW_SERIES_COLORS[index % PREVIEW_SERIES_COLORS.length]),
              borderRadius: 10,
              borderSkipped: false as const,
              maxBarThickness: 28,
            },
          ],
    },
    options: {
      ...baseOptions,
      scales: {
        x: {
          stacked: Boolean(preview.stackedSeries?.length),
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          stacked: Boolean(preview.stackedSeries?.length),
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(148,163,184,0.16)" },
        },
      },
    },
  };
}

function buildPreviewKpis(section: LayoutSection, context: PreviewDataContext): PreviewKpiItem[] {
  const metricIndex = resolveMetricIndex(context, undefined);
  const dimensionIndex = resolveDimensionIndex(context, undefined, metricIndex);
  const metricLabel = context.columns[metricIndex] ?? "핵심 지표";
  const aggregatedItems = metricIndex >= 0 && dimensionIndex >= 0 ? aggregateByDimension(context, dimensionIndex, metricIndex) : [];
  const sortedItems = aggregatedItems.slice().sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  const totalValue = aggregatedItems.reduce((sum, item) => sum + item.value, 0);
  const averageValue = aggregatedItems.length > 0 ? totalValue / aggregatedItems.length : 0;
  const topItem = sortedItems[0];

  const sourceItems = section.items && section.items.length > 0
    ? section.items
    : [
        { label: metricLabel, value: "" },
        { label: "대표 항목", value: "" },
        { label: "행 수", value: "" },
      ];

  return sourceItems.slice(0, 3).map((item, index) => {
    const normalizedLabel = normalizePreviewKey(item.label);

    if (normalizedLabel.includes("행") || normalizedLabel.includes("row") || normalizedLabel.includes("건수") || normalizedLabel.includes("count")) {
      return { label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    if (normalizedLabel.includes("열") || normalizedLabel.includes("column")) {
      return { label: item.label, value: context.columns.length.toLocaleString("ko-KR"), note: "열 개수" };
    }

    if (normalizedLabel.includes("평균") || normalizedLabel.includes("avg") || normalizedLabel.includes("mean")) {
      return { label: item.label, value: formatPreviewNumber(averageValue), note: `${metricLabel} 평균` };
    }

    if (normalizedLabel.includes("최대") || normalizedLabel.includes("max")) {
      return { label: item.label, value: formatPreviewNumber(sortedItems[0]?.value ?? 0), note: `${context.columns[dimensionIndex] ?? "차원"} 최고값` };
    }

    if (normalizedLabel.includes("대표") || normalizedLabel.includes("1위") || normalizedLabel.includes("top") || normalizedLabel.includes("최고")) {
      return { label: item.label, value: topItem?.label ?? item.value, note: topItem ? `${formatPreviewNumber(topItem.value)} 기준` : "대표 항목" };
    }

    if (index === 0 && metricIndex >= 0) {
      return { label: item.label, value: formatPreviewNumber(totalValue), note: `${metricLabel} 합계` };
    }

    if (index === 1 && topItem) {
      return { label: item.label, value: topItem.label, note: `${formatPreviewNumber(topItem.value)} 기준` };
    }

    if (index === 2) {
      return { label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    return { label: item.label, value: item.value, note: section.title || "핵심 수치" };
  });
}

function ChartCanvas({ preview }: { preview: PreparedPreviewChart }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart<PreviewCanvasType, number[], string> | null>(null);
  const chartTypeRef = useRef<PreviewCanvasType | null>(null);
  const chartConfig = useMemo(() => buildPreviewChartConfig(preview), [preview]);

  useEffect(() => {
    if (!chartConfig) {
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
      chartTypeRef.current = null;
      return;
    }

    if (!canvasRef.current) return;

    const existingInstance = chartInstanceRef.current;
    if (!existingInstance || chartTypeRef.current !== chartConfig.type) {
      existingInstance?.destroy();
      chartInstanceRef.current = new Chart<PreviewCanvasType, number[], string>(canvasRef.current, chartConfig);
      chartTypeRef.current = chartConfig.type;
      return;
    }

    existingInstance.data = chartConfig.data;
    if (chartConfig.options) {
      existingInstance.options = chartConfig.options;
    }
    existingInstance.update("none");
  }, [chartConfig]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.destroy();
      chartInstanceRef.current = null;
      chartTypeRef.current = null;
    };
  }, []);

  if (!chartConfig) {
    return null;
  }

  return <canvas ref={canvasRef} aria-label={`${preview.title} 차트 미리보기`} role="img" />;
}

function GeoRankFallback({ preview }: { preview: PreparedPreviewChart }) {
  const maxValue = Math.max(...preview.values, 0);

  return (
    <div className="space-y-2.5">
      {preview.items.map((item, index) => {
        const width = maxValue > 0 ? `${Math.max((item.value / maxValue) * 100, 10)}%` : "10%";
        return (
          <div key={`${item.label}-${index}`} className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 text-[10.5px] text-slate-600">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">{index + 1}</span>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-slate-700">{item.label}</span>
                <span className="text-[10px] text-slate-400">{formatPreviewNumber(item.value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200/80">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#0ea5e9)]" style={{ width }} />
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-medium text-slate-500">Geo rank</span>
          </div>
        );
      })}
    </div>
  );
}

function HtmlChartCard({ chart, preview, compact = false }: { chart: LayoutChartSpec; preview: PreparedPreviewChart; compact?: boolean }) {
  return (
    <article className={`rounded-[18px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-slate-900">{chart.title}</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{chart.goal}</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-700">
          {chart.chartType === "stacked-bar" ? "stacked" : chart.chartType === "donut" ? "donut" : chart.chartType}
        </span>
      </div>

      <div className={`mt-3 overflow-hidden rounded-[16px] border border-slate-100 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] ${compact ? "p-3" : "p-3.5"}`}>
        {preview.renderKind === "geo-rank" ? (
          <GeoRankFallback preview={preview} />
        ) : preview.renderKind === "canvas" ? (
          <div className={compact ? "h-32" : "h-36"}>
            <ChartCanvas preview={preview} />
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center rounded-[12px] border border-dashed border-slate-200 bg-white text-center text-[10.5px] leading-relaxed text-slate-400">
            {preview.infoNote}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-400">
        <span>{preview.dimensionLabel}</span>
        <span>{preview.metricLabel}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{preview.infoNote}</p>
    </article>
  );
}

function HtmlSectionPreview({
  plan,
  section,
  analysisData,
  previewDataContext,
  compact = false,
}: {
  plan: LayoutPlan;
  section: LayoutSection;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataContext;
  compact?: boolean;
}) {
  if (section.type === "header") {
    return null;
  }

  if (section.type === "chart-group" && section.charts && section.charts.length > 0) {
    const gridClass = section.charts.length === 1 || plan.aspectRatio === "portrait" ? "grid-cols-1" : "grid-cols-2";
    return (
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{section.title || SECTION_TYPE_LABELS[section.type]}</h4>
          <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{section.charts.length} charts</span>
        </div>
        <div className={`grid gap-2.5 ${gridClass}`}>
          {section.charts.map((chart) => (
            <HtmlChartCard key={chart.id} chart={chart} preview={buildPreparedPreviewChart(chart, previewDataContext)} compact={compact} />
          ))}
        </div>
      </section>
    );
  }

  if (section.type === "kpi-group") {
    const kpis = buildPreviewKpis(section, previewDataContext);
    return (
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{section.title || SECTION_TYPE_LABELS[section.type]}</h4>
          <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{kpis.length} metrics</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {kpis.map((item) => (
            <div key={item.label} className={`rounded-[16px] border border-slate-200 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.05)] ${compact ? "px-2.5 py-3" : "px-3 py-3.5"}`}>
              <p className="text-[10px] font-medium text-slate-500">{item.label}</p>
              <p className="mt-2 text-[15px] font-bold tracking-[-0.03em] text-slate-900">{item.value}</p>
              <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{item.note}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const noteText =
    section.note ||
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    (Array.isArray(analysisData?.issues) ? analysisData?.issues[0]?.text : analysisData?.issues) ||
    analysisData?.keywords.slice(0, 3).join(" · ") ||
    "핵심 시사점을 짧게 요약하는 영역";

  return (
    <section className="rounded-[18px] border border-slate-200/80 bg-white px-3 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{section.title || SECTION_TYPE_LABELS[section.type]}</h4>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-500">{SECTION_TYPE_LABELS[section.type]}</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{noteText}</p>
    </section>
  );
}

function LayoutHtmlPreview({
  plan,
  analysisData,
  previewDataContext,
  compact = false,
}: {
  plan: LayoutPlan;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataContext;
  compact?: boolean;
}) {
  const headerTitle = plan.sections.find((section) => section.type === "header")?.title;
  const title = analysisData?.title?.trim() || headerTitle || plan.name || "데이터 레이아웃";
  const summaryText =
    analysisData?.summaries[0]?.lines?.[0]?.text ||
    (Array.isArray(analysisData?.issues) ? analysisData?.issues[0]?.text : analysisData?.issues) ||
    analysisData?.keywords.slice(0, 3).join(" · ") ||
    plan.description ||
    "표 데이터를 기반으로 재구성한 레이아웃 미리보기";

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.95)_0%,rgba(255,255,255,1)_58%,rgba(248,250,252,1)_100%)] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Deterministic HTML Preview</p>
            <h3 className="mt-1 text-[18px] font-bold tracking-[-0.04em] text-slate-900">{title}</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{summaryText}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-700">{plan.aspectRatio}</span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[9px] font-medium text-slate-500">{previewDataContext.rows.length.toLocaleString("ko-KR")} rows</span>
          </div>
        </div>
      </div>

      <div className={`bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.32),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] ${compact ? "p-3" : "p-4"}`} style={{ aspectRatio: PREVIEW_ASPECT_RATIOS[plan.aspectRatio] }}>
        <div className="flex h-full flex-col gap-2.5 overflow-hidden">
          {plan.sections.map((section) => (
            <HtmlSectionPreview key={section.id} plan={plan} section={section} analysisData={analysisData} previewDataContext={previewDataContext} compact={compact} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VisualDraftBoard({ plan, analysisData, compact = false }: { plan: LayoutPlan; analysisData: AnalysisData | null; compact?: boolean }) {
  const title = analysisData?.title?.trim() || plan.sections.find((section) => section.type === "header")?.title || "인포그래픽 시안";
  const summaryText = analysisData?.summaries[0]?.lines?.[0]?.text || analysisData?.keywords.slice(0, 3).join(" · ") || "핵심 비교 포인트가 먼저 보이는 구조";

  return (
    <div className={`rounded-[18px] bg-white shadow-sm ${compact ? "px-4 py-4" : "px-5 py-5"}`}>
      <div className={`border-b border-gray-200 ${compact ? "pb-3" : "pb-4"}`}>
        <p className="text-[11px] font-medium text-gray-500">레이아웃 시안</p>
        <h2 className={`mt-1 font-bold tracking-[-0.04em] text-gray-900 ${compact ? "text-[21px] leading-[1.15]" : "text-[25px]"}`}>{title}</h2>
        <p className={`mt-2 text-gray-500 ${compact ? "text-[11px] leading-relaxed" : "text-[12px]"}`}>{summaryText}</p>
      </div>

      <div className={`space-y-4 ${compact ? "mt-4" : "mt-5"}`}>
        {plan.sections.map((section, index) => (
          <DraftSectionCard key={section.id} section={section} index={index} compact={compact} />
        ))}
      </div>
    </div>
  );
}

function DraftSectionCard({ section, index, compact = false }: { section: LayoutSection; index: number; compact?: boolean }) {
  if (section.type === "header") return null;
  const isComparisonSection = section.title?.includes("비교") || section.title?.includes("핵심");
  const isRepeatedSection = section.title?.includes("주요 섹션") || section.title?.includes("반복");

  return (
    <section className={compact ? "space-y-2.5" : "space-y-3"}>
      <div className={`flex items-center justify-between rounded-sm bg-[#456fbe] text-white ${compact ? "px-3 py-2" : "px-4 py-2"}`}>
        <span className="text-[11px] font-semibold tracking-[0.01em]">
          {index + 1}. {section.title || SECTION_TYPE_LABELS[section.type]}
        </span>
        <span className="text-[10px] font-medium opacity-80">Base: 전체</span>
      </div>

      {section.type === "chart-group" && section.charts && section.charts.length > 0 ? (
        isComparisonSection ? (
          <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-[96px_minmax(0,1fr)]"}`}>
            <div className={compact ? "grid grid-cols-2 gap-3" : "space-y-3"}>
              {section.charts.slice(0, 2).map((chart) => (
                <div key={chart.id} className={`flex items-center justify-center bg-[#4f76c0] px-3 py-3 text-center text-white ${compact ? "min-h-[84px] rounded-[14px]" : "min-h-[112px]"}`}>
                  <span className="whitespace-pre-line text-[12px] font-semibold leading-tight">{chart.title}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {section.charts.map((chart, chartIndex) => (
                <div
                  key={chart.id}
                  className={`grid items-center gap-4 rounded-[14px] border border-gray-200 bg-white ${compact ? "px-3 py-3 grid-cols-1" : "px-4 py-4 md:grid-cols-[140px_minmax(0,1fr)]"}`}
                >
                  <div className="flex items-center justify-center">
                    {chart.chartType === "donut" || chart.chartType === "pie" ? (
                      <div className={`relative rounded-full bg-[conic-gradient(#4d76c2_0_72%,#f38b2a_72%_100%)] shadow-inner ${compact ? "h-24 w-24" : "h-28 w-28"}`}>
                        <div className={`absolute rounded-full bg-white ${compact ? "inset-[18px]" : "inset-[22px]"}`} />
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[#355ca6]">{chart.chartType.toUpperCase()}</div>
                      </div>
                    ) : (
                      <div className={`flex w-full items-end px-2 ${compact ? "h-24 gap-2" : "h-28 gap-3"}`}>
                        {[44, 78, 56, 68].map((height, itemIndex) => (
                          <div key={itemIndex} className="flex flex-1 flex-col items-center gap-2">
                            <div className="w-full rounded-t-sm bg-[#4d76c2]" style={{ height: compact ? Math.max(24, Math.round(height * 0.82)) : height }} />
                            <span className="text-[10px] text-gray-400">항목</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className={`grid flex-1 gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_92px]"}`}>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-800">{chart.title}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{chart.goal}</p>
                        <div className="mt-3 flex gap-3 border-t border-gray-100 pt-3 text-[10px] text-gray-400">
                          <span>{chart.dimension || "dimension"}</span>
                          <span>{chart.metric || "metric"}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-center">
                        <div className={`flex items-center justify-center rounded-full bg-[#4d76c2] text-center text-white shadow-inner ${compact ? "h-[76px] w-[76px]" : "h-[92px] w-[92px]"}`}>
                          <div>
                            <p className="text-[10px] font-medium opacity-80">핵심</p>
                            <p className={`mt-1 font-bold ${compact ? "text-[14px]" : "text-[16px]"}`}>{chartIndex + 1}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : isRepeatedSection ? (
          <div className="space-y-3">
            {section.charts.map((chart, chartIndex) => (
              <div key={chart.id} className={`grid gap-3 rounded-[14px] border border-gray-200 bg-white ${compact ? "grid-cols-[72px_minmax(0,1fr)] px-3 py-3" : "grid-cols-[96px_minmax(0,1fr)] px-4 py-4"}`}>
                <div className="flex items-center justify-center bg-[#4f76c0] text-center text-white rounded-[12px] px-2 py-3">
                  <span className="text-[11px] font-semibold leading-tight">블록 {chartIndex + 1}</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold text-gray-800">{chart.title}</p>
                      <p className="mt-1 text-[11px] text-gray-500">{chart.goal}</p>
                    </div>
                    <div className={`rounded-full bg-[#4d76c2] text-white shadow-inner flex items-center justify-center ${compact ? "h-14 w-14 text-[12px]" : "h-16 w-16 text-[13px]"}`}>
                      요약
                    </div>
                  </div>
                  {chart.chartType === "donut" || chart.chartType === "pie" ? (
                    <div className="flex items-center gap-4">
                      <div className={`relative rounded-full bg-[conic-gradient(#4d76c2_0_72%,#f38b2a_72%_100%)] shadow-inner ${compact ? "h-20 w-20" : "h-24 w-24"}`}>
                        <div className={`absolute rounded-full bg-white ${compact ? "inset-[14px]" : "inset-[18px]"}`} />
                      </div>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        {[26, 44, 32].map((height, itemIndex) => (
                          <div key={itemIndex} className="flex flex-col gap-1">
                            <div className="rounded-sm bg-[#4d76c2]" style={{ height }} />
                            <div className="h-2 rounded-sm bg-gray-100" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`flex items-end gap-2 rounded-lg bg-gray-50 px-2 ${compact ? "h-20 py-2" : "h-24 py-3"}`}>
                        {[34, 52, 40, 58].map((height, itemIndex) => (
                          <div key={itemIndex} className="flex-1 rounded-t-sm bg-[#4d76c2]" style={{ height }} />
                        ))}
                      </div>
                      <div className={`rounded-lg border border-gray-100 bg-gray-50 ${compact ? "h-20" : "h-24"}`} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {section.charts.map((chart) => (
              <div key={chart.id} className={`rounded-[14px] border border-gray-200 bg-white ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-gray-800">{chart.title}</p>
                    <p className="mt-1 text-[11px] text-gray-500">{chart.goal}</p>
                  </div>
                  <div className={`rounded-full bg-[#4d76c2] text-white flex items-center justify-center ${compact ? "h-12 w-12 text-[11px]" : "h-14 w-14 text-[12px]"}`}>
                    KPI
                  </div>
                </div>
                <div className="mt-3">
                  {chart.chartType === "donut" || chart.chartType === "pie" ? (
                    <div className="flex items-center gap-4">
                      <div className={`relative rounded-full bg-[conic-gradient(#4d76c2_0_72%,#f38b2a_72%_100%)] shadow-inner ${compact ? "h-20 w-20" : "h-24 w-24"}`}>
                        <div className={`absolute rounded-full bg-white ${compact ? "inset-[14px]" : "inset-[18px]"}`} />
                      </div>
                      <div className="flex-1 rounded-lg border border-gray-100 bg-gray-50 h-16" />
                    </div>
                  ) : (
                    <div className={`flex items-end gap-2 rounded-lg bg-gray-50 px-2 ${compact ? "h-20 py-2" : "h-24 py-3"}`}>
                      {[30, 42, 34, 46].map((height, itemIndex) => (
                        <div key={itemIndex} className="flex-1 rounded-t-sm bg-[#4d76c2]" style={{ height }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : section.type === "kpi-group" && section.items ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {section.items.map((item, itemIndex) => (
            <div key={`${item.label}-${itemIndex}`} className={`rounded-[14px] border border-gray-200 bg-white text-center ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
              <p className="text-[11px] font-medium text-gray-500">{item.label}</p>
              <p className={`mt-2 font-bold text-[#365ea8] ${compact ? "text-[21px]" : "text-[24px]"}`}>{item.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className={`rounded-[14px] border border-gray-200 bg-white ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
          <p className="text-[13px] font-semibold text-gray-800">{section.title || SECTION_TYPE_LABELS[section.type]}</p>
          {section.note && <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{section.note}</p>}
        </div>
      )}
    </section>
  );
}
