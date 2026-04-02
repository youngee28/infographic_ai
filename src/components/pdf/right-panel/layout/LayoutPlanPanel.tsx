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
import { RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { getAnalysisTitle, getCautions, getFindings, getLegacyKeywordFallback, getVisualizationPrompt } from "@/lib/analysis-selectors";
import { buildInfographicContext, extractGeneratedImageResult } from "@/lib/infographic-generation";
import { DEFAULT_LAYOUT_SYSTEM_PROMPT } from "@/lib/layout-prompts";
import { store } from "@/lib/store";
import type { AnalysisData, LayoutChartSpec, LayoutChartType, LayoutGeometry, LayoutKpiItem, LayoutPlan, LayoutSection, LayoutSectionType } from "@/lib/session-types";

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
  id: string;
  label: string;
  value: string;
  note: string;
}

interface LayoutCanvasSize {
  width: number;
  height: number;
}

interface ActiveLayoutInteraction {
  type: "drag" | "resize" | "section-reorder";
  origin?: LayoutGeometry;
  startClientX: number;
  startClientY: number;
  sectionId?: string;
  resizeDirection?: ResizeHandleDirection;
  apply?: (current: LayoutPlan, nextLayout: LayoutGeometry) => LayoutPlan;
}

interface EditableFieldState {
  id: string;
  value: string;
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
const MIN_LAYOUT_WIDTH = 18;
const MIN_LAYOUT_HEIGHT = 12;

type ResizeHandleDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_HANDLE_DEFINITIONS: Array<{
  direction: ResizeHandleDirection;
  hitAreaClassName: string;
  indicatorClassName: string;
  cursorClassName: string;
  ariaLabelSuffix: string;
}> = [
  {
    direction: "n",
    hitAreaClassName: "top-0 left-4 right-4 h-3",
    indicatorClassName: "left-1/2 top-1 h-2 w-7 -translate-x-1/2 border-t-2",
    cursorClassName: "cursor-n-resize",
    ariaLabelSuffix: "상단",
  },
  {
    direction: "s",
    hitAreaClassName: "bottom-0 left-4 right-4 h-3",
    indicatorClassName: "bottom-1 left-1/2 h-2 w-7 -translate-x-1/2 border-b-2",
    cursorClassName: "cursor-s-resize",
    ariaLabelSuffix: "하단",
  },
  {
    direction: "e",
    hitAreaClassName: "right-0 top-4 bottom-4 w-3",
    indicatorClassName: "right-1 top-1/2 h-7 w-2 -translate-y-1/2 border-r-2",
    cursorClassName: "cursor-e-resize",
    ariaLabelSuffix: "오른쪽",
  },
  {
    direction: "w",
    hitAreaClassName: "left-0 top-4 bottom-4 w-3",
    indicatorClassName: "left-1 top-1/2 h-7 w-2 -translate-y-1/2 border-l-2",
    cursorClassName: "cursor-w-resize",
    ariaLabelSuffix: "왼쪽",
  },
  {
    direction: "ne",
    hitAreaClassName: "right-0 top-0 h-3 w-3",
    indicatorClassName: "right-1 top-1 h-2 w-2 border-r-2 border-t-2 rounded-tr-[5px]",
    cursorClassName: "cursor-ne-resize",
    ariaLabelSuffix: "오른쪽 위 모서리",
  },
  {
    direction: "nw",
    hitAreaClassName: "left-0 top-0 h-3 w-3",
    indicatorClassName: "left-1 top-1 h-2 w-2 border-l-2 border-t-2 rounded-tl-[5px]",
    cursorClassName: "cursor-nw-resize",
    ariaLabelSuffix: "왼쪽 위 모서리",
  },
  {
    direction: "se",
    hitAreaClassName: "right-0 bottom-0 h-3 w-3",
    indicatorClassName: "bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 rounded-br-[5px]",
    cursorClassName: "cursor-se-resize",
    ariaLabelSuffix: "오른쪽 아래 모서리",
  },
  {
    direction: "sw",
    hitAreaClassName: "left-0 bottom-0 h-3 w-3",
    indicatorClassName: "bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 rounded-bl-[5px]",
    cursorClassName: "cursor-sw-resize",
    ariaLabelSuffix: "왼쪽 아래 모서리",
  },
];

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
          headerTitleLayout: layoutPlan.headerTitleLayout ? { ...layoutPlan.headerTitleLayout } : undefined,
          headerSummaryLayout: layoutPlan.headerSummaryLayout ? { ...layoutPlan.headerSummaryLayout } : undefined,
          previewImageDataUrl: layoutPlan.previewImageDataUrl,
          sections: layoutPlan.sections.map((section) => ({
            ...section,
            layout: section.layout ? { ...section.layout } : undefined,
            titleLayout: section.titleLayout ? { ...section.titleLayout } : undefined,
            noteLayout: section.noteLayout ? { ...section.noteLayout } : undefined,
            charts: section.charts?.map((chart) => ({ ...chart, layout: chart.layout ? { ...chart.layout } : undefined })),
            items: section.items?.map((item) => ({ ...item, layout: item.layout ? { ...item.layout } : undefined })),
          })),
        visualPolicy: { ...layoutPlan.visualPolicy },
      }
    : null;
}

function clampPercent(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function applyResizeDelta(origin: LayoutGeometry, deltaX: number, deltaY: number, direction: ResizeHandleDirection): LayoutGeometry {
  let nextX = origin.x;
  let nextY = origin.y;
  let nextWidth = origin.width;
  let nextHeight = origin.height;

  if (direction.includes("w")) {
    nextX = clampPercent(origin.x + deltaX, 0, origin.x + origin.width - MIN_LAYOUT_WIDTH);
    nextWidth = origin.x + origin.width - nextX;
  }

  if (direction.includes("e")) {
    nextWidth = clampPercent(origin.width + deltaX, MIN_LAYOUT_WIDTH, 100 - origin.x);
  }

  if (direction.includes("n")) {
    nextY = clampPercent(origin.y + deltaY, 0, origin.y + origin.height - MIN_LAYOUT_HEIGHT);
    nextHeight = origin.y + origin.height - nextY;
  }

  if (direction.includes("s")) {
    nextHeight = clampPercent(origin.height + deltaY, MIN_LAYOUT_HEIGHT, 100 - origin.y);
  }

  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  };
}

function buildDefaultSectionLayouts(plan: LayoutPlan): Map<string, LayoutGeometry> {
  const editableSections = plan.sections.filter((section) => section.type !== "header");
  if (editableSections.length === 0) {
    return new Map();
  }

  const marginX = 4;
  const topPadding = plan.aspectRatio === "portrait" ? 4 : 3.5;
  const bottomPadding = 4;
  const gap = 3;
  const totalGap = gap * Math.max(editableSections.length - 1, 0);
  const weightedSections = editableSections.map((section) => ({
    section,
    weight: section.type === "chart-group" ? 1.45 : section.type === "kpi-group" ? 1.05 : 0.85,
  }));
  const totalWeight = weightedSections.reduce((sum, entry) => sum + entry.weight, 0);
  const minimumHeights = weightedSections.map(({ section }) => (section.type === "chart-group" ? 18 : section.type === "kpi-group" ? 14 : 12));
  const minimumHeightBudget = minimumHeights.reduce((sum, height) => sum + height, 0);
  const distributableHeight = Math.max(0, 100 - topPadding - bottomPadding - totalGap - minimumHeightBudget);
  let cursorY = topPadding;
  const layouts = new Map<string, LayoutGeometry>();

  weightedSections.forEach(({ section, weight }, index) => {
    const remainingSections = weightedSections.length - index - 1;
    const remainingMinimumHeight = minimumHeights.slice(index + 1).reduce((sum, height) => sum + height, 0);
    const remainingGap = gap * remainingSections;
    const extraHeight = distributableHeight * (weight / Math.max(totalWeight, 1));
    const baseHeight = minimumHeights[index] ?? 12;
    const maxHeight = 100 - bottomPadding - cursorY - remainingMinimumHeight - remainingGap;
    const height = clampPercent(baseHeight + extraHeight, baseHeight, Math.max(baseHeight, maxHeight));
    layouts.set(section.id, {
      x: marginX,
      y: cursorY,
      width: 100 - marginX * 2,
      height,
    });
    cursorY += height + gap;
  });

  return layouts;
}

