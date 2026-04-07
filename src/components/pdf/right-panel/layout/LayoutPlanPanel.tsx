"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PieController,
  PointElement,
  Tooltip,
} from "chart.js";
import { GripVertical } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { getAnalysisTitle, getFindings, getLegacyKeywordFallback, getSourceTables } from "@/lib/analysis-selectors";
import { DEFAULT_LAYOUT_IMAGE_PROMPT } from "@/lib/layout-image-prompts";
import { store } from "@/lib/store";
import type {
  AnalysisData,
  LayoutBlock,
  LayoutBlockTree,
  LayoutChartBlock,
  LayoutChartSpec,
  LayoutGeometry,
  LayoutGroupBlock,
  LayoutHeadingBlock,
  LayoutPlan,
  LayoutSection,
  LayoutSectionType,
  LayoutTextBlock,
} from "@/lib/session-types";
import { buildLayoutTreeFromPlan, projectLayoutPlanFromTree, reorderLayoutTreeRoots, updateLayoutTreeBlock } from "./layout-tree";
import {
  PREVIEW_ASPECT_RATIOS,
  buildEditableKpiItems,
  buildPreparedPreviewChart,
  buildPreviewChartConfig,
  buildPreviewDataRegistry,
  buildPreviewKpis,
  formatPreviewNumber,
  resolveKpiNoteForBlock,
  type PreparedPreviewChart,
  type PreviewCanvasType,
  type PreviewDataRegistry,
} from "./layout-preview-data";
import { LayoutPlanPreviewSection } from "./LayoutPlanPreviewSection";
import { LayoutPlanTopSection } from "./LayoutPlanTopSection";
import { buildAnalysisWithSingleLayoutPlan, resolveSelectedLayoutPlan } from "./selection";
import { useLayoutPlanPreviewImage } from "./useLayoutPlanPreviewImage";

const SECTION_TYPE_LABELS: Record<LayoutSectionType, string> = {
  header: "헤더",
  "chart-group": "차트 그룹",
  "kpi-group": "KPI 그룹",
  takeaway: "결론",
  note: "노트",
};

type NormalizedSectionRole = "HOOK" | "EVIDENCE" | "CONTEXT" | "CONCLUSION";

function normalizeSectionRole(role?: string | null): NormalizedSectionRole | undefined {
  const normalized = role?.trim().toUpperCase();
  if (normalized === "HOOK" || normalized === "EVIDENCE" || normalized === "CONTEXT" || normalized === "CONCLUSION") {
    return normalized;
  }
  return undefined;
}

function getSectionRolePresentation(role?: string | null) {
  const normalized = normalizeSectionRole(role);
  switch (normalized) {
    case "HOOK":
      return {
        normalized,
        label: "HOOK",
        hint: "즉시 핵심을 전달하는 리드 섹션",
        badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
      };
    case "EVIDENCE":
      return {
        normalized,
        label: "EVIDENCE",
        hint: "주장을 뒷받침하는 근거 섹션",
        badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-700",
      };
    case "CONTEXT":
      return {
        normalized,
        label: "CONTEXT",
        hint: "배경과 맥락을 보강하는 섹션",
        badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "CONCLUSION":
      return {
        normalized,
        label: "CONCLUSION",
        hint: "요약과 제안을 마무리하는 섹션",
        badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
      };
    default:
      return undefined;
  }
}

function getSectionDisplayTitle(section: LayoutSection): string {
  return section.title || SECTION_TYPE_LABELS[section.type];
}

function getSectionTitlePlaceholder(section: LayoutSection): string {
  const rolePresentation = getSectionRolePresentation(section.sectionRole);
  return rolePresentation ? `${SECTION_TYPE_LABELS[section.type]} · ${rolePresentation.label}` : SECTION_TYPE_LABELS[section.type];
}

function getLayoutIntentPresentation(layoutIntent?: string | null) {
  const normalized = layoutIntent?.trim();
  return normalized ? `Intent · ${normalized}` : undefined;
}

function SectionRoleBadge({ role, compact = false }: { role?: string | null; compact?: boolean }) {
  const presentation = getSectionRolePresentation(role);
  if (!presentation) return null;
  return (
    <span
      className={`rounded-full border px-2 py-1 font-semibold uppercase tracking-[0.12em] ${compact ? "text-[8px]" : "text-[9px]"} ${presentation.badgeClassName}`}
      title={presentation.hint}
    >
      {presentation.label}
    </span>
  );
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
  surfaceWidth?: number;
  surfaceHeight?: number;
  groupBlockId?: string;
  resizeDirection?: ResizeHandleDirection;
  apply?: (current: LayoutPlan, nextLayout: LayoutGeometry) => LayoutPlan;
}

interface EditableFieldState {
  id: string;
  value: string;
}

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
  onRegenerateLayoutImages?: (imagePromptOverride: string) => Promise<void>;
}

