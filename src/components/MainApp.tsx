"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Menu, Sparkles } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_LAYOUT_SYSTEM_PROMPT } from "@/lib/layout-prompts";
import { store, type TableSession } from "@/lib/store";
import type {
  AnalysisData,
  LayoutAspectRatio,
  LayoutChartType,
  LayoutPlan,
  LayoutSectionType,
  ReferenceLine,
  SummaryVariant,
} from "@/lib/session-types";
import {
  buildTableContext,
  getDatasetTitle,
  parseTableFile,
  type TableData,
} from "@/lib/table-utils";
import { ApiKeyModal } from "./ApiKeyModal";
import { Sidebar } from "./Sidebar";
import { TableUploader } from "./TableUploader";
import { LeftPanel } from "./pdf/left-panel";
import { RightPanel } from "./pdf/right-panel";

export type { AnalysisData, ReferenceLine, SummaryVariant };

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("파일 인코딩에 실패했습니다."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function normalizePages(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const item of value) {
    const next = typeof item === "number" ? item : Number.parseInt(String(item), 10);
    if (Number.isFinite(next) && next > 0) {
      seen.add(next);
    }
  }
  return Array.from(seen);
}

function normalizeLine(value: unknown): ReferenceLine | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { text?: unknown; pages?: unknown };
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text) return null;
  return { text, pages: normalizePages(candidate.pages) };
}

function normalizeSummaries(value: unknown): SummaryVariant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { title?: unknown; content?: unknown; lines?: unknown };
    const title = typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : "요약";
    const content = typeof candidate.content === "string" && candidate.content.trim() ? candidate.content.trim() : undefined;
    const lines = Array.isArray(candidate.lines)
      ? candidate.lines.map(normalizeLine).filter((line): line is ReferenceLine => line !== null)
      : undefined;
    return [{ title, content, lines: lines && lines.length > 0 ? lines : undefined }];
  });
}

function normalizeIssues(value: unknown): string | ReferenceLine[] {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map(normalizeLine).filter((line): line is ReferenceLine => line !== null);
}

const LAYOUT_SECTION_TYPES: LayoutSectionType[] = ["header", "chart-group", "kpi-group", "takeaway", "note"];
const LAYOUT_CHART_TYPES: LayoutChartType[] = ["bar", "line", "donut", "pie", "stacked-bar", "map"];
const LAYOUT_ASPECT_RATIOS: LayoutAspectRatio[] = ["portrait", "square", "landscape"];

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isLayoutAspectRatio(value: unknown): value is LayoutAspectRatio {
  return typeof value === "string" && LAYOUT_ASPECT_RATIOS.includes(value as LayoutAspectRatio);
}

function isLayoutSectionType(value: unknown): value is LayoutSectionType {
  return typeof value === "string" && LAYOUT_SECTION_TYPES.includes(value as LayoutSectionType);
}

function isLayoutChartType(value: unknown): value is LayoutChartType {
  return typeof value === "string" && LAYOUT_CHART_TYPES.includes(value as LayoutChartType);
}

function normalizeLayoutSectionType(value: unknown): LayoutSectionType | undefined {
  if (value === "chart") return "chart-group";
  return isLayoutSectionType(value) ? value : undefined;
}