function buildSectionTitleLayout(section: LayoutSection): LayoutGeometry {
  return section.type === "chart-group" || section.type === "kpi-group"
    ? { x: 0, y: 0, width: 64, height: 12 }
    : { x: 0, y: 0, width: 70, height: 14 };
}

function buildSectionNoteLayout(): LayoutGeometry {
  return { x: 0, y: 18, width: 100, height: 72 };
}

function buildDefaultChartLayouts(chartCount: number, aspectRatio: LayoutPlan["aspectRatio"]): LayoutGeometry[] {
  const y = 16;
  const availableHeight = 82;
  if (chartCount <= 1 || aspectRatio === "portrait") {
    const gap = 3;
    const height = (availableHeight - gap * Math.max(chartCount - 1, 0)) / Math.max(chartCount, 1);
    return Array.from({ length: chartCount }, (_, index) => ({ x: 0, y: y + index * (height + gap), width: 100, height }));
  }

  const columns = 2;
  const rows = Math.ceil(chartCount / columns);
  const gapX = 3;
  const gapY = 3;
  const width = (100 - gapX) / 2;
  const height = (availableHeight - gapY * Math.max(rows - 1, 0)) / Math.max(rows, 1);
  return Array.from({ length: chartCount }, (_, index) => ({
    x: (index % columns) * (width + gapX),
    y: y + Math.floor(index / columns) * (height + gapY),
    width,
    height,
  }));
}

function buildDefaultKpiLayouts(itemCount: number): LayoutGeometry[] {
  const count = Math.max(itemCount, 1);
  const gap = 2.5;
  const width = (100 - gap * Math.max(count - 1, 0)) / count;
  return Array.from({ length: itemCount }, (_, index) => ({
    x: index * (width + gap),
    y: 16,
    width,
    height: 66,
  }));
}

function ensureEditableLayoutPlan(layoutPlan?: LayoutPlan | null): LayoutPlan | null {
  const cloned = cloneLayoutPlan(layoutPlan);
  if (!cloned) return null;

  const previewContext = buildPreviewDataContext(undefined);
  const defaultLayouts = buildDefaultSectionLayouts(cloned);
  cloned.headerTitleLayout = cloned.headerTitleLayout ?? { x: 0, y: 0, width: 72, height: 34 };
  cloned.headerSummaryLayout = cloned.headerSummaryLayout ?? { x: 0, y: 40, width: 72, height: 44 };
  cloned.sections = cloned.sections.map((rawSection) => {
    const section = ensureSectionItems(rawSection, previewContext);
    const chartLayouts = section.charts ? buildDefaultChartLayouts(section.charts.length, cloned.aspectRatio) : [];
    const itemLayouts = section.items ? buildDefaultKpiLayouts(section.items.length) : [];
    return {
      ...section,
      layout: section.type === "header"
        ? section.layout
        : section.layout ?? defaultLayouts.get(section.id),
      titleLayout: section.titleLayout ?? (section.type === "header" ? undefined : buildSectionTitleLayout(section)),
      noteLayout: section.noteLayout ?? (section.type === "takeaway" || section.type === "note" ? buildSectionNoteLayout() : undefined),
      charts: section.charts?.map((chart, chartIndex) => ({
        ...chart,
        layout: chart.layout ?? chartLayouts[chartIndex],
      })),
      items: section.items?.map((item, itemIndex) => ({
        ...item,
        id: item.id || `${section.id}-item-${itemIndex + 1}`,
        layout: item.layout ?? itemLayouts[itemIndex],
      })),
    };
  });

  return cloned;
}