function cloneLayoutPlan(layoutPlan?: LayoutPlan | null): LayoutPlan | null {
  return layoutPlan
      ? {
          ...layoutPlan,
          layoutTree: layoutPlan.layoutTree ? structuredClone(layoutPlan.layoutTree) as LayoutBlockTree : undefined,
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

function resolveInteractionSurfaceMetrics(target: EventTarget | null): { width: number; height: number } | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const frame = target.closest<HTMLElement>("[data-layout-frame='true']");
  const surface = frame?.parentElement;
  if (!surface) {
    return null;
  }

  return {
    width: surface.clientWidth,
    height: surface.clientHeight,
  };
}

function isSameLayout(left: LayoutGeometry | undefined, right: LayoutGeometry): boolean {
  if (!left) {
    return false;
  }

  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function buildFallbackLayoutPlan(analysisData: AnalysisData | null): LayoutPlan | null {
  if (!analysisData) return null;

  const title = getAnalysisTitle(analysisData, "데이터 요약");
  const firstDimension = analysisData.tableData?.columns[0];
  const firstMetric = analysisData.tableData?.columns[1];

  return {
    id: "layout-option-1",
    name: "시안",
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
    ],
    visualPolicy: { textRatio: 0.15, chartRatio: 0.75, iconRatio: 0.1 },
  };
}

function resolveLayoutPlan(analysisData: AnalysisData | null): LayoutPlan | null {
  const activePlan = resolveSelectedLayoutPlan(analysisData) ?? buildFallbackLayoutPlan(analysisData);
  if (!activePlan) return null;

  return {
    ...activePlan,
    id: activePlan.id || "layout-option-1",
    name: activePlan.name || "시안",
    description: activePlan.description || "저장된 레이아웃 시안",
  };
}

export function LayoutPlanPanel({ sessionId, analysisData, isAnalyzing, onRegenerateLayoutImages }: LayoutPlanPanelProps) {
  const setAnalysisData = useAppStore((s) => s.setAnalysisData);
  const layoutImagePrompt = useAppStore((s) => s.layoutImagePrompt);
  const setLayoutImagePrompt = useAppStore((s) => s.setLayoutImagePrompt);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const selectedPlan = useMemo(() => resolveLayoutPlan(analysisData), [analysisData]);
  const [promptDraft, setPromptDraft] = useState(layoutImagePrompt);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [selectedSourceTableIds, setSelectedSourceTableIds] = useState<string[]>([]);
  const previewDataContext = useMemo(() => buildPreviewDataRegistry(analysisData), [analysisData]);
  const sourceTables = useMemo(() => getSourceTables(analysisData), [analysisData]);

  useEffect(() => {
    setPromptDraft(layoutImagePrompt);
  }, [layoutImagePrompt]);

  useEffect(() => {
    const nextSelected = Array.isArray(analysisData?.selectedSourceTableIds)
      ? analysisData.selectedSourceTableIds
      : sourceTables.map((table) => table.id);
    setSelectedSourceTableIds(nextSelected);
  }, [analysisData?.selectedSourceTableIds, sourceTables]);

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

  const persistLayoutPlanPreviewImage = useCallback(
    async (layoutPlanId: string, previewImageDataUrl: string) => {
      const latestSession = sessionId ? await store.getSession(sessionId) : null;
      const latestAnalysisData = latestSession?.analysisData ?? analysisData;
      if (!latestAnalysisData) {
        return null;
      }

      const latestLayoutPlan = resolveLayoutPlan(latestAnalysisData);
      if (!latestLayoutPlan || latestLayoutPlan.id !== layoutPlanId) {
        return null;
      }

      const nextLayoutPlan = {
        ...latestLayoutPlan,
        previewImageDataUrl,
      };

      await persistAnalysisData(
        buildAnalysisWithSingleLayoutPlan(
          latestAnalysisData,
          cloneLayoutPlan(nextLayoutPlan) ?? nextLayoutPlan
        )
      );

      return nextLayoutPlan;
    },
    [analysisData, persistAnalysisData, sessionId]
  );

  const toggleSourceTableSelection = useCallback(
    async (tableId: string) => {
      if (!analysisData) return;

      const currentSelection = selectedSourceTableIds;
      const exists = currentSelection.includes(tableId);
      const nextSelection = exists
        ? currentSelection.filter((candidateId) => candidateId !== tableId)
        : [...currentSelection, tableId];

      if (nextSelection.length === 0) {
        return;
      }

      setSelectedSourceTableIds(nextSelection);
      await persistAnalysisData({
        ...analysisData,
        selectedSourceTableIds: nextSelection,
        visualizationBrief: undefined,
      });
    },
    [analysisData, persistAnalysisData, selectedSourceTableIds]
  );

  const handleSaveAndRegenerate = useCallback(async () => {
    const normalizedPrompt = promptDraft.trim() || DEFAULT_LAYOUT_IMAGE_PROMPT;
    setLayoutImagePrompt(normalizedPrompt);

    if (!sessionId || !onRegenerateLayoutImages) {
      return;
    }

    setIsSubmittingPrompt(true);
    try {
      await onRegenerateLayoutImages(normalizedPrompt);
    } finally {
      setIsSubmittingPrompt(false);
    }
  }, [onRegenerateLayoutImages, promptDraft, sessionId, setLayoutImagePrompt]);
  const { previewMode, isGeneratingPreview, onPreviewModeSelect } = useLayoutPlanPreviewImage({
    sessionId,
    analysisData,
    selectedPlan,
    selectedImageModel,
    persistLayoutPlanPreviewImage,
  });

  if (isAnalyzing || !analysisData || analysisData.status === "pending") {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm font-medium text-gray-500 animate-pulse">분석 결과로 레이아웃을 다시 계산하고 있습니다...</p>
        </div>
      </div>
    );
  }

  if (!selectedPlan) {
    return <div className="flex h-full items-center justify-center bg-white px-6 text-center text-sm text-gray-500">현재 세션에는 계산된 레이아웃이 없습니다.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 md:px-5 md:py-5">
        <div className="space-y-4">
          <LayoutPlanTopSection
            promptDraft={promptDraft}
            isSubmittingPrompt={isSubmittingPrompt}
            isAnalyzing={isAnalyzing}
            sourceTables={sourceTables}
            selectedSourceTableIds={selectedSourceTableIds}
            onPromptDraftChange={setPromptDraft}
            onResetPrompt={() => setPromptDraft(DEFAULT_LAYOUT_IMAGE_PROMPT)}
            onSaveAndRegenerate={() => {
              void handleSaveAndRegenerate();
            }}
            onToggleSourceTableSelection={(tableId) => {
              void toggleSourceTableSelection(tableId);
            }}
          />

          <LayoutPlanPreviewSection
            plan={selectedPlan}
            analysisData={analysisData}
            previewDataContext={previewDataContext}
            previewMode={previewMode}
            isGeneratingPreview={isGeneratingPreview}
            renderHtmlPreview={({ plan, analysisData: previewAnalysisData, previewDataContext: previewRegistry }) => (
              <LayoutHtmlPreview
                plan={plan}
                analysisData={previewAnalysisData}
                previewDataContext={previewRegistry}
                compact
                editable={false}
              />
            )}
            renderFallbackPreview={({ plan, analysisData: previewAnalysisData }) => (
              <VisualDraftBoard plan={plan} analysisData={previewAnalysisData} compact />
            )}
            onPreviewModeSelect={onPreviewModeSelect}
          />
        </div>
      </div>
    </div>
  );
}

