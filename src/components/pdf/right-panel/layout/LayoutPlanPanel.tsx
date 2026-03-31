"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_LAYOUT_SYSTEM_PROMPT } from "@/lib/layout-prompts";
import { store } from "@/lib/store";
import type { AnalysisData, LayoutPlan, LayoutSection, LayoutSectionType } from "@/lib/session-types";

const SECTION_TYPE_LABELS: Record<LayoutSectionType, string> = {
  header: "헤더",
  "chart-group": "차트 그룹",
  "kpi-group": "KPI 그룹",
  takeaway: "결론",
  note: "노트",
};

interface LayoutPlanPanelProps {
  sessionId?: string | null;
  analysisData: AnalysisData | null;
  isAnalyzing?: boolean;
}

function cloneLayoutPlan(layoutPlan?: LayoutPlan | null): LayoutPlan | null {
  return layoutPlan
    ? {
        ...layoutPlan,
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

export function LayoutPlanPanel({ sessionId, analysisData, isAnalyzing }: LayoutPlanPanelProps) {
  const setAnalysisData = useAppStore((s) => s.setAnalysisData);
  const layoutSystemPrompt = useAppStore((s) => s.layoutSystemPrompt);
  const setLayoutSystemPrompt = useAppStore((s) => s.setLayoutSystemPrompt);
  const candidates = useMemo(() => resolveLayoutPlans(analysisData), [analysisData]);
  const selectedPlan = useMemo(() => getSelectedPlan(analysisData, candidates), [analysisData, candidates]);
  const [promptDraft, setPromptDraft] = useState(layoutSystemPrompt);

  useEffect(() => {
    setPromptDraft(layoutSystemPrompt);
  }, [layoutSystemPrompt]);

  const selectCandidate = useCallback(
    async (candidate: LayoutPlan) => {
      if (!analysisData) return;

      const nextAnalysisData: AnalysisData = {
        ...analysisData,
        generatedLayoutPlans: candidates,
        selectedLayoutPlanId: candidate.id,
        generatedLayoutPlan: analysisData.generatedLayoutPlan ?? candidates[0] ?? candidate,
        layoutPlan: cloneLayoutPlan(candidate) ?? candidate,
      };

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
    [analysisData, candidates, sessionId, setAnalysisData]
  );

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
                  onClick={() => setLayoutSystemPrompt(promptDraft.trim() || DEFAULT_LAYOUT_SYSTEM_PROMPT)}
                  className="inline-flex items-center rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                  프롬프트 저장
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
                <p className="mt-1 text-[12px] leading-relaxed text-gray-500">먼저 AI가 만든 여러 시안 중 하나를 고르고, 그다음 이미지를 생성합니다. 세부 수정보다는 선택이 우선입니다.</p>
              </div>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10.5px] font-medium text-gray-500">{candidates.length}개 시안</span>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              {candidates.map((candidate, index) => {
                const isSelected = selectedPlan.id === candidate.id;
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
                    <div className="mt-3 inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-medium text-gray-500">
                      {candidate.sections.filter((section) => section.type === "chart-group").length}개 차트 섹션
                    </div>

                    <div className="mt-4 overflow-hidden rounded-[24px] border border-gray-200 bg-[#f7f8fb] p-3 shadow-inner md:p-4">
                      <VisualDraftBoard plan={candidate} analysisData={analysisData} compact />
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