function buildFallbackLayoutPlans(analysisData: AnalysisData | null): LayoutPlan[] {
  if (!analysisData) return [];

  const title = getAnalysisTitle(analysisData, "데이터 요약");
  const firstIssue = getCautions(analysisData)[0]?.text;
  const firstDimension = analysisData.tableData?.columns[0];
  const firstMetric = analysisData.tableData?.columns[1];

  return [
    {
      id: "layout-option-1",
      name: "시안 1",
      description: "메인 비교 차트를 가장 크게 배치한 기본 시안",
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
  ];
}

function resolveLayoutPlans(analysisData: AnalysisData | null): LayoutPlan[] {
  const candidates = analysisData?.generatedLayoutPlans;
  if (candidates && candidates.length > 0) {
    const primaryCandidate = candidates[0];
    return [
      {
        ...primaryCandidate,
        id: primaryCandidate.id || "layout-option-1",
        name: primaryCandidate.name || "시안 1",
        description: primaryCandidate.description || "구성 전략이 반영된 대시보드 시안",
      },
    ];
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
  const [editablePlan, setEditablePlan] = useState<LayoutPlan | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableFieldState | null>(null);
  const attemptedPreviewSignaturesRef = useRef<Record<string, string>>({});
  const previewDataContext = useMemo(() => buildPreviewDataContext(analysisData?.tableData), [analysisData?.tableData]);

  useEffect(() => {
    setPromptDraft(layoutSystemPrompt);
  }, [layoutSystemPrompt]);

  useEffect(() => {
    setEditablePlan(ensureEditableLayoutPlan(selectedPlan));
    setSelectedElementId(null);
    setEditingField(null);
  }, [selectedPlan]);

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

  const persistEditedPlan = useCallback(
    async (nextPlan: LayoutPlan) => {
      const latestSession = sessionId ? await store.getSession(sessionId) : null;
      const latestAnalysisData = latestSession?.analysisData ?? analysisData;
      if (!latestAnalysisData) return;

      const mergedCandidates = resolveLayoutPlans(latestAnalysisData).map((plan) =>
        plan.id === nextPlan.id ? ensureEditableLayoutPlan(nextPlan) ?? nextPlan : plan
      );

      await persistAnalysisData(buildAnalysisWithLayoutCandidates(latestAnalysisData, mergedCandidates, nextPlan.id));
    },
    [analysisData, persistAnalysisData, sessionId]
  );

  const updateEditablePlan = useCallback(
    (updater: (current: LayoutPlan) => LayoutPlan, options?: { persist?: boolean }) => {
      const currentPlan = ensureEditableLayoutPlan(editablePlan ?? selectedPlan);
      if (!currentPlan) return;

      const nextPlan = ensureEditableLayoutPlan(updater(currentPlan));
      if (!nextPlan) return;

      setEditablePlan(nextPlan);
      if (options?.persist) {
        void persistEditedPlan(nextPlan);
      }
    },
    [editablePlan, persistEditedPlan, selectedPlan]
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

        const promptOverride = getVisualizationPrompt(analysisData) || analysisData.infographicPrompt?.trim() || analysisData.generatedInfographicPrompt?.trim();
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
                <p className="mt-1 text-[12px] leading-relaxed text-gray-500">이 프롬프트가 Gemini의 layoutPlan 생성에 직접 들어갑니다. 저장 후 다시 분석하면 새 시안에 반영됩니다.</p>
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
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gray-400">Layout Plan</p>
                <h3 className="mt-1 text-sm font-semibold text-gray-900">AI 레이아웃 시안</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-500">기본값인 HTML 모드에서 layoutPlan과 표 데이터를 합쳐 실제 구조에 가까운 단일 시안을 확인할 수 있습니다. 이미지 모드는 기존 생성 경로를 그대로 사용합니다.</p>
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

            <div className="mt-4 grid gap-4">
              {candidates.map((candidate, index) => {
                const isSelected = selectedPlan.id === candidate.id;
                const isGeneratingPreview = activePreviewId === candidate.id && !candidate.previewImageDataUrl;
                const previewPlan = isSelected ? editablePlan ?? ensureEditableLayoutPlan(candidate) ?? candidate : candidate;
                return (
                  <div
                    key={candidate.id}
                    onClick={() => {
                      void selectCandidate(candidate);
                    }}
                    className={`rounded-[28px] border p-4 text-left transition-all md:p-5 ${
                      isSelected ? "border-slate-300 bg-slate-50 shadow-sm shadow-slate-200/70" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-500">안 {index + 1}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{candidate.name || `시안 ${index + 1}`}</p>
                      </div>
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
                        <LayoutHtmlPreview
                          plan={previewPlan}
                          analysisData={analysisData}
                          previewDataContext={previewDataContext}
                          compact
                          editable={isSelected}
                          selectedElementId={selectedElementId}
                          editingField={editingField}
                          onSelectElement={setSelectedElementId}
                          onStartEditing={(id, value) => {
                            setSelectedElementId(id);
                            setEditingField({ id, value });
                          }}
                          onChangeEditingValue={(value) => setEditingField((current) => (current ? { ...current, value } : current))}
                          onCancelEditing={() => setEditingField(null)}
                          onCommitEditing={(id) => {
                            if (editingField?.id !== id) return;
                            setEditingField(null);
                          }}
                          onPlanChange={updateEditablePlan}
                        />
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
                  </div>
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
        { id: `${section.id}-metric`, label: metricLabel, value: "" },
        { id: `${section.id}-top`, label: "대표 항목", value: "" },
        { id: `${section.id}-rows`, label: "행 수", value: "" },
      ];

  return sourceItems.slice(0, 3).map((item, index) => {
    const normalizedLabel = normalizePreviewKey(item.label);
    const itemId = item.id || `preview-kpi-${index + 1}`;

    if (normalizedLabel.includes("행") || normalizedLabel.includes("row") || normalizedLabel.includes("건수") || normalizedLabel.includes("count")) {
      return { id: itemId, label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    if (normalizedLabel.includes("열") || normalizedLabel.includes("column")) {
      return { id: itemId, label: item.label, value: context.columns.length.toLocaleString("ko-KR"), note: "열 개수" };
    }

    if (normalizedLabel.includes("평균") || normalizedLabel.includes("avg") || normalizedLabel.includes("mean")) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(averageValue), note: `${metricLabel} 평균` };
    }

    if (normalizedLabel.includes("최대") || normalizedLabel.includes("max")) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(sortedItems[0]?.value ?? 0), note: `${context.columns[dimensionIndex] ?? "차원"} 최고값` };
    }

    if (normalizedLabel.includes("대표") || normalizedLabel.includes("1위") || normalizedLabel.includes("top") || normalizedLabel.includes("최고")) {
      return { id: itemId, label: item.label, value: topItem?.label ?? item.value, note: topItem ? `${formatPreviewNumber(topItem.value)} 기준` : "대표 항목" };
    }

    if (index === 0 && metricIndex >= 0) {
      return { id: itemId, label: item.label, value: formatPreviewNumber(totalValue), note: `${metricLabel} 합계` };
    }

    if (index === 1 && topItem) {
      return { id: itemId, label: item.label, value: topItem.label, note: `${formatPreviewNumber(topItem.value)} 기준` };
    }

    if (index === 2) {
      return { id: itemId, label: item.label, value: context.rows.length.toLocaleString("ko-KR"), note: "원본 행 수" };
    }

    return { id: itemId, label: item.label, value: item.value, note: section.title || "핵심 수치" };
  });
}

function buildEditableKpiItems(section: LayoutSection, context: PreviewDataContext): LayoutKpiItem[] {
  return buildPreviewKpis(section, context).map(({ id, label, value }) => ({
    id,
    label: label.trim() || "지표",
    value: value.trim() || "-",
  }));
}

function ensureSectionItems(section: LayoutSection, context: PreviewDataContext): LayoutSection {
  if (section.type !== "kpi-group") {
    return section;
  }

  const nextItems = section.items && section.items.length > 0 ? section.items : buildEditableKpiItems(section, context);
  return {
    ...section,
    items: nextItems,
  };
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
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#0f172a,#475569)]" style={{ width }} />
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-medium text-slate-500">Geo rank</span>
          </div>
        );
      })}
    </div>
  );
}

function HtmlChartCard({
  chart,
  preview,
  compact = false,
  titleContent,
  goalContent,
}: {
  chart: LayoutChartSpec;
  preview: PreparedPreviewChart;
  compact?: boolean;
  titleContent?: React.ReactNode;
  goalContent?: React.ReactNode;
}) {
  return (
    <article className={`rounded-[18px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-slate-900">{titleContent ?? chart.title}</div>
          <div className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{goalContent ?? chart.goal}</div>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-900 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white">
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

function updateSection(plan: LayoutPlan, sectionId: string, updater: (section: LayoutSection) => LayoutSection): LayoutPlan {
  return {
    ...plan,
    sections: plan.sections.map((section) => (section.id === sectionId ? updater(section) : section)),
  };
}

function updateChart(plan: LayoutPlan, sectionId: string, chartId: string, updater: (chart: LayoutChartSpec) => LayoutChartSpec): LayoutPlan {
  return updateSection(plan, sectionId, (section) => ({
    ...section,
    charts: section.charts?.map((chart) => (chart.id === chartId ? updater(chart) : chart)),
  }));
}

function updatePlanLayoutField(plan: LayoutPlan, field: "headerTitleLayout" | "headerSummaryLayout", layout: LayoutGeometry): LayoutPlan {
  return { ...plan, [field]: layout };
}

function updateSectionLayoutField(plan: LayoutPlan, sectionId: string, field: "layout" | "titleLayout" | "noteLayout", layout: LayoutGeometry): LayoutPlan {
  return updateSection(plan, sectionId, (section) => ({ ...section, [field]: layout }));
}

function updateChartLayout(plan: LayoutPlan, sectionId: string, chartId: string, layout: LayoutGeometry): LayoutPlan {
  return updateChart(plan, sectionId, chartId, (chart) => ({ ...chart, layout }));
}

function updateItemLayout(plan: LayoutPlan, sectionId: string, itemId: string, layout: LayoutGeometry): LayoutPlan {
  return updateSection(plan, sectionId, (section) => ({
    ...section,
    items: section.items?.map((item) => (item.id === itemId ? { ...item, layout } : item)),
  }));
}

function isSelectedLayoutElement(selectedElementId: string | null | undefined, ...ids: string[]): boolean {
  return Boolean(selectedElementId && ids.some((id) => id === selectedElementId));
}

function rebuildSectionRegionLayouts(plan: LayoutPlan): LayoutPlan {
  const sectionLayouts = buildDefaultSectionLayouts(plan);
  return {
    ...plan,
    sections: plan.sections.map((section) => (
      section.type === "header"
        ? section
        : {
            ...section,
            layout: sectionLayouts.get(section.id) ?? section.layout,
          }
    )),
  };
}

function resolveSectionTargetIndex(plan: LayoutPlan, sectionId: string, clientY: number, canvasRect?: DOMRect | null): number {
  const sections = plan.sections.filter((section) => section.type !== "header");
  const currentIndex = sections.findIndex((section) => section.id === sectionId);
  if (currentIndex < 0 || !canvasRect || canvasRect.height <= 0) {
    return currentIndex;
  }

  const pointerY = clampPercent(((clientY - canvasRect.top) / canvasRect.height) * 100, 0, 100);
  const nextIndex = sections.findIndex((section) => {
    const layout = section.layout;
    if (!layout) return false;
    return pointerY < layout.y + layout.height / 2;
  });

  return nextIndex >= 0 ? nextIndex : Math.max(sections.length - 1, 0);
}

function reorderSectionIntoRegion(plan: LayoutPlan, sectionId: string, targetIndex: number): LayoutPlan {
  const headerSections = plan.sections.filter((section) => section.type === "header");
  const sections = plan.sections.filter((section) => section.type !== "header");
  const currentIndex = sections.findIndex((section) => section.id === sectionId);
  if (currentIndex < 0) {
    return plan;
  }

  const clampedIndex = Math.min(Math.max(targetIndex, 0), Math.max(sections.length - 1, 0));
  if (currentIndex === clampedIndex) {
    return rebuildSectionRegionLayouts(plan);
  }

  const reorderedSections = sections.slice();
  const [movedSection] = reorderedSections.splice(currentIndex, 1);
  if (!movedSection) {
    return plan;
  }

  reorderedSections.splice(clampedIndex, 0, movedSection);
  return rebuildSectionRegionLayouts({
    ...plan,
    sections: [...headerSections, ...reorderedSections],
  });
}

function useLayoutCanvasSize(ref: React.RefObject<HTMLDivElement | null>): LayoutCanvasSize {
  const [size, setSize] = useState<LayoutCanvasSize>({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function EditableTextSlot({
  id,
  value,
  placeholder,
  editable = false,
  multiline = false,
  selected: _selected = false,
  editingField,
  displayClassName,
  inputClassName,
  onSelect,
  onStartEditing,
  onChange,
  onCancel,
  onCommit,
}: {
  id: string;
  value?: string | null;
  placeholder: string;
  editable?: boolean;
  multiline?: boolean;
  selected?: boolean;
  editingField?: EditableFieldState | null;
  displayClassName: string;
  inputClassName: string;
  onSelect?: (id: string) => void;
  onStartEditing?: (id: string, value: string) => void;
  onChange?: (value: string) => void;
  onCancel?: () => void;
  onCommit?: (id: string, value: string) => void;
}) {
  const isEditing = editable && editingField?.id === id;
  const resolvedValue = typeof value === "string" ? value : "";
  const resolvedInputClassName = `${inputClassName} ${multiline ? "custom-scrollbar resize-none overflow-auto" : ""}`.trim();
  const selected = _selected;

  const startEditing = () => {
    if (!editable) return;
    onSelect?.(id);
    onStartEditing?.(id, resolvedValue);
  };

  if (isEditing) {
    const sharedProps = {
      autoFocus: true,
      value: editingField?.value ?? resolvedValue,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.(event.target.value),
      onBlur: () => onCommit?.(id, editingField?.value ?? resolvedValue),
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel?.();
        }
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          onCommit?.(id, editingField?.value ?? resolvedValue);
        }
        if (multiline && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onCommit?.(id, editingField?.value ?? resolvedValue);
        }
      },
      className: resolvedInputClassName,
    };

    return multiline ? <textarea rows={3} {...sharedProps} /> : <input type="text" {...sharedProps} />;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      className={`block min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words custom-scrollbar ${multiline ? "h-full min-h-0" : ""} ${displayClassName} ${editable ? "rounded-md px-1.5 py-1 transition-colors" : ""} ${selected ? "bg-blue-50/80 text-slate-900 shadow-[0_0_0_2px_rgba(59,130,246,0.35)]" : editable ? "hover:bg-slate-100/80" : ""}`}
    >
      {resolvedValue || <span className="text-slate-300">{placeholder}</span>}
    </button>
  );
}

function LayoutObjectFrame({
  id,
  label,
  layout,
  editable,
  selected = false,
  onSelect,
  onStartInteraction,
  children,
  className = "",
}: {
  id: string;
  label: string;
  layout: LayoutGeometry;
  editable: boolean;
  selected?: boolean;
  onSelect?: (id: string | null) => void;
  onStartInteraction?: (type: "drag" | "resize", event: React.PointerEvent, origin: LayoutGeometry, resizeDirection?: ResizeHandleDirection) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      style={{ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%`, height: `${layout.height}%` }}
      className={`group absolute overflow-visible rounded-[14px] ${selected ? "z-10" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(id);
      }}
    >
      <div className={`absolute inset-0 overflow-hidden rounded-[14px] ${className}`}>{children}</div>
      {editable && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 rounded-[14px] border transition-[border-color,box-shadow] ${selected ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]" : "border-dashed border-slate-300/80 group-hover:border-blue-300/80"}`}
          />
          <button
            type="button"
            aria-label={`${label} 이동`}
            className={`absolute right-1.5 top-1.5 z-20 flex h-5 min-w-[42px] cursor-grab items-center justify-center rounded-full border px-2 text-[9px] font-medium shadow-sm transition-colors ${selected ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect?.(id);
              onStartInteraction?.("drag", event, layout);
            }}
          >
            이동
          </button>
          {RESIZE_HANDLE_DEFINITIONS.map((handle) => (
            <div key={handle.direction}>
              <button
                type="button"
                aria-label={`${label} ${handle.ariaLabelSuffix} 크기 조절`}
                className={`absolute z-20 rounded-[8px] bg-transparent ${handle.hitAreaClassName} ${handle.cursorClassName}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect?.(id);
                  onStartInteraction?.("resize", event, layout, handle.direction);
                }}
              />
              <span
                className={`pointer-events-none absolute z-10 border-blue-400/90 transition-opacity ${handle.indicatorClassName} ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-80"}`}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function HtmlSectionPreview({
  plan,
  section,
  analysisData,
  previewDataContext,
  compact = false,
  editable = false,
  selectedElementId,
  editingField,
  onSelectElement,
  onStartEditing,
  onChangeEditingValue,
  onCancelEditing,
  onCommitEditing,
  onPlanChange,
  onStartLayoutInteraction,
}: {
  plan: LayoutPlan;
  section: LayoutSection;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataContext;
  compact?: boolean;
  editable?: boolean;
  selectedElementId?: string | null;
  editingField?: EditableFieldState | null;
  onSelectElement?: (id: string | null) => void;
  onStartEditing?: (id: string, value: string) => void;
  onChangeEditingValue?: (value: string) => void;
  onCancelEditing?: () => void;
  onCommitEditing?: (id: string, value: string) => void;
  onPlanChange?: (updater: (current: LayoutPlan) => LayoutPlan, options?: { persist?: boolean }) => void;
  onStartLayoutInteraction?: (type: "drag" | "resize", event: React.PointerEvent, origin: LayoutGeometry, apply: (current: LayoutPlan, nextLayout: LayoutGeometry) => LayoutPlan, resizeDirection?: ResizeHandleDirection) => void;
}) {
  if (section.type === "header") {
    return null;
  }

  const titleId = `${section.id}-title`;
  const noteId = `${section.id}-note`;
  const handleCommitSectionTitle = (value: string) => {
    const trimmed = value.trim();
    onPlanChange?.((current) => updateSection(current, section.id, (target) => ({ ...target, title: trimmed || undefined })), { persist: true });
    onCommitEditing?.(titleId, value);
  };

  if (section.type === "chart-group" && section.charts && section.charts.length > 0) {
    const gridClass = section.charts.length === 1 || plan.aspectRatio === "portrait" ? "grid-cols-1" : "grid-cols-2";
    if (editable && section.titleLayout) {
      return (
        <section className="relative h-full">
          <LayoutObjectFrame
            id={titleId}
            label="섹션 제목"
            layout={section.titleLayout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, titleId)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection)}
          >
            <div className="h-full rounded-[14px] bg-white/90 p-2 pt-5">
              <EditableTextSlot
                id={titleId}
                value={section.title || SECTION_TYPE_LABELS[section.type]}
                placeholder={SECTION_TYPE_LABELS[section.type]}
                editable={editable}
                selected={selectedElementId === titleId}
                editingField={editingField}
                displayClassName="w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
                inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
                onSelect={onSelectElement ?? (() => undefined)}
                onStartEditing={onStartEditing}
                onChange={onChangeEditingValue}
                onCancel={onCancelEditing}
                onCommit={handleCommitSectionTitle}
              />
            </div>
          </LayoutObjectFrame>
          {section.charts.map((chart) => {
            const chartTitleId = `${chart.id}-title`;
            const chartGoalId = `${chart.id}-goal`;
            if (!chart.layout) return null;
            return (
              <LayoutObjectFrame
                key={chart.id}
                id={`${chart.id}-card`}
                label="차트 카드"
                layout={chart.layout}
                editable={editable}
                selected={isSelectedLayoutElement(selectedElementId, `${chart.id}-card`, chartTitleId, chartGoalId)}
                onSelect={onSelectElement}
                onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateChartLayout(current, section.id, chart.id, nextLayout), resizeDirection)}
                className="bg-white"
              >
                <div className="h-full rounded-[18px] bg-white p-3 pt-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
                  <HtmlChartCard
                    chart={chart}
                    preview={buildPreparedPreviewChart(chart, previewDataContext)}
                    compact={compact}
                    titleContent={
                      <EditableTextSlot
                        id={chartTitleId}
                        value={chart.title}
                        placeholder="차트 제목"
                        editable={editable}
                        selected={selectedElementId === chartTitleId}
                        editingField={editingField}
                        displayClassName="w-full text-left"
                        inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[12px] font-semibold text-slate-900 outline-none ring-2 ring-blue-100"
                        onSelect={onSelectElement ?? (() => undefined)}
                        onStartEditing={onStartEditing}
                        onChange={onChangeEditingValue}
                        onCancel={onCancelEditing}
                        onCommit={(id, value) => {
                          const trimmed = value.trim() || chart.title;
                          onPlanChange?.((current) => updateChart(current, section.id, chart.id, (target) => ({ ...target, title: trimmed })), { persist: true });
                          onCommitEditing?.(id, value);
                        }}
                      />
                    }
                    goalContent={
                      <EditableTextSlot
                        id={chartGoalId}
                        value={chart.goal}
                        placeholder="차트 설명"
                        editable={editable}
                        multiline
                        selected={selectedElementId === chartGoalId}
                        editingField={editingField}
                        displayClassName="w-full text-left"
                        inputClassName="min-h-[64px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[10.5px] leading-relaxed text-slate-500 outline-none ring-2 ring-blue-100"
                        onSelect={onSelectElement ?? (() => undefined)}
                        onStartEditing={onStartEditing}
                        onChange={onChangeEditingValue}
                        onCancel={onCancelEditing}
                        onCommit={(id, value) => {
                          const trimmed = value.trim() || chart.goal;
                          onPlanChange?.((current) => updateChart(current, section.id, chart.id, (target) => ({ ...target, goal: trimmed })), { persist: true });
                          onCommitEditing?.(id, value);
                        }}
                      />
                    }
                  />
                </div>
              </LayoutObjectFrame>
            );
          })}
        </section>
      );
    }
    return (
      <section className="space-y-2.5 h-full">
        <div className="flex items-center justify-between gap-2">
          <EditableTextSlot
            id={titleId}
            value={section.title || SECTION_TYPE_LABELS[section.type]}
            placeholder={SECTION_TYPE_LABELS[section.type]}
            editable={editable}
            selected={selectedElementId === titleId}
            editingField={editingField}
            displayClassName="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
            inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
            onSelect={onSelectElement ?? (() => undefined)}
            onStartEditing={onStartEditing}
            onChange={onChangeEditingValue}
            onCancel={onCancelEditing}
            onCommit={handleCommitSectionTitle}
          />
          <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{section.charts.length} charts</span>
        </div>
        <div className={`grid gap-2.5 ${gridClass}`}>
          {section.charts.map((chart) => {
            const chartTitleId = `${chart.id}-title`;
            const chartGoalId = `${chart.id}-goal`;
            return (
              <HtmlChartCard
                key={chart.id}
                chart={chart}
                preview={buildPreparedPreviewChart(chart, previewDataContext)}
                compact={compact}
                titleContent={
                  <EditableTextSlot
                    id={chartTitleId}
                    value={chart.title}
                    placeholder="차트 제목"
                    editable={editable}
                    selected={selectedElementId === chartTitleId}
                    editingField={editingField}
                    displayClassName="w-full text-left"
                    inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[12px] font-semibold text-slate-900 outline-none ring-2 ring-blue-100"
                    onSelect={onSelectElement ?? (() => undefined)}
                    onStartEditing={onStartEditing}
                    onChange={onChangeEditingValue}
                    onCancel={onCancelEditing}
                    onCommit={(id, value) => {
                      const trimmed = value.trim() || chart.title;
                      onPlanChange?.((current) => updateChart(current, section.id, chart.id, (target) => ({ ...target, title: trimmed })), { persist: true });
                      onCommitEditing?.(id, value);
                    }}
                  />
                }
                goalContent={
                  <EditableTextSlot
                    id={chartGoalId}
                    value={chart.goal}
                    placeholder="차트 설명"
                    editable={editable}
                    multiline
                    selected={selectedElementId === chartGoalId}
                    editingField={editingField}
                    displayClassName="w-full text-left"
                    inputClassName="min-h-[64px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[10.5px] leading-relaxed text-slate-500 outline-none ring-2 ring-blue-100"
                    onSelect={onSelectElement ?? (() => undefined)}
                    onStartEditing={onStartEditing}
                    onChange={onChangeEditingValue}
                    onCancel={onCancelEditing}
                    onCommit={(id, value) => {
                      const trimmed = value.trim() || chart.goal;
                      onPlanChange?.((current) => updateChart(current, section.id, chart.id, (target) => ({ ...target, goal: trimmed })), { persist: true });
                      onCommitEditing?.(id, value);
                    }}
                  />
                }
              />
            );
          })}
        </div>
      </section>
    );
  }

  if (section.type === "kpi-group") {
    const kpis = buildPreviewKpis(section, previewDataContext);
    if (editable && section.titleLayout) {
      return (
        <section className="relative h-full">
          <LayoutObjectFrame
            id={titleId}
            label="섹션 제목"
            layout={section.titleLayout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, titleId)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection)}
          >
            <div className="h-full rounded-[14px] bg-white/90 p-2 pt-5">
              <EditableTextSlot
                id={titleId}
                value={section.title || SECTION_TYPE_LABELS[section.type]}
                placeholder={SECTION_TYPE_LABELS[section.type]}
                editable={editable}
                selected={selectedElementId === titleId}
                editingField={editingField}
                displayClassName="w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
                inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
                onSelect={onSelectElement ?? (() => undefined)}
                onStartEditing={onStartEditing}
                onChange={onChangeEditingValue}
                onCancel={onCancelEditing}
                onCommit={handleCommitSectionTitle}
              />
            </div>
          </LayoutObjectFrame>
          {kpis.map((item) => {
            const labelId = `${item.id}-label`;
            const valueId = `${item.id}-value`;
            const itemLayout = section.items?.find((candidate) => candidate.id === item.id)?.layout;
            if (!itemLayout) return null;
            return (
              <LayoutObjectFrame
                key={item.id}
                id={`${item.id}-card`}
                label="KPI 카드"
                layout={itemLayout}
                editable={editable}
                selected={isSelectedLayoutElement(selectedElementId, `${item.id}-card`, labelId, valueId)}
                onSelect={onSelectElement}
                onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateItemLayout(current, section.id, item.id, nextLayout), resizeDirection)}
                className="bg-white"
              >
                <div className="h-full rounded-[16px] border border-slate-200 bg-white px-3 pb-3.5 pt-5 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
                  <EditableTextSlot
                    id={labelId}
                    value={item.label}
                    placeholder="지표 라벨"
                    editable={editable}
                    selected={selectedElementId === labelId}
                    editingField={editingField}
                    displayClassName="w-full text-[10px] font-medium text-slate-500 text-left"
                    inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 outline-none ring-2 ring-blue-100"
                    onSelect={onSelectElement ?? (() => undefined)}
                    onStartEditing={onStartEditing}
                    onChange={onChangeEditingValue}
                    onCancel={onCancelEditing}
                    onCommit={(id, value) => {
                      const trimmed = value.trim() || item.label;
                      onPlanChange?.((current) => updateSection(current, section.id, (target) => {
                        const baseItems = target.items && target.items.length > 0 ? target.items : buildEditableKpiItems(target, previewDataContext);
                        return { ...target, items: baseItems.map((baseItem) => (baseItem.id === item.id ? { ...baseItem, label: trimmed } : baseItem)) };
                      }), { persist: true });
                      onCommitEditing?.(id, value);
                    }}
                  />
                  <EditableTextSlot
                    id={valueId}
                    value={item.value}
                    placeholder="값"
                    editable={editable}
                    selected={selectedElementId === valueId}
                    editingField={editingField}
                    displayClassName="mt-2 w-full text-[15px] font-bold tracking-[-0.03em] text-slate-900 text-left"
                    inputClassName="mt-2 w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[15px] font-bold tracking-[-0.03em] text-slate-900 outline-none ring-2 ring-blue-100"
                    onSelect={onSelectElement ?? (() => undefined)}
                    onStartEditing={onStartEditing}
                    onChange={onChangeEditingValue}
                    onCancel={onCancelEditing}
                    onCommit={(id, value) => {
                      const trimmed = value.trim() || item.value.trim() || "-";
                      onPlanChange?.((current) => updateSection(current, section.id, (target) => {
                        const baseItems = target.items && target.items.length > 0 ? target.items : buildEditableKpiItems(target, previewDataContext);
                        return { ...target, items: baseItems.map((baseItem) => (baseItem.id === item.id ? { ...baseItem, value: trimmed } : baseItem)) };
                      }), { persist: true });
                      onCommitEditing?.(id, value);
                    }}
                  />
                  <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{item.note}</p>
                </div>
              </LayoutObjectFrame>
            );
          })}
        </section>
      );
    }
    return (
      <section className="space-y-2.5 h-full">
        <div className="flex items-center justify-between gap-2">
          <EditableTextSlot
            id={titleId}
            value={section.title || SECTION_TYPE_LABELS[section.type]}
            placeholder={SECTION_TYPE_LABELS[section.type]}
            editable={editable}
            selected={selectedElementId === titleId}
            editingField={editingField}
            displayClassName="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
            inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
            onSelect={onSelectElement ?? (() => undefined)}
            onStartEditing={onStartEditing}
            onChange={onChangeEditingValue}
            onCancel={onCancelEditing}
            onCommit={handleCommitSectionTitle}
          />
          <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{kpis.length} metrics</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {kpis.map((item) => {
            const labelId = `${item.id}-label`;
            const valueId = `${item.id}-value`;
            return (
              <div key={item.id} className={`rounded-[16px] border border-slate-200 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.05)] ${compact ? "px-2.5 py-3" : "px-3 py-3.5"}`}>
                <EditableTextSlot
                  id={labelId}
                  value={item.label}
                  placeholder="지표 라벨"
                  editable={editable}
                  selected={selectedElementId === labelId}
                  editingField={editingField}
                  displayClassName="w-full text-[10px] font-medium text-slate-500 text-left"
                  inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 outline-none ring-2 ring-blue-100"
                  onSelect={onSelectElement ?? (() => undefined)}
                  onStartEditing={onStartEditing}
                  onChange={onChangeEditingValue}
                  onCancel={onCancelEditing}
                  onCommit={(id, value) => {
                    const trimmed = value.trim() || item.label;
                    onPlanChange?.(
                      (current) => updateSection(current, section.id, (target) => {
                        const baseItems = target.items && target.items.length > 0 ? target.items : buildEditableKpiItems(target, previewDataContext);
                        return {
                          ...target,
                          items: baseItems.map((baseItem) => (baseItem.id === item.id ? { ...baseItem, label: trimmed } : baseItem)),
                        };
                      }),
                      { persist: true }
                    );
                    onCommitEditing?.(id, value);
                  }}
                />
                <EditableTextSlot
                  id={valueId}
                  value={item.value}
                  placeholder="값"
                  editable={editable}
                  selected={selectedElementId === valueId}
                  editingField={editingField}
                  displayClassName="mt-2 w-full text-[15px] font-bold tracking-[-0.03em] text-slate-900 text-left"
                  inputClassName="mt-2 w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[15px] font-bold tracking-[-0.03em] text-slate-900 outline-none ring-2 ring-blue-100"
                  onSelect={onSelectElement ?? (() => undefined)}
                  onStartEditing={onStartEditing}
                  onChange={onChangeEditingValue}
                  onCancel={onCancelEditing}
                  onCommit={(id, value) => {
                    const trimmed = value.trim() || item.value.trim() || "-";
                    onPlanChange?.(
                      (current) => updateSection(current, section.id, (target) => {
                        const baseItems = target.items && target.items.length > 0 ? target.items : buildEditableKpiItems(target, previewDataContext);
                        return {
                          ...target,
                          items: baseItems.map((baseItem) => (baseItem.id === item.id ? { ...baseItem, value: trimmed } : baseItem)),
                        };
                      }),
                      { persist: true }
                    );
                    onCommitEditing?.(id, value);
                  }}
                />
                <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{item.note}</p>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const noteText =
    section.note ||
    getFindings(analysisData)[0]?.text ||
    getCautions(analysisData)[0]?.text ||
    getLegacyKeywordFallback(analysisData).slice(0, 3).join(" · ") ||
    "핵심 시사점을 짧게 요약하는 영역";

  return (
    editable && section.titleLayout && section.noteLayout ? (
      <section className="relative h-full">
        <LayoutObjectFrame
          id={titleId}
          label="섹션 제목"
          layout={section.titleLayout}
          editable={editable}
          selected={isSelectedLayoutElement(selectedElementId, titleId)}
          onSelect={onSelectElement}
          onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection)}
        >
          <div className="h-full rounded-[14px] bg-white/90 p-2 pt-5">
            <EditableTextSlot
              id={titleId}
              value={section.title || SECTION_TYPE_LABELS[section.type]}
              placeholder={SECTION_TYPE_LABELS[section.type]}
              editable={editable}
              selected={selectedElementId === titleId}
              editingField={editingField}
              displayClassName="w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
              inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
              onSelect={onSelectElement ?? (() => undefined)}
              onStartEditing={onStartEditing}
              onChange={onChangeEditingValue}
              onCancel={onCancelEditing}
              onCommit={handleCommitSectionTitle}
            />
          </div>
        </LayoutObjectFrame>
        <LayoutObjectFrame
          id={noteId}
          label="설명 블록"
          layout={section.noteLayout}
          editable={editable}
          selected={isSelectedLayoutElement(selectedElementId, noteId)}
          onSelect={onSelectElement}
          onStartInteraction={(type, event, origin, resizeDirection) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "noteLayout", nextLayout), resizeDirection)}
        >
          <div className="h-full rounded-[18px] border border-slate-200/80 bg-white px-3 pb-3 pt-5 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
            <EditableTextSlot
              id={noteId}
              value={noteText}
              placeholder="설명 텍스트"
              editable={editable}
              multiline
              selected={selectedElementId === noteId}
              editingField={editingField}
              displayClassName="w-full text-[11px] leading-relaxed text-slate-600 text-left"
              inputClassName="min-h-[88px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
              onSelect={onSelectElement ?? (() => undefined)}
              onStartEditing={onStartEditing}
              onChange={onChangeEditingValue}
              onCancel={onCancelEditing}
              onCommit={(id, value) => {
                const trimmed = value.trim();
                onPlanChange?.((current) => updateSection(current, section.id, (target) => ({ ...target, note: trimmed || undefined })), { persist: true });
                onCommitEditing?.(id, value);
              }}
            />
          </div>
        </LayoutObjectFrame>
      </section>
    ) : <section className="rounded-[18px] border border-slate-200/80 bg-white px-3 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.05)] h-full">
      <div className="flex items-center justify-between gap-2">
        <EditableTextSlot
          id={titleId}
          value={section.title || SECTION_TYPE_LABELS[section.type]}
          placeholder={SECTION_TYPE_LABELS[section.type]}
          editable={editable}
          selected={selectedElementId === titleId}
          editingField={editingField}
          displayClassName="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
          inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
          onSelect={onSelectElement ?? (() => undefined)}
          onStartEditing={onStartEditing}
          onChange={onChangeEditingValue}
          onCancel={onCancelEditing}
          onCommit={handleCommitSectionTitle}
        />
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-500">{SECTION_TYPE_LABELS[section.type]}</span>
      </div>
      <EditableTextSlot
        id={noteId}
        value={noteText}
        placeholder="설명 텍스트"
        editable={editable}
        multiline
        selected={selectedElementId === noteId}
        editingField={editingField}
        displayClassName="mt-2 w-full text-[11px] leading-relaxed text-slate-600 text-left"
        inputClassName="mt-2 min-h-[88px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
        onSelect={onSelectElement ?? (() => undefined)}
        onStartEditing={onStartEditing}
        onChange={onChangeEditingValue}
        onCancel={onCancelEditing}
        onCommit={(id, value) => {
          const trimmed = value.trim();
          onPlanChange?.((current) => updateSection(current, section.id, (target) => ({ ...target, note: trimmed || undefined })), { persist: true });
          onCommitEditing?.(id, value);
        }}
      />
    </section>
  );
}

function LayoutHtmlPreview({
  plan,
  analysisData,
  previewDataContext,
  compact = false,
  editable = false,
  selectedElementId,
  editingField,
  onSelectElement,
  onStartEditing,
  onChangeEditingValue,
  onCancelEditing,
  onCommitEditing,
  onPlanChange,
}: {
  plan: LayoutPlan;
  analysisData: AnalysisData | null;
  previewDataContext: PreviewDataContext;
  compact?: boolean;
  editable?: boolean;
  selectedElementId?: string | null;
  editingField?: EditableFieldState | null;
  onSelectElement?: (id: string | null) => void;
  onStartEditing?: (id: string, value: string) => void;
  onChangeEditingValue?: (value: string) => void;
  onCancelEditing?: () => void;
  onCommitEditing?: (id: string, value: string) => void;
  onPlanChange?: (updater: (current: LayoutPlan) => LayoutPlan, options?: { persist?: boolean }) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasSize = useLayoutCanvasSize(canvasRef);
  const [activeInteraction, setActiveInteraction] = useState<ActiveLayoutInteraction | null>(null);
  const headerSection = plan.sections.find((section) => section.type === "header");
  const title = headerSection?.title || plan.name || getAnalysisTitle(analysisData, "데이터 레이아웃");
  const summaryText =
    plan.description ||
    getFindings(analysisData)[0]?.text ||
    getCautions(analysisData)[0]?.text ||
    getLegacyKeywordFallback(analysisData).slice(0, 3).join(" · ") ||
    "표 데이터를 기반으로 재구성한 레이아웃 미리보기";

  useEffect(() => {
    if (!activeInteraction || !editable || !onPlanChange || canvasSize.width <= 0 || canvasSize.height <= 0) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (activeInteraction.type === "section-reorder" || !activeInteraction.origin || !activeInteraction.apply) {
        return;
      }

      const { origin, apply } = activeInteraction;

      const deltaX = ((event.clientX - activeInteraction.startClientX) / canvasSize.width) * 100;
      const deltaY = ((event.clientY - activeInteraction.startClientY) / canvasSize.height) * 100;
      const nextLayout =
        activeInteraction.type === "drag"
          ? {
              ...origin,
              x: clampPercent(origin.x + deltaX, 0, 100 - origin.width),
              y: clampPercent(origin.y + deltaY, 0, 100 - origin.height),
            }
          : applyResizeDelta(origin, deltaX, deltaY, activeInteraction.resizeDirection ?? "se");

      onPlanChange((current) => apply(current, nextLayout));
    };

    const finishInteraction = (event: PointerEvent) => {
      if (activeInteraction.type === "section-reorder") {
        const sectionId = activeInteraction.sectionId;
        if (sectionId) {
          onPlanChange(
            (current) => reorderSectionIntoRegion(
              current,
              sectionId,
              resolveSectionTargetIndex(current, sectionId, event.clientY, canvasRef.current?.getBoundingClientRect())
            ),
            { persist: true }
          );
        }
        setActiveInteraction(null);
        return;
      }

      if (!activeInteraction.origin || !activeInteraction.apply) {
        setActiveInteraction(null);
        return;
      }

      const { origin, apply } = activeInteraction;

      const deltaX = ((event.clientX - activeInteraction.startClientX) / canvasSize.width) * 100;
      const deltaY = ((event.clientY - activeInteraction.startClientY) / canvasSize.height) * 100;
      const nextLayout =
        activeInteraction.type === "drag"
          ? {
              ...origin,
              x: clampPercent(origin.x + deltaX, 0, 100 - origin.width),
              y: clampPercent(origin.y + deltaY, 0, 100 - origin.height),
            }
          : applyResizeDelta(origin, deltaX, deltaY, activeInteraction.resizeDirection ?? "se");

      onPlanChange((current) => apply(current, nextLayout), { persist: true });
      setActiveInteraction(null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishInteraction(event);
    };

    const handlePointerCancel = () => {
      if (activeInteraction?.type === "section-reorder") {
        setActiveInteraction(null);
        return;
      }

      setActiveInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerCancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activeInteraction, canvasSize.height, canvasSize.width, editable, onPlanChange]);

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.95)_0%,rgba(255,255,255,1)_58%,rgba(241,245,249,1)_100%)] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Deterministic HTML Preview</p>
            {editable && plan.headerTitleLayout && plan.headerSummaryLayout ? (
              <div className="relative mt-1 h-[94px]">
                <LayoutObjectFrame
                  id={`${plan.id}-header-title`}
                  label="제목"
                  layout={plan.headerTitleLayout}
                  editable={editable}
                  selected={isSelectedLayoutElement(selectedElementId, `${plan.id}-header-title`)}
                  onSelect={onSelectElement}
                  onStartInteraction={(type, event, origin, resizeDirection) => setActiveInteraction({
                    type,
                    origin,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    resizeDirection,
                    apply: (current: LayoutPlan, nextLayout: LayoutGeometry) => updatePlanLayoutField(current, "headerTitleLayout", nextLayout),
                  })}
                >
                  <div className="h-full rounded-[14px] bg-white/80 p-2 pt-5">
                    <EditableTextSlot
                      id={`${plan.id}-header-title`}
                      value={title}
                      placeholder="레이아웃 제목"
                      editable={editable}
                      selected={selectedElementId === `${plan.id}-header-title`}
                      editingField={editingField}
                      displayClassName="w-full text-left text-[18px] font-bold tracking-[-0.04em] text-slate-900"
                      inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[18px] font-bold tracking-[-0.04em] text-slate-900 outline-none ring-2 ring-blue-100"
                      onSelect={onSelectElement ?? (() => undefined)}
                      onStartEditing={onStartEditing}
                      onChange={onChangeEditingValue}
                      onCancel={onCancelEditing}
                      onCommit={(id, value) => {
                        const trimmed = value.trim();
                        onPlanChange?.((current) => {
                          const currentHeader = current.sections.find((section) => section.type === "header");
                          if (currentHeader) {
                            return updateSection(current, currentHeader.id, (section) => ({ ...section, title: trimmed || undefined }));
                          }
                          return { ...current, name: trimmed || current.name };
                        }, { persist: true });
                        onCommitEditing?.(id, value);
                      }}
                    />
                  </div>
                </LayoutObjectFrame>
                <LayoutObjectFrame
                  id={`${plan.id}-header-summary`}
                  label="설명"
                  layout={plan.headerSummaryLayout}
                  editable={editable}
                  selected={isSelectedLayoutElement(selectedElementId, `${plan.id}-header-summary`)}
                  onSelect={onSelectElement}
                  onStartInteraction={(type, event, origin, resizeDirection) => setActiveInteraction({
                    type,
                    origin,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    resizeDirection,
                    apply: (current: LayoutPlan, nextLayout: LayoutGeometry) => updatePlanLayoutField(current, "headerSummaryLayout", nextLayout),
                  })}
                >
                  <div className="h-full rounded-[14px] bg-white/70 p-2 pt-5">
                    <EditableTextSlot
                      id={`${plan.id}-header-summary`}
                      value={summaryText}
                      placeholder="레이아웃 설명"
                      editable={editable}
                      multiline
                      selected={selectedElementId === `${plan.id}-header-summary`}
                      editingField={editingField}
                      displayClassName="w-full text-left text-[11px] leading-relaxed text-slate-500"
                      inputClassName="min-h-[74px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
                      onSelect={onSelectElement ?? (() => undefined)}
                      onStartEditing={onStartEditing}
                      onChange={onChangeEditingValue}
                      onCancel={onCancelEditing}
                      onCommit={(id, value) => {
                        onPlanChange?.((current) => ({ ...current, description: value.trim() || undefined }), { persist: true });
                        onCommitEditing?.(id, value);
                      }}
                    />
                  </div>
                </LayoutObjectFrame>
              </div>
            ) : (
              <>
                <EditableTextSlot
                  id={`${plan.id}-header-title`}
                  value={title}
                  placeholder="레이아웃 제목"
                  editable={editable}
                  selected={selectedElementId === `${plan.id}-header-title`}
                  editingField={editingField}
                  displayClassName="mt-1 w-full text-left text-[18px] font-bold tracking-[-0.04em] text-slate-900"
                  inputClassName="mt-1 w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[18px] font-bold tracking-[-0.04em] text-slate-900 outline-none ring-2 ring-blue-100"
                  onSelect={onSelectElement ?? (() => undefined)}
                  onStartEditing={onStartEditing}
                  onChange={onChangeEditingValue}
                  onCancel={onCancelEditing}
                  onCommit={(id, value) => {
                    const trimmed = value.trim();
                    onPlanChange?.((current) => {
                      const currentHeader = current.sections.find((section) => section.type === "header");
                      if (currentHeader) {
                        return updateSection(current, currentHeader.id, (section) => ({ ...section, title: trimmed || undefined }));
                      }
                      return { ...current, name: trimmed || current.name };
                    }, { persist: true });
                    onCommitEditing?.(id, value);
                  }}
                />
                <EditableTextSlot
                  id={`${plan.id}-header-summary`}
                  value={summaryText}
                  placeholder="레이아웃 설명"
                  editable={editable}
                  multiline
                  selected={selectedElementId === `${plan.id}-header-summary`}
                  editingField={editingField}
                  displayClassName="mt-2 w-full text-left text-[11px] leading-relaxed text-slate-500"
                  inputClassName="mt-2 min-h-[74px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
                  onSelect={onSelectElement ?? (() => undefined)}
                  onStartEditing={onStartEditing}
                  onChange={onChangeEditingValue}
                  onCancel={onCancelEditing}
                  onCommit={(id, value) => {
                    onPlanChange?.((current) => ({ ...current, description: value.trim() || undefined }), { persist: true });
                    onCommitEditing?.(id, value);
                  }}
                />
              </>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-900 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white">{plan.aspectRatio}</span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[9px] font-medium text-slate-500">{previewDataContext.rows.length.toLocaleString("ko-KR")} rows</span>
          </div>
        </div>
      </div>
      {editable && (
        <div className="border-t border-slate-200/80 bg-blue-50/70 px-4 py-2.5 text-[10px] leading-relaxed text-blue-700">
          파란 테두리는 현재 선택된 박스입니다. 이동 버튼으로 위치를 옮기고, 가장자리나 모서리를 드래그해서 크기를 조절할 수 있습니다.
        </div>
      )}

      <div className={`bg-[radial-gradient(circle_at_top_left,rgba(226,232,240,0.7),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] ${compact ? "p-3" : "p-4"}`} style={{ aspectRatio: PREVIEW_ASPECT_RATIOS[plan.aspectRatio] }}>
        <div ref={canvasRef} className={`relative h-full overflow-hidden rounded-[18px] ${editable ? "border border-dashed border-slate-200/80 bg-white/45" : ""}`}>
          {editable ? (
            plan.sections.filter((section) => section.type !== "header").map((section) => {
              const layout = section.layout;
              if (!layout) return null;
              const sectionId = `${section.id}-frame`;
              const isDraggingSection = activeInteraction?.type === "section-reorder" && activeInteraction.sectionId === section.id;
              const isSelectedSection = isSelectedLayoutElement(selectedElementId, sectionId);
              return (
                <div
                  key={section.id}
                  style={{ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%`, height: `${layout.height}%` }}
                  className={`group absolute overflow-hidden rounded-[20px] p-2 transition-shadow ${isDraggingSection || isSelectedSection ? "z-10" : ""} ${isDraggingSection ? "shadow-[0_18px_36px_rgba(15,23,42,0.12)]" : "shadow-[0_12px_28px_rgba(15,23,42,0.08)]"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectElement?.(sectionId);
                  }}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 rounded-[20px] border transition-[border-color,box-shadow] ${isSelectedSection ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.16)]" : "border-transparent group-hover:border-blue-200/80"}`}
                  />
                  <button
                    type="button"
                    aria-label={`${section.title || SECTION_TYPE_LABELS[section.type]} 영역 이동`}
                    className={`absolute left-1/2 top-3 z-20 flex h-5 min-w-[76px] -translate-x-1/2 cursor-grab items-center justify-center rounded-full border px-2 text-[9px] font-medium shadow-sm transition-colors ${isSelectedSection ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white/95 text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectElement?.(sectionId);
                      setActiveInteraction({
                        type: "section-reorder",
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        sectionId: section.id,
                      });
                    }}
                  >
                    영역 이동
                  </button>
                  <div className="h-full overflow-auto rounded-[18px] bg-white/88 p-3 pt-7 custom-scrollbar">
                    <HtmlSectionPreview
                      plan={plan}
                      section={section}
                      analysisData={analysisData}
                      previewDataContext={previewDataContext}
                      compact={compact}
                      editable={editable}
                      selectedElementId={selectedElementId}
                      editingField={editingField}
                      onSelectElement={onSelectElement}
                      onStartEditing={onStartEditing}
                      onChangeEditingValue={onChangeEditingValue}
                      onCancelEditing={onCancelEditing}
                      onCommitEditing={onCommitEditing}
                      onPlanChange={onPlanChange}
                      onStartLayoutInteraction={(type, event, origin, apply, resizeDirection) => {
                        setActiveInteraction({
                          type,
                          origin,
                          startClientX: event.clientX,
                          startClientY: event.clientY,
                          resizeDirection,
                          apply,
                        });
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex h-full flex-col gap-2.5 overflow-hidden">
              {plan.sections.map((section) => (
                <HtmlSectionPreview
                  key={section.id}
                  plan={plan}
                  section={section}
                  analysisData={analysisData}
                  previewDataContext={previewDataContext}
                  compact={compact}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VisualDraftBoard({ plan, analysisData, compact = false }: { plan: LayoutPlan; analysisData: AnalysisData | null; compact?: boolean }) {
  const title = getAnalysisTitle(analysisData, plan.sections.find((section) => section.type === "header")?.title || "인포그래픽 시안");
  const summaryText = getFindings(analysisData)[0]?.text || getLegacyKeywordFallback(analysisData).slice(0, 3).join(" · ") || "핵심 비교 포인트가 먼저 보이는 구조";

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