function resolveLayoutTree(plan: LayoutPlan): LayoutBlockTree {
  return plan.layoutTree ?? buildLayoutTreeFromPlan(plan);
}

function resolveGroupRoleLabel(role: LayoutGroupBlock["content"]["role"]): string {
  return role === "generic" ? "그룹" : SECTION_TYPE_LABELS[role];
}

function resolveSectionRoleTitle(plan: LayoutPlan, sectionId?: string, fallbackRole?: LayoutGroupBlock["content"]["role"]): string {
  if (!sectionId) {
    return fallbackRole ? resolveGroupRoleLabel(fallbackRole) : "그룹";
  }

  const section = plan.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return fallbackRole ? resolveGroupRoleLabel(fallbackRole) : "그룹";
  }

  const rolePresentation = getSectionRolePresentation(section.sectionRole);
  return rolePresentation ? `${getSectionDisplayTitle(section)} · ${rolePresentation.label}` : getSectionDisplayTitle(section);
}

function resolveSectionSourceTableIds(plan: LayoutPlan, sectionId?: string): string[] | undefined {
  if (!sectionId) return undefined;
  return plan.sections.find((section) => section.id === sectionId)?.sourceTableIds;
}

function buildChartSpecFromBlock(block: LayoutChartBlock): LayoutChartSpec {
  return {
    id: block.content.chartId,
    tableId: block.content.tableId,
    chartType: block.content.chartType,
    title: block.content.title,
    goal: block.content.goal,
    dimension: block.content.dimension,
    metric: block.content.metric,
    layout: block.layout,
  };
}

function rebuildCanvasGroupRegionLayouts(plan: LayoutPlan): LayoutPlan {
  const layoutTree = resolveLayoutTree(plan);
  const canvasGroups = layoutTree.rootIds
    .map((rootId) => layoutTree.blocks[rootId])
    .filter((block): block is LayoutGroupBlock => Boolean(block && block.type === "group" && block.region === "canvas"));
  if (canvasGroups.length === 0) {
    return plan;
  }

  const marginX = 4;
  const topPadding = plan.aspectRatio === "portrait" ? 4 : 3.5;
  const bottomPadding = 4;
  const gap = 3;
  const nextLayouts = new Map<string, LayoutGeometry>();
  let cursorY = topPadding;

  canvasGroups.forEach((groupBlock, index) => {
    const remaining = canvasGroups.length - index - 1;
    const remainingMinimumHeight = canvasGroups.slice(index + 1).reduce((sum, block) => sum + Math.max(12, Math.min(block.layout.height, 100)), 0);
    const remainingGap = gap * remaining;
    const maxHeight = 100 - bottomPadding - cursorY - remainingMinimumHeight - remainingGap;
    const nextHeight = clampPercent(groupBlock.layout.height, 12, Math.max(12, maxHeight));
    nextLayouts.set(groupBlock.id, {
      x: clampPercent(groupBlock.layout.x, 0, 100 - Math.min(groupBlock.layout.width, 100)),
      y: cursorY,
      width: clampPercent(groupBlock.layout.width, 24, 100 - marginX * 2),
      height: nextHeight,
    });
    cursorY += nextHeight + gap;
  });

  const nextBlocks = { ...layoutTree.blocks };
  let changed = false;

  canvasGroups.forEach((block) => {
    const nextLayout = nextLayouts.get(block.id);
    if (!nextLayout || isSameLayout(block.layout, nextLayout)) {
      return;
    }

    nextBlocks[block.id] = {
      ...block,
      layout: nextLayout,
    };
    changed = true;
  });

  if (!changed) {
    return plan;
  }

  return projectLayoutPlanFromTree({
    ...plan,
    layoutTree: {
      rootIds: [...layoutTree.rootIds],
      blocks: nextBlocks,
    },
  });
}