function normalizeLayoutPlan(value: unknown): LayoutPlan | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as {
    layoutType?: unknown;
    aspectRatio?: unknown;
    sections?: unknown;
    visualPolicy?: unknown;
  };

  const layoutType = candidate.layoutType === "dashboard" ? "dashboard" : undefined;
  const aspectRatio = isLayoutAspectRatio(candidate.aspectRatio) ? candidate.aspectRatio : undefined;

  if (!layoutType || !aspectRatio) return undefined;

  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.flatMap((section, index) => {
        if (!section || typeof section !== "object") return [];
        const sectionCandidate = section as {
          id?: unknown;
          type?: unknown;
          title?: unknown;
          charts?: unknown;
          items?: unknown;
          note?: unknown;
        };

        const type = normalizeLayoutSectionType(sectionCandidate.type);

        if (!type) return [];

        const charts = Array.isArray(sectionCandidate.charts)
          ? sectionCandidate.charts.flatMap((chart, chartIndex) => {
              if (!chart || typeof chart !== "object") return [];
              const chartCandidate = chart as {
                id?: unknown;
                chartType?: unknown;
                title?: unknown;
                goal?: unknown;
                dimension?: unknown;
                metric?: unknown;
              };

              const chartType = isLayoutChartType(chartCandidate.chartType) ? chartCandidate.chartType : undefined;
              const title = normalizeNonEmptyString(chartCandidate.title);
              const goal = normalizeNonEmptyString(chartCandidate.goal);

              if (!chartType || !title || !goal) return [];

              return [
                {
                  id: normalizeNonEmptyString(chartCandidate.id) ?? `chart-${index + 1}-${chartIndex + 1}`,
                  chartType,
                  title,
                  goal,
                  dimension: normalizeNonEmptyString(chartCandidate.dimension),
                  metric: normalizeNonEmptyString(chartCandidate.metric),
                },
              ];
            })
          : type === "chart-group"
            ? (() => {
                const chartType = isLayoutChartType((sectionCandidate as { chartType?: unknown }).chartType)
                  ? (sectionCandidate as { chartType?: LayoutChartType }).chartType
                  : undefined;
                const title = normalizeNonEmptyString(sectionCandidate.title);
                const goal = normalizeNonEmptyString((sectionCandidate as { goal?: unknown }).goal);

                if (!chartType || !title || !goal) {
                  return undefined;
                }

                return [
                  {
                    id: normalizeNonEmptyString((sectionCandidate as { chartId?: unknown }).chartId) ?? `chart-${index + 1}-1`,
                    chartType,
                    title,
                    goal,
                    dimension: normalizeNonEmptyString((sectionCandidate as { dimension?: unknown }).dimension),
                    metric: normalizeNonEmptyString((sectionCandidate as { metric?: unknown }).metric),
                  },
                ];
              })()
          : undefined;

        const items = Array.isArray(sectionCandidate.items)
          ? sectionCandidate.items.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const itemCandidate = item as { label?: unknown; value?: unknown };
              const label = normalizeNonEmptyString(itemCandidate.label);
              const itemValue = normalizeNonEmptyString(itemCandidate.value);
              return label && itemValue ? [{ label, value: itemValue }] : [];
            })
          : undefined;

        return [
          {
            id: normalizeNonEmptyString(sectionCandidate.id) ?? `section-${index + 1}`,
            type,
            title: normalizeNonEmptyString(sectionCandidate.title),
            charts: charts && charts.length > 0 ? charts : undefined,
            items: items && items.length > 0 ? items : undefined,
            note: normalizeNonEmptyString(sectionCandidate.note),
          },
        ];
      })
    : [];

  const visualPolicyCandidate = candidate.visualPolicy as
    | { textRatio?: unknown; chartRatio?: unknown; iconRatio?: unknown }
    | undefined;

  const textRatio = typeof visualPolicyCandidate?.textRatio === "number" ? visualPolicyCandidate.textRatio : NaN;
  const chartRatio = typeof visualPolicyCandidate?.chartRatio === "number" ? visualPolicyCandidate.chartRatio : NaN;
  const iconRatio = typeof visualPolicyCandidate?.iconRatio === "number" ? visualPolicyCandidate.iconRatio : NaN;
  const ratioTotal = textRatio + chartRatio + iconRatio;
  const visualPolicy = Number.isFinite(ratioTotal) && ratioTotal > 0
    ? {
        textRatio: textRatio / ratioTotal,
        chartRatio: chartRatio / ratioTotal,
        iconRatio: iconRatio / ratioTotal,
      }
    : {
        textRatio: 0.15,
        chartRatio: 0.75,
        iconRatio: 0.1,
      };

  if (sections.length === 0) {
    return undefined;
  }

  return {
    id: normalizeNonEmptyString((candidate as { id?: unknown }).id) ?? `layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    layoutType,
    aspectRatio,
    name: normalizeNonEmptyString((candidate as { name?: unknown }).name),
    description: normalizeNonEmptyString((candidate as { description?: unknown }).description),
    previewImageDataUrl: normalizeNonEmptyString((candidate as { previewImageDataUrl?: unknown }).previewImageDataUrl),
    sections,
    visualPolicy,
  };
}

function normalizeLayoutPlans(value: unknown): LayoutPlan[] | undefined {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  const plans = candidates
    .map((candidate) => normalizeLayoutPlan(candidate))
    .filter((plan): plan is LayoutPlan => plan !== undefined)
    .map((plan, index) => ({
      ...plan,
      id: plan.id || `layout-option-${index + 1}`,
      name: plan.name || `시안 ${index + 1}`,
      description: plan.description || `${plan.aspectRatio === "portrait" ? "세로형" : plan.aspectRatio === "landscape" ? "가로형" : "정사각형"} 대시보드 시안`,
    }));

  return plans.length > 0 ? plans : undefined;
}

function getSelectedLayoutPlan(
  layoutPlans: LayoutPlan[] | undefined,
  selectedLayoutPlanId?: string,
  fallbackPlan?: LayoutPlan
): LayoutPlan | undefined {
  if (layoutPlans && layoutPlans.length > 0) {
    return layoutPlans.find((plan) => plan.id === selectedLayoutPlanId) ?? layoutPlans[0];
  }
  return fallbackPlan;
}

function createPendingAnalysis(fileName: string, tableData: TableData): AnalysisData {
  return {
    title: getDatasetTitle(fileName),
    summaries: [],
    keywords: [],
    insights: "",
    issues: "",
    generatedLayoutPlans: undefined,
    selectedLayoutPlanId: undefined,
    generatedLayoutPlan: undefined,
    layoutPlan: undefined,
    generatedInfographicPrompt: "",
    infographicPrompt: "",
    tableContext: buildTableContext(tableData),
    tableData,
    status: "pending",
  };
}

function createUnsupportedAnalysis(fileName: string): AnalysisData {
  return {
    title: getDatasetTitle(fileName),
    summaries: [
      {
        title: "지원 안내",
        lines: [{ text: "이 세션은 표 미리보기용 데이터가 없어 새 CSV/XLSX 업로드가 필요합니다.", pages: [] }],
      },
    ],
    keywords: ["legacy", "session"],
    insights: "이 세션은 이전 형식으로 저장되어 표 인사이트 워크스페이스에 바로 복원할 수 없습니다.",
    issues: "새 CSV 또는 XLSX 파일로 다시 업로드하면 왼쪽 표 미리보기와 오른쪽 인포그래픽 인터페이스를 사용할 수 있습니다.",
    generatedLayoutPlans: undefined,
    selectedLayoutPlanId: undefined,
    generatedLayoutPlan: undefined,
    layoutPlan: undefined,
    generatedInfographicPrompt: "",
    infographicPrompt: "",
    status: "complete",
  };
}

function mergeAnalysisSeed(fileName: string, source: AnalysisData): AnalysisData {
  if (!source.tableData) return source;
  const pending = createPendingAnalysis(fileName, source.tableData);
  return {
    ...pending,
    ...source,
    title: source.title?.trim() || pending.title,
    generatedLayoutPlans:
      source.generatedLayoutPlans ??
      (source.generatedLayoutPlan ? [source.generatedLayoutPlan] : source.layoutPlan ? [source.layoutPlan] : pending.generatedLayoutPlans),
    selectedLayoutPlanId:
      source.selectedLayoutPlanId ?? source.layoutPlan?.id ?? source.generatedLayoutPlan?.id ?? pending.selectedLayoutPlanId,
    generatedLayoutPlan: source.generatedLayoutPlan ?? source.layoutPlan,
    layoutPlan: source.layoutPlan ?? source.generatedLayoutPlan,
    generatedInfographicPrompt:
      source.generatedInfographicPrompt?.trim() || source.infographicPrompt?.trim() || pending.generatedInfographicPrompt,
    tableContext: pending.tableContext,
    status: source.status ?? "pending",
  };
}

function hasCompleteAnalysis(analysisData: AnalysisData | null | undefined): boolean {
  return Boolean(analysisData?.tableData && analysisData.status === "complete");
}

export function MainApp({ initialSessionId }: { initialSessionId?: string }) {
  const fileUrl = useAppStore((state) => state.fileUrl);
  const setFileUrl = useAppStore((state) => state.setFileUrl);
  const isAnalyzing = useAppStore((state) => state.isAnalyzing);
  const setIsAnalyzing = useAppStore((state) => state.setIsAnalyzing);
  const analysisData = useAppStore((state) => state.analysisData);
  const setAnalysisData = useAppStore((state) => state.setAnalysisData);
  const pageNumber = useAppStore((state) => state.pageNumber);
  const setPageNumber = useAppStore((state) => state.setPageNumber);
  const setSessionIds = useAppStore((state) => state.setSessionIds);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setCurrentSessionId = useAppStore((state) => state.setCurrentSessionId);
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const setIsSidebarOpen = useAppStore((state) => state.setIsSidebarOpen);
  const isKeyModalOpen = useAppStore((state) => state.isKeyModalOpen);
  const setIsKeyModalOpen = useAppStore((state) => state.setIsKeyModalOpen);
  const pendingFile = useAppStore((state) => state.pendingFile);
  const setPendingFile = useAppStore((state) => state.setPendingFile);
  const currentFileName = useAppStore((state) => state.currentFileName);
  const setCurrentFileName = useAppStore((state) => state.setCurrentFileName);
  const layoutSystemPrompt = useAppStore((state) => state.layoutSystemPrompt);
  const [sessions, setSessions] = useState<TableSession[]>([]);

  useEffect(() => {
    void loadSessions().then(() => {
      if (initialSessionId) {
        void handleSelectSession(initialSessionId, true);
      }
    });

    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/" || path === "") {
        handleReset(true);
      } else {
        const id = path.substring(1);
        void handleSelectSession(id, true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  const loadSessions = async () => {
    const nextSessions = await store.getSessions();
    setSessions(nextSessions);
    setSessionIds(nextSessions.map((session) => session.id));
  };

  const hydrateSessionAnalysis = async (session: TableSession): Promise<{ session: TableSession; analysis: AnalysisData }> => {
    const sessionTableData: TableData = {
      ...session.tableData,
      sourceType: session.tableData.sourceType ?? session.fileType,
      normalizationNotes:
        session.tableData.normalizationNotes ?? [
          "첫 번째 비어있지 않은 행을 헤더로 사용했습니다.",
          "셀 값의 앞뒤 공백과 중복 공백을 정리했습니다.",
          "미리보기는 상위 40개 행만 표시합니다.",
        ],
    };

    const seededAnalysis = session.analysisData
      ? mergeAnalysisSeed(session.fileName, { ...session.analysisData, tableData: session.analysisData.tableData ?? sessionTableData })
      : createPendingAnalysis(session.fileName, sessionTableData);

    const shouldSave =
      JSON.stringify(seededAnalysis) !== JSON.stringify(session.analysisData) ||
      JSON.stringify(sessionTableData) !== JSON.stringify(session.tableData);

    if (shouldSave) {
      const nextSession = { ...session, tableData: sessionTableData, analysisData: seededAnalysis };
      await store.saveSession(nextSession);
      return { session: nextSession, analysis: seededAnalysis };
    }

    return { session, analysis: seededAnalysis };
  };

  const handleFileUpload = async (file: File) => {
    const key = localStorage.getItem("gemini_api_key");
    if (!key) {
      setPendingFile(file);
      setIsKeyModalOpen(true);
      return;
    }

    setIsAnalyzing(true);
    try {
      const [tableData, base64Data] = await Promise.all([parseTableFile(file), readFileAsBase64(file)]);
      const fileType = tableData.sourceType ?? (file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
      const pendingAnalysis = createPendingAnalysis(file.name, tableData);

      const newSession: TableSession = {
        id: store.createNewSessionId(),
        fileName: file.name,
        fileType,
        fileBase64: base64Data,
        tableData,
        analysisData: pendingAnalysis,
        messages: [],
        createdAt: Date.now(),
      };

      await store.saveSession(newSession);
      await loadSessions();
      await handleSelectSession(newSession.id);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "테이블 업로드 중 오류가 발생했습니다.");
      setIsAnalyzing(false);
    }
  };

  const handleReset = (skipHistory = false) => {
    setFileUrl(null);
    setAnalysisData(null);
    setCurrentSessionId(null);
    setCurrentFileName(undefined);
    setPageNumber(1);
    setIsAnalyzing(false);
    if (!skipHistory) {
      window.history.pushState(null, "", "/");
    }
  };

  const handleSelectSession = async (id: string, skipHistory = false) => {
    const session = await store.getSession(id);
    if (!session) {
      if (!skipHistory) {
        window.history.pushState(null, "", "/");
      }
      return;
    }

    const { session: hydratedSession, analysis } = await hydrateSessionAnalysis(session);

    setFileUrl(`session://${hydratedSession.id}`);
    setCurrentSessionId(hydratedSession.id);
    setCurrentFileName(hydratedSession.fileName);
    setAnalysisData(analysis);

    if (!skipHistory && window.location.pathname !== `/${id}`) {
      window.history.pushState(null, "", `/${id}`);
    }

    if (analysis.tableData && analysis.status !== "complete") {
      void runAnalysisForSession({ ...hydratedSession, analysisData: analysis });
    } else {
      setIsAnalyzing(false);
    }
  };

  const runAnalysisForSession = async (
    session: TableSession,
    options?: {
      layoutPromptOverride?: string;
    }
  ) => {
    const apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    const baseAnalysis = session.analysisData?.tableData
      ? mergeAnalysisSeed(session.fileName, session.analysisData)
      : null;

    if (!baseAnalysis?.tableData || !baseAnalysis.tableContext) {
      setAnalysisData(createUnsupportedAnalysis(session.fileName));
      setIsAnalyzing(false);
      return;
    }

    setAnalysisData(baseAnalysis);
    setIsAnalyzing(true);

    try {
      const layoutPromptInstruction = options?.layoutPromptOverride?.trim() || layoutSystemPrompt?.trim() || DEFAULT_LAYOUT_SYSTEM_PROMPT;
      const systemInstruction = `당신은 데이터 분석가이자 인포그래픽 기획자입니다. 제공된 정규화 테이블을 읽고 아래 JSON 구조로만 답변하세요.

{
  "title": "데이터셋 핵심을 18자 내외로 요약한 제목",
  "summaries": [
    {
      "title": "핵심 인사이트",
      "lines": [
        { "text": "가장 중요한 패턴 또는 비교 1개", "pages": [] },
        { "text": "가장 중요한 패턴 또는 비교 1개", "pages": [] },
        { "text": "가장 중요한 패턴 또는 비교 1개", "pages": [] }
      ]
    },
    {
      "title": "데이터 스토리",
      "lines": [
        { "text": "표를 읽을 때 필요한 맥락", "pages": [] },
        { "text": "성과/리스크/기회 중 중요한 내용", "pages": [] },
        { "text": "의사결정을 위한 한 줄 제안", "pages": [] }
      ]
    }
  ],
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4"],
  "insights": "표의 수치만으로 바로 답할 수 있는 짧은 질문 3개를 줄바꿈으로 구분",
  "issues": [
    { "text": "비어있는 값, 이상치, 해석상 주의점", "pages": [] },
    { "text": "추가 확인이 필요한 컬럼 또는 패턴", "pages": [] }
  ],
  "layoutPlans": [
    {
      "id": "layout-option-1",
      "name": "시안 1",
      "description": "가장 중요한 비교 차트를 메인으로 배치한 시안",
      "layoutType": "dashboard",
      "aspectRatio": "portrait",
      "sections": [
        {
          "id": "header",
          "type": "header",
          "title": "상단 제목 영역"
        },
        {
          "id": "main-chart-group",
          "type": "chart-group",
          "title": "핵심 비교 차트 영역",
          "charts": [
            {
              "id": "main-chart",
              "chartType": "bar",
              "title": "가장 중요한 차트 제목",
              "goal": "무엇을 비교/설명하는 차트인지",
              "dimension": "비교 기준 컬럼",
              "metric": "핵심 수치 컬럼"
            }
          ]
        }
      ],
      "visualPolicy": {
        "textRatio": 0.15,
        "chartRatio": 0.75,
        "iconRatio": 0.1
      }
    },
    {
      "id": "layout-option-2",
      "name": "시안 2",
      "description": "KPI 카드와 보조 차트를 섞어 핵심 수치를 먼저 보여주는 시안",
      "layoutType": "dashboard",
      "aspectRatio": "portrait",
      "sections": [
        {
          "id": "header-2",
          "type": "header",
          "title": "핵심 수치 요약 영역"
        },
        {
          "id": "kpi-group-2",
          "type": "kpi-group",
          "title": "상단 KPI 카드 영역",
          "items": [
            { "label": "대표 지표 1", "value": "원본 수치 기반" },
            { "label": "대표 지표 2", "value": "원본 수치 기반" },
            { "label": "대표 지표 3", "value": "원본 수치 기반" }
          ]
        },
        {
          "id": "support-chart-group-2",
          "type": "chart-group",
          "title": "보조 비교 차트 영역",
          "charts": [
            {
              "id": "support-chart-2",
              "chartType": "line",
              "title": "추세를 보여주는 보조 차트 제목",
              "goal": "시간 흐름 또는 순서 변화 설명",
              "dimension": "구간 또는 범주 컬럼",
              "metric": "변화량 수치 컬럼"
            }
          ]
        }
      ],
      "visualPolicy": {
        "textRatio": 0.2,
        "chartRatio": 0.65,
        "iconRatio": 0.15
      }
    },
    {
      "id": "layout-option-3",
      "name": "시안 3",
      "description": "반복 섹션 구조로 항목별 비교를 연속해서 보여주는 시안",
      "layoutType": "dashboard",
      "aspectRatio": "portrait",
      "sections": [
        {
          "id": "header-3",
          "type": "header",
          "title": "항목별 반복 비교 영역"
        },
        {
          "id": "repeat-chart-group-3",
          "type": "chart-group",
          "title": "항목 반복 비교 차트 영역",
          "charts": [
            {
              "id": "repeat-chart-3",
              "chartType": "stacked-bar",
              "title": "항목별 구성비 비교 차트 제목",
              "goal": "항목 간 구성을 동시에 비교",
              "dimension": "대표 범주 컬럼",
              "metric": "핵심 합산 수치 컬럼"
            }
          ]
        },
        {
          "id": "note-3",
          "type": "takeaway",
          "title": "핵심 해석 메모",
          "note": "차트 아래에 바로 읽히는 해석을 배치"
        }
      ],
      "visualPolicy": {
        "textRatio": 0.18,
        "chartRatio": 0.7,
        "iconRatio": 0.12
      }
    }
  ],
  "infographicPrompt": "이 데이터를 인포그래픽으로 만들기 위한 구체적인 한국어 프롬프트"
}

공통 규칙:
1. summaries[0]은 반드시 3개 line을 채우세요.
2. 모든 pages는 빈 배열 []로 유지하세요.
3. insights는 질문만 3줄로 작성하고 번호나 불릿을 붙이지 마세요.
4. infographicPrompt는 차트 유형, 강조 지표, 시각적 톤을 포함한 실무형 프롬프트로 작성하세요.
5. 반드시 한국어 JSON만 반환하고 다른 설명은 금지합니다.
6. layoutPlans의 각 시안은 sections를 비워두면 안 되며, 최소 1개의 chart-group과 그 안의 유효한 charts를 포함해야 합니다.

레이아웃 생성 시스템 프롬프트:
${layoutPromptInstruction}`;

      const payload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `다음은 정규화된 표 데이터입니다. 이 데이터를 바탕으로 인사이트와 인포그래픽 기획 결과를 JSON으로 정리해주세요.\n\n${baseAnalysis.tableContext}`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("AI API Error:", response.status, errorText);
        throw new Error(`AI API error: ${response.statusText}`);
      }

      const responseData = await response.json();
      const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error("No response from AI API");
      }

      const parsed = JSON.parse(responseText) as {
         title?: unknown;
         summaries?: unknown;
         keywords?: unknown;
         insights?: unknown;
         issues?: unknown;
         layoutPlans?: unknown;
         layoutPlan?: unknown;
         infographicPrompt?: unknown;
       };

      const normalizedLayoutPlans =
        normalizeLayoutPlans(parsed.layoutPlans ?? parsed.layoutPlan) ??
        baseAnalysis.generatedLayoutPlans ??
        (baseAnalysis.generatedLayoutPlan ? [baseAnalysis.generatedLayoutPlan] : baseAnalysis.layoutPlan ? [baseAnalysis.layoutPlan] : undefined);
      const selectedLayoutPlan = getSelectedLayoutPlan(
        normalizedLayoutPlans,
        baseAnalysis.selectedLayoutPlanId,
        baseAnalysis.layoutPlan ?? baseAnalysis.generatedLayoutPlan
      );
      const generatedInfographicPrompt =
        typeof parsed.infographicPrompt === "string"
          ? parsed.infographicPrompt.trim()
          : baseAnalysis.generatedInfographicPrompt ?? baseAnalysis.infographicPrompt ?? "";

      const normalizedData: AnalysisData = {
        title:
          typeof parsed.title === "string" && parsed.title.trim()
            ? parsed.title.trim()
            : baseAnalysis.title || getDatasetTitle(session.fileName),
        summaries: normalizeSummaries(parsed.summaries),
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.filter((keyword): keyword is string => typeof keyword === "string" && keyword.trim().length > 0)
          : [],
        insights: typeof parsed.insights === "string" ? parsed.insights.trim() : "",
        issues: normalizeIssues(parsed.issues),
        generatedLayoutPlans: normalizedLayoutPlans,
        selectedLayoutPlanId: selectedLayoutPlan?.id,
        generatedLayoutPlan: normalizedLayoutPlans?.[0] ?? selectedLayoutPlan,
        layoutPlan: selectedLayoutPlan,
        generatedInfographicPrompt,
        infographicPrompt: generatedInfographicPrompt,
        tableData: baseAnalysis.tableData,
        tableContext: baseAnalysis.tableContext,
        status: "complete",
      };

      const updatedSession = { ...session, analysisData: normalizedData };
      await store.saveSession(updatedSession);
      setAnalysisData(normalizedData);
      await loadSessions();
    } catch (error) {
      console.error(error);
      alert(
        "테이블 인사이트를 생성하는 중 오류가 발생했습니다: " +
          (error instanceof Error ? error.message : "API 통신 오류. 키가 올바른지 확인해주세요.")
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRegenerateLayoutCandidates = async (layoutPromptOverride: string) => {
    if (!currentSessionId) return;

    const session = await store.getSession(currentSessionId);
    if (!session) return;

    const { session: hydratedSession, analysis } = await hydrateSessionAnalysis(session);
    await runAnalysisForSession(
      { ...hydratedSession, analysisData: analysis },
      { layoutPromptOverride }
    );
  };

  const handleDeleteSession = async (id: string) => {
    await store.deleteSession(id);
    if (currentSessionId === id) {
      handleReset();
    }
    await loadSessions();
  };

  const handleCitationClick = (page: number) => {
    setPageNumber(page);
  };

  const isSessionPage = Boolean(fileUrl && currentSessionId);
  const panelTitle = analysisData?.title?.trim() || currentFileName || "테이블 세션";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 text-gray-900 font-sans">
      <ApiKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        onSave={() => {
          setIsKeyModalOpen(false);
          if (pendingFile) {
            void handleFileUpload(pendingFile);
            setPendingFile(null);
          } else if (currentSessionId && !hasCompleteAnalysis(analysisData)) {
            void handleSelectSession(currentSessionId);
          }
        }}
      />

      <Sidebar
        isOpen={isSidebarOpen}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={(id) => {
          void handleSelectSession(id);
        }}
        onDelete={handleDeleteSession}
        onNew={() => handleReset()}
        onClose={() => setIsSidebarOpen(false)}
      />

      {!isSessionPage && (
        <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/80 h-16 shrink-0 flex items-center px-4 sm:px-6 shadow-sm z-30">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 mr-3 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-blue-600 to-indigo-600 flex flex-col items-center justify-center mr-3 shadow-md">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-linear-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent tracking-tight">
              <span className="text-blue-600 font-extrabold">TABLE AI</span> Studio
            </h1>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {fileUrl && (
              <button
                type="button"
                onClick={() => handleReset()}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg px-4 py-2 transition-colors flex items-center shadow-sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                새 표 분석
              </button>
            )}
          </div>
        </header>
      )}

      <main className="flex-1 overflow-hidden relative">
        {!fileUrl ? (
          <div className="absolute inset-0 max-w-5xl mx-auto flex flex-col items-center justify-center p-6 sm:p-12 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-full">
              <div className="text-center mb-12">
                <div className="inline-flex items-center justify-center bg-blue-100/50 text-blue-700 rounded-full px-4 py-1.5 mb-6 text-sm font-semibold tracking-wide border border-blue-200 shadow-sm">
                  AI 인포그래픽 생성
                </div>
                <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight leading-tight">
                  표 데이터 업로드해서 <br className="hidden sm:block" />
                  <span className="bg-linear-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">인포그래픽</span>을 만들어보세요
                </h2>
                <p className="text-lg text-gray-500 font-medium max-w-3xl mx-auto leading-relaxed">
                  복잡한 표 데이터를 정리하고, 시각화 아이디어와 인포그래픽을 바로 확인할 수 있습니다.
                </p>
              </div>
              <div className="max-w-4xl mx-auto px-4">
                <TableUploader onFileUpload={handleFileUpload} isLoading={isAnalyzing} />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full w-full p-2 lg:p-4 bg-gray-50/80 animate-in fade-in zoom-in-95 duration-700 relative">
            <PanelGroup autoSaveId="table-panel-layout" direction="horizontal" className="h-full w-full rounded-2xl overflow-hidden border border-gray-200/60 bg-white">
              <Panel defaultSize={60} minSize={30} className="relative z-10">
                <LeftPanel
                  fileUrl={fileUrl}
                  sessionId={currentSessionId}
                  pageNumber={pageNumber}
                  analysisData={analysisData}
                  rawFileName={currentFileName}
                  onOpenSidebar={isSessionPage ? () => setIsSidebarOpen(true) : undefined}
                  onPageChange={setPageNumber}
                />
              </Panel>

              <PanelResizeHandle className="w-2 md:w-3 bg-gray-50 hover:bg-blue-50 transition-colors flex items-center justify-center cursor-col-resize z-20 group border-x border-gray-200/50">
                <div className="h-8 w-1 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors" />
              </PanelResizeHandle>

              <Panel defaultSize={40} minSize={15}>
                <RightPanel
                  analysisData={analysisData}
                  isAnalyzing={isAnalyzing}
                  sessionId={currentSessionId}
                  fileName={panelTitle}
                  onRegenerateLayoutCandidates={handleRegenerateLayoutCandidates}
                  onCitationClick={handleCitationClick}
                />
              </Panel>
            </PanelGroup>
          </div>
        )}
      </main>
    </div>
  );
}