function resolveCanvasGroupTargetIndex(plan: LayoutPlan, groupBlockId: string, clientY: number, canvasRect?: DOMRect | null): number {
  const layoutTree = resolveLayoutTree(plan);
  const canvasGroups = layoutTree.rootIds
    .map((rootId) => layoutTree.blocks[rootId])
    .filter((block): block is LayoutGroupBlock => Boolean(block && block.type === "group" && block.region === "canvas"));
  const currentIndex = canvasGroups.findIndex((block) => block.id === groupBlockId);
  if (currentIndex < 0 || !canvasRect || canvasRect.height <= 0) {
    return currentIndex;
  }

  const pointerY = clampPercent(((clientY - canvasRect.top) / canvasRect.height) * 100, 0, 100);
  const nextIndex = canvasGroups.findIndex((block) => pointerY < block.layout.y + block.layout.height / 2);
  return nextIndex >= 0 ? nextIndex : Math.max(canvasGroups.length - 1, 0);
}

function reorderCanvasGroupIntoRegion(plan: LayoutPlan, groupBlockId: string, targetIndex: number): LayoutPlan {
  return rebuildCanvasGroupRegionLayouts(reorderLayoutTreeRoots(plan, groupBlockId, targetIndex));
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
    <article className={`h-full rounded-[18px] border border-slate-200/80 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.06)] ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-slate-900">{titleContent ?? chart.title}</div>
          {(goalContent ?? chart.goal) && <div className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{goalContent ?? chart.goal}</div>}
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
      className={`block min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words custom-scrollbar ${multiline ? "h-full min-h-0" : ""} ${displayClassName} ${editable ? "rounded-md px-1.5 py-1 transition-colors" : ""} ${selected ? "bg-blue-50/80 text-slate-900" : editable ? "hover:bg-slate-100/80" : ""}`}
    >
      {resolvedValue || <span className="text-slate-300">{placeholder}</span>}
    </button>
  );
}

function LayoutMoveToolbar({
  ariaLabel,
  selected = false,
  onPointerDown,
}: {
  ariaLabel: string;
  selected?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={`absolute left-1/2 top-0 z-40 -translate-x-1/2 -translate-y-[130%] transition-opacity duration-150 ${selected ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        className={`flex h-7 w-7 cursor-grab items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${selected ? "border-blue-200 bg-white text-blue-700 shadow-[0_8px_18px_rgba(59,130,246,0.18)]" : "border-slate-200 bg-white/95 text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
        onPointerDown={onPointerDown}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
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
  onStartInteraction?: (type: "drag" | "resize", event: React.PointerEvent, origin: LayoutGeometry, resizeDirection?: ResizeHandleDirection, surfaceMetrics?: { width: number; height: number }) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      style={{ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%`, height: `${layout.height}%` }}
      className={`group absolute overflow-visible rounded-[14px] ${selected ? "z-20" : "hover:z-10"}`}
      data-layout-frame="true"
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(id);
      }}
    >
      <div className={`absolute inset-[2px] overflow-visible rounded-[12px] ${className}`}>{children}</div>
      {editable && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 rounded-[14px] border transition-[border-color,box-shadow] ${selected ? "border-transparent shadow-[inset_0_0_0_2px_rgba(59,130,246,0.95),0_0_0_5px_rgba(59,130,246,0.16)]" : "border-dashed border-slate-300/80 group-hover:border-blue-300/80"}`}
          />
          <LayoutMoveToolbar
            ariaLabel={`${label} 이동`}
            selected={selected}
            onPointerDown={(event) => {
              event.stopPropagation();
              const surfaceMetrics = resolveInteractionSurfaceMetrics(event.currentTarget);
              onSelect?.(id);
              onStartInteraction?.("drag", event, layout, undefined, surfaceMetrics ?? undefined);
            }}
          />
          {RESIZE_HANDLE_DEFINITIONS.map((handle) => (
            <button
              key={handle.direction}
              type="button"
              aria-label={`${label} ${handle.ariaLabelSuffix} 크기 조절`}
              className={`absolute z-20 rounded-[8px] bg-transparent ${handle.hitAreaClassName} ${handle.cursorClassName}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                const surfaceMetrics = resolveInteractionSurfaceMetrics(event.currentTarget);
                onSelect?.(id);
                onStartInteraction?.("resize", event, layout, handle.direction, surfaceMetrics ?? undefined);
              }}
            />
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
  previewDataContext: PreviewDataRegistry;
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
  onStartLayoutInteraction?: (type: "drag" | "resize", event: React.PointerEvent, origin: LayoutGeometry, apply: (current: LayoutPlan, nextLayout: LayoutGeometry) => LayoutPlan, resizeDirection?: ResizeHandleDirection, surfaceMetrics?: { width: number; height: number }) => void;
}) {
  if (section.type === "header") {
    return null;
  }

  const titleId = `${section.id}-title`;
  const noteId = `${section.id}-note`;
  const displayTitle = getSectionDisplayTitle(section);
  const titlePlaceholder = getSectionTitlePlaceholder(section);
  const rolePresentation = getSectionRolePresentation(section.sectionRole);
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
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection, surfaceMetrics)}
          >
            <div className="h-full rounded-[14px] bg-white/90 px-0.5 py-0">
              <EditableTextSlot
                id={titleId}
                value={displayTitle}
                placeholder={titlePlaceholder}
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
          {rolePresentation && (
            <div className="pointer-events-none absolute right-2 top-2">
              <SectionRoleBadge role={section.sectionRole} compact />
            </div>
          )}
          {section.charts.map((chart) => {
            const chartTitleId = `${chart.id}-title`;
            if (!chart.layout) return null;
            return (
              <LayoutObjectFrame
                key={chart.id}
                id={`${chart.id}-card`}
                label="차트 카드"
                layout={chart.layout}
                editable={editable}
                selected={isSelectedLayoutElement(selectedElementId, `${chart.id}-card`, chartTitleId)}
                onSelect={onSelectElement}
                onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateChartLayout(current, section.id, chart.id, nextLayout), resizeDirection, surfaceMetrics)}
              >
                <div className="h-full px-2 py-2">
                  <HtmlChartCard
                    chart={chart}
                          preview={buildPreparedPreviewChart(chart, previewDataContext, section.sourceTableIds)}
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
                  />
                </div>
              </LayoutObjectFrame>
            );
          })}
        </section>
      );
    }
    return (
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <EditableTextSlot
              id={titleId}
              value={displayTitle}
              placeholder={titlePlaceholder}
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
            {rolePresentation && <p className="mt-1 text-[10px] text-slate-400">{rolePresentation.hint}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SectionRoleBadge role={section.sectionRole} compact />
            <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{section.charts.length} charts</span>
          </div>
        </div>
        <div className={`grid gap-2.5 ${gridClass}`}>
          {section.charts.map((chart) => {
            const chartTitleId = `${chart.id}-title`;
            return (
              <HtmlChartCard
                key={chart.id}
                chart={chart}
                          preview={buildPreparedPreviewChart(chart, previewDataContext, section.sourceTableIds)}
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
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection, surfaceMetrics)}
          >
            <div className="h-full rounded-[14px] bg-white/90 px-0.5 py-0">
              <EditableTextSlot
                id={titleId}
                value={displayTitle}
                placeholder={titlePlaceholder}
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
          {rolePresentation && (
            <div className="pointer-events-none absolute right-2 top-2">
              <SectionRoleBadge role={section.sectionRole} compact />
            </div>
          )}
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
                onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateItemLayout(current, section.id, item.id, nextLayout), resizeDirection, surfaceMetrics)}
              >
                <div className="h-full rounded-[16px] border border-slate-200 bg-white px-3 pb-2.5 pt-2 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
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
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <EditableTextSlot
              id={titleId}
              value={displayTitle}
              placeholder={titlePlaceholder}
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
            {rolePresentation && <p className="mt-1 text-[10px] text-slate-400">{rolePresentation.hint}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SectionRoleBadge role={section.sectionRole} compact />
            <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-slate-500">{kpis.length} metrics</span>
          </div>
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
          onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "titleLayout", nextLayout), resizeDirection, surfaceMetrics)}
        >
            <div className="h-full rounded-[14px] bg-white/90 px-0.5 py-0">
            <EditableTextSlot
              id={titleId}
              value={displayTitle}
              placeholder={titlePlaceholder}
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
        {rolePresentation && (
          <div className="pointer-events-none absolute right-2 top-2">
            <SectionRoleBadge role={section.sectionRole} compact />
          </div>
        )}
        <LayoutObjectFrame
          id={noteId}
          label="설명 블록"
          layout={section.noteLayout}
          editable={editable}
          selected={isSelectedLayoutElement(selectedElementId, noteId)}
          onSelect={onSelectElement}
          onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) => onStartLayoutInteraction?.(type, event, origin, (current, nextLayout) => updateSectionLayoutField(current, section.id, "noteLayout", nextLayout), resizeDirection, surfaceMetrics)}
        >
          <div className="h-full rounded-[18px] border border-slate-200/80 bg-white px-3 pb-2.5 pt-2 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
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
    ) : <section className="rounded-[18px] border border-slate-200/80 bg-white px-3 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <EditableTextSlot
            id={titleId}
            value={displayTitle}
            placeholder={titlePlaceholder}
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
          {rolePresentation && <p className="mt-1 text-[10px] text-slate-400">{rolePresentation.hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SectionRoleBadge role={section.sectionRole} compact />
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-500">{SECTION_TYPE_LABELS[section.type]}</span>
        </div>
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
  previewDataContext: PreviewDataRegistry;
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
  const layoutTree = useMemo(() => resolveLayoutTree(plan), [plan]);
  const headerSection = plan.sections.find((section) => section.type === "header");
  const editableHeaderTitleBlock = editable && layoutTree.blocks[`${plan.id}-header-title`]?.type === "heading"
    ? layoutTree.blocks[`${plan.id}-header-title`] as LayoutHeadingBlock
    : null;
  const editableHeaderSummaryBlock = editable && layoutTree.blocks[`${plan.id}-header-summary`]?.type === "text"
    ? layoutTree.blocks[`${plan.id}-header-summary`] as LayoutTextBlock
    : null;
  const canvasGroups = useMemo(
    () => layoutTree.rootIds
      .map((rootId) => layoutTree.blocks[rootId])
      .filter((block): block is LayoutGroupBlock => Boolean(block && block.type === "group" && block.region === "canvas" && !block.hidden)),
    [layoutTree]
  );
  const title = (editable ? editableHeaderTitleBlock?.content.text : undefined) || headerSection?.title || plan.name || getAnalysisTitle(analysisData, "데이터 레이아웃");
  const summaryText =
    (editable ? editableHeaderSummaryBlock?.content.text : undefined) ||
    plan.description ||
    getFindings(analysisData)[0]?.text ||
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

      const interactionWidth = activeInteraction.surfaceWidth ?? canvasSize.width;
      const interactionHeight = activeInteraction.surfaceHeight ?? canvasSize.height;
      const deltaX = ((event.clientX - activeInteraction.startClientX) / interactionWidth) * 100;
      const deltaY = ((event.clientY - activeInteraction.startClientY) / interactionHeight) * 100;
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
        const groupBlockId = activeInteraction.groupBlockId;
        if (groupBlockId) {
          onPlanChange(
            (current) => reorderCanvasGroupIntoRegion(
              current,
              groupBlockId,
              resolveCanvasGroupTargetIndex(current, groupBlockId, event.clientY, canvasRef.current?.getBoundingClientRect())
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

      const interactionWidth = activeInteraction.surfaceWidth ?? canvasSize.width;
      const interactionHeight = activeInteraction.surfaceHeight ?? canvasSize.height;
      const deltaX = ((event.clientX - activeInteraction.startClientX) / interactionWidth) * 100;
      const deltaY = ((event.clientY - activeInteraction.startClientY) / interactionHeight) * 100;
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

  const startTreeBlockInteraction = useCallback(
    (
      type: "drag" | "resize",
      event: React.PointerEvent,
      origin: LayoutGeometry,
      blockId: string,
      resizeDirection?: ResizeHandleDirection,
      surfaceMetrics?: { width: number; height: number }
    ) => {
      setActiveInteraction({
        type,
        origin,
        startClientX: event.clientX,
        startClientY: event.clientY,
        surfaceWidth: surfaceMetrics?.width,
        surfaceHeight: surfaceMetrics?.height,
        resizeDirection,
        apply: (current: LayoutPlan, nextLayout: LayoutGeometry) =>
          updateLayoutTreeBlock(current, blockId, (block) => ({
            ...block,
            layout: nextLayout,
          })),
      });
    },
    []
  );

  const renderEditableCanvasBlock = useCallback(
    (groupBlock: LayoutGroupBlock, block: LayoutBlock) => {
      if (block.hidden) {
        return null;
      }

      if (block.type === "heading") {
        const placeholder = resolveSectionRoleTitle(plan, groupBlock.content.sectionId, groupBlock.content.role);
        const normalizedSectionRole = getSectionRolePresentation(
          plan.sections.find((section) => section.id === groupBlock.content.sectionId)?.sectionRole
        );
        return (
          <LayoutObjectFrame
            key={block.id}
            id={block.id}
            label="섹션 제목"
            layout={block.layout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, block.id)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
              startTreeBlockInteraction(type, event, origin, block.id, resizeDirection, surfaceMetrics)
            }
          >
            <div className="h-full rounded-[14px] bg-white/90 px-0.5 py-0">
              <EditableTextSlot
                id={block.id}
                value={block.content.text}
                placeholder={placeholder}
                editable={editable}
                selected={selectedElementId === block.id}
                editingField={editingField}
                displayClassName="w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 text-left"
                inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none ring-2 ring-blue-100"
                onSelect={onSelectElement ?? (() => undefined)}
                onStartEditing={onStartEditing}
                onChange={onChangeEditingValue}
                onCancel={onCancelEditing}
                onCommit={(id, value) => {
                  const trimmed = value.trim();
                  const nextText = trimmed || block.content.text;
                  onPlanChange?.(
                    (current) => updateLayoutTreeBlock(current, block.id, (target) =>
                      target.type === "heading"
                        ? { ...target, content: { ...target.content, text: nextText } }
                        : target
                    ),
                    { persist: true }
                  );
                  onCommitEditing?.(id, value);
                }}
              />
              {normalizedSectionRole && (
                <div className="pointer-events-none absolute right-2 top-2">
                  <SectionRoleBadge role={normalizedSectionRole.label} compact />
                </div>
              )}
            </div>
          </LayoutObjectFrame>
        );
      }

      if (block.type === "text") {
        return (
          <LayoutObjectFrame
            key={block.id}
            id={block.id}
            label="설명 블록"
            layout={block.layout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, block.id)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
              startTreeBlockInteraction(type, event, origin, block.id, resizeDirection, surfaceMetrics)
            }
          >
            <div className="h-full rounded-[18px] border border-slate-200/80 bg-white px-3 pb-2.5 pt-2 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
              <EditableTextSlot
                id={block.id}
                value={block.content.text}
                placeholder="설명 텍스트"
                editable={editable}
                multiline
                selected={selectedElementId === block.id}
                editingField={editingField}
                displayClassName="w-full text-[11px] leading-relaxed text-slate-600 text-left"
                inputClassName="min-h-[88px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
                onSelect={onSelectElement ?? (() => undefined)}
                onStartEditing={onStartEditing}
                onChange={onChangeEditingValue}
                onCancel={onCancelEditing}
                onCommit={(id, value) => {
                  onPlanChange?.(
                    (current) => updateLayoutTreeBlock(current, block.id, (target) =>
                      target.type === "text"
                        ? { ...target, content: { ...target.content, text: value.trim() } }
                        : target
                    ),
                    { persist: true }
                  );
                  onCommitEditing?.(id, value);
                }}
              />
            </div>
          </LayoutObjectFrame>
        );
      }

      if (block.type === "chart") {
        const chart = buildChartSpecFromBlock(block);
        const chartTitleId = `${block.id}-title`;
        const sourceTableIds = resolveSectionSourceTableIds(plan, block.content.sectionId);

        return (
          <LayoutObjectFrame
            key={block.id}
            id={block.id}
            label="차트 카드"
            layout={block.layout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, block.id, chartTitleId)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
              startTreeBlockInteraction(type, event, origin, block.id, resizeDirection, surfaceMetrics)
            }
          >
            <div className="h-full px-2 py-2">
              <HtmlChartCard
                chart={chart}
                preview={buildPreparedPreviewChart(chart, previewDataContext, sourceTableIds)}
                compact={compact}
                titleContent={
                  <EditableTextSlot
                    id={chartTitleId}
                    value={block.content.title}
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
                      const trimmed = value.trim() || block.content.title || "차트 제목";
                      onPlanChange?.(
                        (current) => updateLayoutTreeBlock(current, block.id, (target) =>
                          target.type === "chart"
                            ? { ...target, content: { ...target.content, title: trimmed } }
                            : target
                        ),
                        { persist: true }
                      );
                      onCommitEditing?.(id, value);
                    }}
                  />
                }
              />
            </div>
          </LayoutObjectFrame>
        );
      }

      if (block.type === "kpi") {
        const labelId = `${block.id}-label`;
        const valueId = `${block.id}-value`;

        return (
          <LayoutObjectFrame
            key={block.id}
            id={block.id}
            label="KPI 카드"
            layout={block.layout}
            editable={editable}
            selected={isSelectedLayoutElement(selectedElementId, block.id, labelId, valueId)}
            onSelect={onSelectElement}
            onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
              startTreeBlockInteraction(type, event, origin, block.id, resizeDirection, surfaceMetrics)
            }
          >
            <div className="h-full rounded-[16px] border border-slate-200 bg-white px-3 pb-2.5 pt-2 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
              <EditableTextSlot
                id={labelId}
                value={block.content.label}
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
                  const trimmed = value.trim() || block.content.label || "지표";
                  onPlanChange?.(
                    (current) => updateLayoutTreeBlock(current, block.id, (target) =>
                      target.type === "kpi"
                        ? { ...target, content: { ...target.content, label: trimmed } }
                        : target
                    ),
                    { persist: true }
                  );
                  onCommitEditing?.(id, value);
                }}
              />
              <EditableTextSlot
                id={valueId}
                value={block.content.value}
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
                  const trimmed = value.trim() || block.content.value.trim() || "-";
                  onPlanChange?.(
                    (current) => updateLayoutTreeBlock(current, block.id, (target) =>
                      target.type === "kpi"
                        ? { ...target, content: { ...target.content, value: trimmed } }
                        : target
                    ),
                    { persist: true }
                  );
                  onCommitEditing?.(id, value);
                }}
              />
              <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{resolveKpiNoteForBlock(block, plan, previewDataContext)}</p>
            </div>
          </LayoutObjectFrame>
        );
      }

      return null;
    },
    [
      compact,
      editable,
      editingField,
      onCancelEditing,
      onChangeEditingValue,
      onCommitEditing,
      onPlanChange,
      onSelectElement,
      onStartEditing,
      plan,
      previewDataContext,
      selectedElementId,
      startTreeBlockInteraction,
    ]
  );

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.95)_0%,rgba(255,255,255,1)_58%,rgba(241,245,249,1)_100%)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Deterministic HTML Preview</p>
            {editable && editableHeaderTitleBlock && editableHeaderSummaryBlock ? (
              <div className="relative mt-1 h-[84px] overflow-visible">
                <LayoutObjectFrame
                  id={editableHeaderTitleBlock.id}
                  label="제목"
                  layout={editableHeaderTitleBlock.layout}
                  editable={editable}
                  selected={isSelectedLayoutElement(selectedElementId, editableHeaderTitleBlock.id)}
                  onSelect={onSelectElement}
                  onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
                    startTreeBlockInteraction(type, event, origin, editableHeaderTitleBlock.id, resizeDirection, surfaceMetrics)
                  }
                >
                  <div className="h-full rounded-[14px] bg-white/80 px-0.5 py-0">
                    <EditableTextSlot
                      id={editableHeaderTitleBlock.id}
                      value={title}
                      placeholder="레이아웃 제목"
                      editable={editable}
                      selected={selectedElementId === editableHeaderTitleBlock.id}
                      editingField={editingField}
                      displayClassName="w-full text-left text-[18px] font-bold tracking-[-0.04em] text-slate-900"
                      inputClassName="w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[18px] font-bold tracking-[-0.04em] text-slate-900 outline-none ring-2 ring-blue-100"
                      onSelect={onSelectElement ?? (() => undefined)}
                      onStartEditing={onStartEditing}
                      onChange={onChangeEditingValue}
                      onCancel={onCancelEditing}
                      onCommit={(id, value) => {
                        const trimmed = value.trim();
                        onPlanChange?.(
                          (current) => updateLayoutTreeBlock(current, editableHeaderTitleBlock.id, (block) =>
                            block.type === "heading"
                              ? { ...block, content: { ...block.content, text: trimmed || "레이아웃 제목" } }
                              : block
                          ),
                          { persist: true }
                        );
                        onCommitEditing?.(id, value);
                      }}
                    />
                  </div>
                </LayoutObjectFrame>
                <LayoutObjectFrame
                  id={editableHeaderSummaryBlock.id}
                  label="설명"
                  layout={editableHeaderSummaryBlock.layout}
                  editable={editable}
                  selected={isSelectedLayoutElement(selectedElementId, editableHeaderSummaryBlock.id)}
                  onSelect={onSelectElement}
                  onStartInteraction={(type, event, origin, resizeDirection, surfaceMetrics) =>
                    startTreeBlockInteraction(type, event, origin, editableHeaderSummaryBlock.id, resizeDirection, surfaceMetrics)
                  }
                >
                  <div className="h-full rounded-[14px] bg-white/70 px-0.5 py-0">
                    <EditableTextSlot
                      id={editableHeaderSummaryBlock.id}
                      value={summaryText}
                      placeholder="레이아웃 설명"
                      editable={editable}
                      multiline
                      selected={selectedElementId === editableHeaderSummaryBlock.id}
                      editingField={editingField}
                      displayClassName="w-full text-left text-[11px] leading-relaxed text-slate-500"
                      inputClassName="min-h-[40px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
                      onSelect={onSelectElement ?? (() => undefined)}
                      onStartEditing={onStartEditing}
                      onChange={onChangeEditingValue}
                      onCancel={onCancelEditing}
                      onCommit={(id, value) => {
                        onPlanChange?.(
                          (current) => updateLayoutTreeBlock(current, editableHeaderSummaryBlock.id, (block) =>
                            block.type === "text"
                              ? { ...block, content: { ...block.content, text: value.trim() } }
                              : block
                          ),
                          { persist: true }
                        );
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
                  inputClassName="mt-2 min-h-[56px] w-full rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] leading-relaxed text-slate-600 outline-none ring-2 ring-blue-100"
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
                  <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[9px] font-medium text-slate-500">{previewDataContext.defaultContext.rows.length.toLocaleString("ko-KR")} rows</span>
          </div>
        </div>
      </div>
      <div className={`bg-[radial-gradient(circle_at_top_left,rgba(226,232,240,0.7),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] ${compact ? "p-3" : "p-4"}`} style={{ aspectRatio: PREVIEW_ASPECT_RATIOS[plan.aspectRatio] }}>
        <div ref={canvasRef} className={`relative h-full rounded-[18px] ${editable ? "overflow-visible border border-dashed border-slate-200/80 bg-white/45" : "overflow-hidden"}`}>
              {editable ? (
            canvasGroups.map((groupBlock) => {
              const isDraggingSection = activeInteraction?.type === "section-reorder" && activeInteraction.groupBlockId === groupBlock.id;
              const isSelectedSection = isSelectedLayoutElement(selectedElementId, groupBlock.id);
              const sourceSection = plan.sections.find((section) => section.id === groupBlock.content.sectionId);
              const sectionTitle = resolveSectionRoleTitle(plan, groupBlock.content.sectionId, groupBlock.content.role);
              return (
                <div
                  key={groupBlock.id}
                  style={{ left: `${groupBlock.layout.x}%`, top: `${groupBlock.layout.y}%`, width: `${groupBlock.layout.width}%`, height: `${groupBlock.layout.height}%` }}
                  className={`group absolute overflow-visible rounded-[20px] p-1.5 transition-shadow ${isDraggingSection || isSelectedSection ? "z-20" : "hover:z-10"} ${isDraggingSection ? "shadow-[0_18px_36px_rgba(15,23,42,0.12)]" : "shadow-[0_12px_28px_rgba(15,23,42,0.08)]"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectElement?.(groupBlock.id);
                  }}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 rounded-[20px] border transition-[border-color,box-shadow] ${isSelectedSection ? "border-transparent shadow-[inset_0_0_0_2px_rgba(59,130,246,0.9),0_0_0_5px_rgba(59,130,246,0.14)]" : "border-transparent group-hover:border-blue-200/80"}`}
                  />
                  <LayoutMoveToolbar
                    ariaLabel={`${sectionTitle} 영역 이동`}
                    selected={isSelectedSection}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectElement?.(groupBlock.id);
                      setActiveInteraction({
                        type: "section-reorder",
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        groupBlockId: groupBlock.id,
                      });
                    }}
                  />
                  {getSectionRolePresentation(sourceSection?.sectionRole) && (
                    <div className="pointer-events-none absolute right-3 top-3 z-10">
                      <SectionRoleBadge role={sourceSection?.sectionRole} compact />
                    </div>
                  )}
                  <div className="relative h-full overflow-auto rounded-[18px] bg-white/88 p-3 custom-scrollbar">
                    {groupBlock.childIds.map((childId) => {
                      const childBlock = layoutTree.blocks[childId];
                      return childBlock ? renderEditableCanvasBlock(groupBlock, childBlock) : null;
                    })}
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
  const layoutIntent = getLayoutIntentPresentation(plan.layoutIntent);

  return (
    <div className={`rounded-[18px] bg-white shadow-sm ${compact ? "px-4 py-4" : "px-5 py-5"}`}>
      <div className={`border-b border-gray-200 ${compact ? "pb-3" : "pb-4"}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-gray-500">레이아웃 시안</p>
          {layoutIntent && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-medium text-violet-700">{layoutIntent}</span>}
        </div>
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
  const displayTitle = getSectionDisplayTitle(section);
  const rolePresentation = getSectionRolePresentation(section.sectionRole);

  return (
    <section className={compact ? "space-y-2.5" : "space-y-3"}>
      <div className={`flex items-center justify-between rounded-sm bg-[#456fbe] text-white ${compact ? "px-3 py-2" : "px-4 py-2"}`}>
        <div>
          <span className="text-[11px] font-semibold tracking-[0.01em]">
            {index + 1}. {displayTitle}
          </span>
          {rolePresentation && <p className="mt-1 text-[10px] font-medium opacity-80">{rolePresentation.hint}</p>}
        </div>
        <div className="flex items-center gap-2">
          {rolePresentation && <SectionRoleBadge role={section.sectionRole} compact />}
          <span className="text-[10px] font-medium opacity-80">Base: 전체</span>
        </div>
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-gray-800">{displayTitle}</p>
            <SectionRoleBadge role={section.sectionRole} compact />
          </div>
          {section.note && <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{section.note}</p>}
        </div>
      )}
    </section>
  );
}
