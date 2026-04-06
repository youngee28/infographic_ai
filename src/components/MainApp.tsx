"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Menu, Sparkles } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useAppStore } from "@/lib/app-store";
import { normalizeAnalysisData } from "@/lib/analysis-schema";
import { mergeTableInterpretations, validateSheetStructure } from "@/lib/analysis-pipeline";
import { buildChartRecommendationsForLogicalTables, rerankLayoutPlansByRecommendations } from "@/lib/chart-recommendation";
import { DEFAULT_LAYOUT_SYSTEM_PROMPT } from "@/lib/layout-prompts";
import { buildLogicalTableIdAliasMap, resolveLogicalTableId, resolveLogicalTableIds } from "@/lib/table-id-resolution";
import { store, type TableSession } from "@/lib/store";
import type {
  AnalysisData,
  AnalysisSheetStructure,
  AnalysisStructuredTable,
  ChartRecommendation,
  LayoutAspectRatio,
  LayoutChartType,
  LayoutGeometry,
  LayoutPlan,
  LayoutSectionType,
  RawSheetGrid,
  ReferenceLine,
  SourceTable,
  SummaryVariant,
  TableInterpretationResult,
} from "@/lib/session-types";
import { formatSlicedGrid, parseRawGridBase64, parseRawGridFile, serializeRawGridForGemini, sliceGridByRange } from "@/lib/table-parser";
import {
  buildLayoutDataSnippet,
  buildTableContext,
  getDatasetTitle,
  parseTableFile,
  syncPrimaryLogicalTableToTopLevel,
  type LayoutDataSnippet,
  type TableData,
  updateLogicalTableCell,
  updateLogicalTableHeader,
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

function findFirstJsonBoundary(input: string): { jsonText: string; trailingText: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const opening = trimmed[0];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (!closing) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (character === "\\") {
        escaping = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === opening) {
      depth += 1;
      continue;
    }

    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return {
          jsonText: trimmed.slice(0, index + 1),
          trailingText: trimmed.slice(index + 1).trim(),
        };
      }
    }
  }

  return null;
}

function isUnsafeTrailingJsonText(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("```");
}

function parseGeminiJsonResponse<T>(text: string, context: { model: string }): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Gemini returned an empty JSON payload.");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (directParseError) {
    const boundary = findFirstJsonBoundary(trimmed);
    if (boundary) {
      const salvaged = tryParseJson<T>(boundary.jsonText);
      if (salvaged.ok && !isUnsafeTrailingJsonText(boundary.trailingText)) {
        if (boundary.trailingText) {
          console.warn("[Gemini JSON] Ignored trailing text after JSON response.", {
            model: context.model,
            trailingLength: boundary.trailingText.length,
          });
        }
        return salvaged.value;
      }
    }

    console.error("[Gemini JSON] Failed to parse model response.", {
      model: context.model,
      responseLength: trimmed.length,
      error: directParseError instanceof Error ? directParseError.message : String(directParseError),
    });

    throw new Error(`Gemini returned malformed JSON for model ${context.model}. Check console metadata for details.`);
  }
}

function tryParseJson<T>(value: string): { ok: true; value: T } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(value) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

interface LayoutTableBrief {
  tableId: string;
  name: string;
  role: SourceTable["role"];
  structure: AnalysisStructuredTable["structure"];
  headerSummary?: string;
  rangeLabel?: string;
  dimensions: string[];
  metrics: string[];
  chartHint?: {
    chartType: ChartRecommendation["chartType"];
    dimension?: string;
    metric?: string;
    goal: string;
  };
  dataSnippet?: LayoutDataSnippet;
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

function normalizeLayoutGeometry(value: unknown): LayoutGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) {
    return undefined;
  }

  const x = Math.max(0, Math.min(100, candidate.x));
  const y = Math.max(0, Math.min(100, candidate.y));
  const width = Math.max(1, Math.min(100 - x, candidate.width));
  const height = Math.max(1, Math.min(100 - y, candidate.height));
  return { x, y, width, height };
}

function normalizeLayoutPlan(value: unknown, fallbackId?: string): LayoutPlan | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    layoutType?: unknown;
    layoutIntent?: unknown;
    aspectRatio?: unknown;
    headerTitleLayout?: unknown;
    headerSummaryLayout?: unknown;
    sections?: unknown;
    visualPolicy?: unknown;
    previewImageDataUrl?: unknown;
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
          sectionRole?: unknown;
          sourceTableIds?: unknown;
          title?: unknown;
          layout?: unknown;
          titleLayout?: unknown;
          charts?: unknown;
          items?: unknown;
          note?: unknown;
          noteLayout?: unknown;
        };

        const type = normalizeLayoutSectionType(sectionCandidate.type);

        if (!type) return [];

        const charts = Array.isArray(sectionCandidate.charts)
          ? sectionCandidate.charts.flatMap((chart, chartIndex) => {
              if (!chart || typeof chart !== "object") return [];
              const chartCandidate = chart as {
                id?: unknown;
                tableId?: unknown;
                chartType?: unknown;
                title?: unknown;
                goal?: unknown;
                dimension?: unknown;
                metric?: unknown;
                layout?: unknown;
              };

              const chartType = isLayoutChartType(chartCandidate.chartType) ? chartCandidate.chartType : undefined;
              const title = normalizeNonEmptyString(chartCandidate.title);
              const goal = normalizeNonEmptyString(chartCandidate.goal);

              if (!chartType || !title || !goal) return [];

              return [
                {
                  id: normalizeNonEmptyString(chartCandidate.id) ?? `chart-${index + 1}-${chartIndex + 1}`,
                  tableId: normalizeNonEmptyString(chartCandidate.tableId),
                  chartType,
                  title,
                  goal,
                  dimension: normalizeNonEmptyString(chartCandidate.dimension),
                  metric: normalizeNonEmptyString(chartCandidate.metric),
                  layout: normalizeLayoutGeometry(chartCandidate.layout),
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
                    tableId: normalizeNonEmptyString((sectionCandidate as { tableId?: unknown }).tableId),
                    chartType,
                    title,
                    goal,
                    dimension: normalizeNonEmptyString((sectionCandidate as { dimension?: unknown }).dimension),
                    metric: normalizeNonEmptyString((sectionCandidate as { metric?: unknown }).metric),
                    layout: normalizeLayoutGeometry((sectionCandidate as { layout?: unknown }).layout),
                  },
                ];
              })()
          : undefined;

        const items = Array.isArray(sectionCandidate.items)
          ? sectionCandidate.items.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const itemCandidate = item as { tableId?: unknown; label?: unknown; value?: unknown; layout?: unknown };
              const label = normalizeNonEmptyString(itemCandidate.label);
              const itemValue = normalizeNonEmptyString(itemCandidate.value);
              return label && itemValue
                ? [{
                    id: `item-${index + 1}-${label}`,
                    tableId: normalizeNonEmptyString(itemCandidate.tableId),
                    label,
                    value: itemValue,
                    layout: normalizeLayoutGeometry(itemCandidate.layout),
                  }]
                : [];
            })
          : undefined;

        return [
          {
            id: normalizeNonEmptyString(sectionCandidate.id) ?? `section-${index + 1}`,
            type,
            sectionRole: normalizeNonEmptyString(sectionCandidate.sectionRole),
            sourceTableIds: Array.isArray(sectionCandidate.sourceTableIds)
              ? sectionCandidate.sourceTableIds.flatMap((tableId) => (typeof tableId === "string" && tableId.trim() ? [tableId.trim()] : []))
              : undefined,
            title: normalizeNonEmptyString(sectionCandidate.title),
            layout: normalizeLayoutGeometry(sectionCandidate.layout),
            titleLayout: normalizeLayoutGeometry(sectionCandidate.titleLayout),
            charts: charts && charts.length > 0 ? charts : undefined,
            items: items && items.length > 0 ? items : undefined,
            note: normalizeNonEmptyString(sectionCandidate.note),
            noteLayout: normalizeLayoutGeometry(sectionCandidate.noteLayout),
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
    id: normalizeNonEmptyString((candidate as { id?: unknown }).id) ?? fallbackId ?? "layout-option",
    layoutType,
    layoutIntent: normalizeNonEmptyString(candidate.layoutIntent),
    aspectRatio,
    name: normalizeNonEmptyString((candidate as { name?: unknown }).name),
    description: normalizeNonEmptyString((candidate as { description?: unknown }).description),
    previewImageDataUrl: normalizeNonEmptyString((candidate as { previewImageDataUrl?: unknown }).previewImageDataUrl),
    headerTitleLayout: normalizeLayoutGeometry(candidate.headerTitleLayout),
    headerSummaryLayout: normalizeLayoutGeometry(candidate.headerSummaryLayout),
    sections,
    visualPolicy,
  };
}

function normalizeLayoutPlans(value: unknown): LayoutPlan[] | undefined {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  const plans = candidates
    .map((candidate, index) => normalizeLayoutPlan(candidate, `layout-option-${index + 1}`))
    .filter((plan): plan is LayoutPlan => plan !== undefined)
    .map((plan, index) => ({
      ...plan,
      id: plan.id || `layout-option-${index + 1}`,
      name: plan.name || `시안 ${index + 1}`,
      description:
        plan.description ||
        `${plan.aspectRatio === "portrait" ? "세로형" : plan.aspectRatio === "landscape" ? "가로형" : "정사각형"} 대시보드 시안`,
    }));

  return plans.length > 0 ? plans : undefined;
}

function getSelectedLayoutPlan(
  layoutPlans: LayoutPlan[] | undefined,
  selectedLayoutPlanId?: string,
  fallbackPlan?: LayoutPlan
): LayoutPlan | undefined {
  if (layoutPlans && layoutPlans.length > 0) {
    if (selectedLayoutPlanId) {
      const selectedPlan = layoutPlans.find((plan) => plan.id === selectedLayoutPlanId);
      if (selectedPlan) {
        return selectedPlan;
      }
    }

    if (fallbackPlan) {
      const fallbackChartSignature = JSON.stringify(
        fallbackPlan.sections.flatMap((section) =>
          (section.charts ?? []).map((chart) => ({
            chartType: chart.chartType,
            dimension: chart.dimension ?? "",
            metric: chart.metric ?? "",
          }))
        )
      );

      const semanticallyMatchedPlan = layoutPlans.find((plan) => {
        const planChartSignature = JSON.stringify(
          plan.sections.flatMap((section) =>
            (section.charts ?? []).map((chart) => ({
              chartType: chart.chartType,
              dimension: chart.dimension ?? "",
              metric: chart.metric ?? "",
            }))
          )
        );
        return planChartSignature === fallbackChartSignature;
      });

      if (semanticallyMatchedPlan) {
        return semanticallyMatchedPlan;
      }
    }

    return layoutPlans[0];
  }
  return fallbackPlan;
}

function buildSourceInventory(fileName: string, tableData: TableData) {
  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    const primaryLogicalTableId = tableData.primaryLogicalTableId ?? tableData.logicalTables[0]?.id;
    return {
      tables: tableData.logicalTables.map((table) => ({
        id: table.id,
        name: table.name,
        role: table.id === primaryLogicalTableId ? "primary" as const : table.orientation === "column-major" ? "reference" as const : "supporting" as const,
        purpose:
          (table.localStructureHint?.winner ?? table.orientation) === "mixed"
            ? "행/열 헤더가 혼합된 표 구조를 파악합니다."
            : table.orientation === "column-major"
              ? "열 기준 항목 구조를 파악합니다."
              : "행 기준 레코드 구조를 파악합니다.",
        context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열에서 감지한 논리 표입니다.`,
        dimensions: table.columns.slice(0, 2),
        metrics: table.columns.slice(2),
        grain: table.localStructureHint?.winner ?? table.orientation,
        structure: table.localStructureHint?.winner ?? table.orientation,
      })),
      relations: [],
    };
  }

  return {
    tables: [
      {
        id: "table-1",
        name: tableData.sheetName?.trim() || getDatasetTitle(fileName),
        role: "primary" as const,
        purpose: "업로드된 표의 핵심 구조와 수치를 파악합니다.",
        context: `전체 표 ${tableData.rowCount}행 × ${tableData.columnCount}열 구조를 해석하기 위한 기본 표입니다.`,
        dimensions: tableData.columns.slice(0, 2),
        metrics: tableData.columns.slice(2),
        grain: tableData.sheetName ? "sheet" : undefined,
      },
    ],
    relations: [],
  };
}

function buildInitialSheetStructure(fileName: string, tableData: TableData): AnalysisSheetStructure {
  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    return {
      sheetName: tableData.sheetName,
      tableCount: tableData.logicalTables.length,
      tables: tableData.logicalTables.map((table) => ({
        id: table.id,
        title: table.name,
        structure: table.localStructureHint?.winner ?? table.orientation,
        confidence: table.localStructureHint?.confidence ?? table.confidence,
        range: {
          startRow: table.startRow,
          endRow: table.endRow,
          startCol: table.startCol,
          endCol: table.endCol,
        },
        header: {
          axis: table.localStructureHint?.headerAxis ?? (table.headerAxis === "row" ? "row" : table.headerAxis === "column" ? "column" : "ambiguous"),
          headerRows: table.localStructureHint?.headerRows,
          headerCols: table.localStructureHint?.headerCols,
        },
        dataRegion: table.localStructureHint?.dataRegion,
        dimensions: table.columns.slice(0, 2),
        metrics: table.columns.slice(2),
        notes: table.normalizationNotes,
        candidates: table.localStructureHint?.candidates?.map((candidate) => ({
          range: {
            startRow: table.startRow,
            endRow: table.endRow,
            startCol: table.startCol,
            endCol: table.endCol,
          },
          structure: candidate.structure,
          confidence: candidate.confidence,
          reason: candidate.reason,
        })),
        reviewReasons: table.localStructureHint?.reviewReasons,
        needsReview: (table.localStructureHint?.reviewReasons?.length ?? 0) > 0,
      })),
    };
  }

  return {
    sheetName: tableData.sheetName,
    tableCount: tableData.rowCount > 0 ? 1 : 0,
    tables: tableData.rowCount > 0
      ? [{
          id: "table-1",
          title: tableData.sheetName?.trim() || getDatasetTitle(fileName),
          structure: "ambiguous" as const,
          confidence: 0.4,
          range: {
            startRow: 1,
            endRow: Math.max(1, tableData.rowCount + 1),
            startCol: 1,
            endCol: Math.max(1, tableData.columnCount),
          },
          header: { axis: "ambiguous" as const },
          dimensions: tableData.columns.slice(0, 2),
          metrics: tableData.columns.slice(2),
        }]
      : [],
  };
}

function serializeFallbackGridFromTableData(tableData: TableData): string {
  return serializeRawGridForGemini({
    fileType: tableData.sourceType ?? "csv",
    sheetName: tableData.sheetName,
    rows: [tableData.columns, ...tableData.rows],
    rowCount: tableData.rowCount + 1,
    columnCount: tableData.columnCount,
  });
}

function getSelectedSourceTableIds(
  tableData: TableData,
  existing?: string[],
  sheetStructure?: AnalysisSheetStructure,
  sourceTables?: SourceTable[]
): string[] {
  const aliases = buildLogicalTableIdAliasMap({ tableData, sheetStructure, sourceTables });

  if (existing) {
    const resolved = resolveLogicalTableIds(existing, aliases);
    if (resolved.length > 0) {
      return resolved;
    }
    if (existing.length > 0 && (tableData.logicalTables ?? []).length === 0) {
      return Array.from(new Set(existing));
    }
    if (existing.length > 0) {
      return [];
    }
  }

  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    return tableData.logicalTables.map((table) => table.id);
  }

  return [tableData.primaryLogicalTableId ?? "table-1"];
}

function canonicalizeNarrativeItems(items: AnalysisData["findings"], aliases: Map<string, string>) {
  return (items ?? []).map((item) => ({
    ...item,
    sourceTableIds: resolveLogicalTableIds(item.sourceTableIds, aliases),
    evidence: item.evidence.map((entry) => ({
      ...entry,
      tableId: resolveLogicalTableId(entry.tableId, aliases) ?? entry.tableId,
    })),
  }));
}

function canonicalizeInterpretationResults(
  results: TableInterpretationResult[],
  aliases: Map<string, string>
): TableInterpretationResult[] {
  return results.map((result) => ({
    ...result,
    tableId: resolveLogicalTableId(result.tableId, aliases) ?? result.tableId,
    findings: canonicalizeNarrativeItems(result.findings, aliases),
    implications: canonicalizeNarrativeItems(result.implications, aliases),
    cautions: canonicalizeNarrativeItems(result.cautions, aliases),
  }));
}

function canonicalizeLayoutPlans(layoutPlans: LayoutPlan[] | undefined, aliases: Map<string, string>): LayoutPlan[] | undefined {
  return layoutPlans?.map((plan) => ({
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      sourceTableIds: section.sourceTableIds
        ? resolveLogicalTableIds(section.sourceTableIds, aliases)
        : section.sourceTableIds,
      charts: section.charts?.map((chart) => ({
        ...chart,
        tableId: resolveLogicalTableId(chart.tableId, aliases) ?? chart.tableId,
      })),
      items: section.items?.map((item) => ({
        ...item,
        tableId: resolveLogicalTableId(item.tableId, aliases) ?? item.tableId,
      })),
    })),
  }));
}

async function callGeminiJson<T>(apiKey: string, model: string, prompt: string): Promise<T> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("No JSON response from Gemini");
  }

  return parseGeminiJsonResponse<T>(text, { model });
}

function buildLocalStructureHints(tableData?: TableData): string {
  const logicalTables = tableData?.logicalTables ?? [];
  if (logicalTables.length === 0) return "";

  return logicalTables
    .map((table) => {
      const hint = table.localStructureHint;
      if (!hint) {
        return `- ${table.id}: no local structure hint`;
      }

      const scores = `row=${hint.scores["row-major"].toFixed(2)}, column=${hint.scores["column-major"].toFixed(2)}, mixed=${hint.scores.mixed.toFixed(2)}, ambiguous=${hint.scores.ambiguous.toFixed(2)}`;
      const headerRows = hint.headerRows?.join(",") || "-";
      const headerCols = hint.headerCols?.join(",") || "-";
      const dataRegion = hint.dataRegion
        ? `R${hint.dataRegion.startRow}-R${hint.dataRegion.endRow} / C${hint.dataRegion.startCol}-C${hint.dataRegion.endCol}`
        : "-";
      const reasons = hint.reviewReasons?.join(" | ") || "none";

      return `- ${table.id}: range=R${table.startRow}-R${table.endRow} / C${table.startCol}-C${table.endCol}, winner=${hint.winner}, confidence=${hint.confidence.toFixed(2)}, scores=[${scores}], headerAxis=${hint.headerAxis}, headerRows=${headerRows}, headerCols=${headerCols}, dataRegion=${dataRegion}, reviewReasons=${reasons}`;
    })
    .join("\n");
}

function buildStructurePrompt(rawGridText: string, tableData?: TableData) {
  const localHints = buildLocalStructureHints(tableData);
  return `당신은 스프레드시트 구조 분석기입니다.

중요:
- 의미 해석, findings, implications, cautions, 차트 추천, 인포그래픽 문구 생성은 절대 하지 마세요.
- 오직 표 구조만 판정하세요.
- row/col 번호는 1-indexed입니다. R1C1이 시트의 첫 번째 셀입니다.
- 첫 번째 비어있지 않은 행을 무조건 헤더로 가정하지 마세요.
- 시트 안에는 표가 하나일 수도, 여러 개일 수도 있습니다.
- structure는 row-major, column-major, mixed, ambiguous 중 하나입니다.
- mixed는 상단 행 헤더와 왼쪽 열 헤더가 동시에 존재하고 실제 수치 데이터가 교차 영역에 있는 경우입니다.
- 제목행, 주석행, 단위행, 그룹 라벨은 데이터 본문과 분리하세요.

반드시 JSON만 반환하세요.

반환 형식:
{
  "schemaVersion": "3",
  "sheetStructure": {
    "sheetName": "Sheet1",
    "tableCount": 1,
    "needsReview": false,
    "reviewReason": "",
    "tables": [
      {
        "id": "table-1",
        "title": "표 이름",
        "structure": "mixed",
        "confidence": 0.92,
        "range": { "startRow": 1, "endRow": 10, "startCol": 1, "endCol": 8 },
        "header": { "axis": "mixed", "headerRows": [2], "headerCols": [1, 2] },
        "dataRegion": { "startRow": 3, "endRow": 10, "startCol": 3, "endCol": 8 },
        "dimensions": ["구분", "항목명"],
        "metrics": ["2019", "2020"],
        "notes": ["표 구조 설명"],
        "candidates": []
      }
    ]
  }
}

[LOCAL_HINTS]
${localHints || "- no local hints"}

- 위 LOCAL_HINTS는 로컬 휴리스틱 결과입니다. 그대로 복사하지 말고 RAW GRID를 우선으로 검증하세요.
- row/column/mixed 판단이 애매하면 LOCAL_HINTS의 headerRows/headerCols/dataRegion를 참고해 재검토하세요.

[RAW GRID]
${rawGridText}`.trim();
}

function buildInterpretPrompt(sheetStructure: AnalysisSheetStructure, table: AnalysisStructuredTable, slicedGridText: string) {
  return `당신은 데이터 해석가이자 인포그래픽 기획자입니다.

중요:
- 구조를 다시 판정하지 마세요.
- 전체 시트를 다시 해석하지 마세요.
- 아래의 sheetStructure와 대상 표 구조를 그대로 신뢰하세요.
- 아래 sliced grid만 사용하세요.
- row/col 번호는 sliced grid 내부 기준 1-indexed입니다.

반드시 JSON만 반환하세요.

반환 형식:
{
  "tableId": "${table.id}",
  "findings": [{ "text": "핵심 발견", "sourceTableIds": ["${table.id}"], "evidence": [], "priority": "high" }],
  "implications": [{ "text": "실무 시사점", "sourceTableIds": ["${table.id}"], "evidence": [], "audience": "business" }],
  "cautions": [{ "text": "해석상 유의점", "sourceTableIds": ["${table.id}"], "evidence": [] }],
  "layoutPlans": [],
  "infographicPrompt": "이 표를 인포그래픽으로 요약하는 프롬프트"
}

[판정된 구조]
${JSON.stringify(sheetStructure, null, 2)}

[대상 표]
${JSON.stringify(table, null, 2)}

[해당 range의 sliced grid]
${slicedGridText}`.trim();
}

function formatHeaderSummary(table: AnalysisStructuredTable): string | undefined {
  const axis = table.header.axis;
  if (axis === "mixed") {
    const headerRows = table.header.headerRows?.join(", ") || "-";
    const headerCols = table.header.headerCols?.join(", ") || "-";
    return `상단 ${headerRows}행 + 좌측 ${headerCols}열 헤더`;
  }
  if (axis === "row") {
    return `상단 ${table.header.headerRows?.join(", ") || "-"}행 헤더`;
  }
  if (axis === "column") {
    return `좌측 ${table.header.headerCols?.join(", ") || "-"}열 헤더`;
  }
  return undefined;
}

function formatRangeLabel(table: AnalysisStructuredTable): string {
  return `R${table.range.startRow}-R${table.range.endRow} / C${table.range.startCol}-C${table.range.endCol}`;
}

function getBestChartHintForTable(params: {
  chartRecommendations?: AnalysisData["chartRecommendations"];
  tableId: string;
  aliases: Map<string, string>;
  tableData?: TableData;
}): LayoutTableBrief["chartHint"] {
  const matchingRecommendations = (params.chartRecommendations ?? [])
    .flatMap((recommendation) => {
      const resolvedTableId = resolveLogicalTableId(recommendation.tableId, params.aliases) ?? recommendation.tableId;
      if (resolvedTableId !== params.tableId) return [];
      return [{ ...recommendation, tableId: resolvedTableId }];
    })
    .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType));

  const bestRecommendation = matchingRecommendations[0];
  if (bestRecommendation) {
    return {
      chartType: bestRecommendation.chartType,
      dimension: bestRecommendation.dimension,
      metric: bestRecommendation.metric,
      goal: bestRecommendation.reason,
    };
  }

  if (params.tableData) {
    const regenerated = buildChartRecommendationsForLogicalTables(params.tableData, [params.tableId])
      .filter((recommendation) => recommendation.tableId === params.tableId)
      .sort((left, right) => right.score - left.score || left.chartType.localeCompare(right.chartType))[0];
    if (regenerated) {
      return {
        chartType: regenerated.chartType,
        dimension: regenerated.dimension,
        metric: regenerated.metric,
        goal: regenerated.reason,
      };
    }
  }

  return undefined;
}

function buildLayoutTableBriefs(params: {
  sheetStructure: AnalysisSheetStructure;
  selectedSourceTableIds: string[];
  sourceTables?: SourceTable[];
  interpretationResults: TableInterpretationResult[];
  chartRecommendations?: AnalysisData["chartRecommendations"];
  tableData?: TableData;
}): LayoutTableBrief[] {
  const aliases = buildLogicalTableIdAliasMap({
    tableData: params.tableData,
    sheetStructure: params.sheetStructure,
    sourceTables: params.sourceTables,
  });
  const sourceTableById = new Map(
    (params.sourceTables ?? []).map((table) => [resolveLogicalTableId(table.id, aliases) ?? table.id, table])
  );
  const logicalTableById = new Map(
    (params.tableData?.logicalTables ?? []).map((table) => [resolveLogicalTableId(table.id, aliases) ?? table.id, table])
  );
  const selectedIdSet = new Set(params.selectedSourceTableIds);

  return params.sheetStructure.tables
    .flatMap((table) => {
      const resolvedTableId = resolveLogicalTableId(table.id, aliases) ?? table.id;
      if (selectedIdSet.size > 0 && !selectedIdSet.has(resolvedTableId)) return [];

      const sourceTable = sourceTableById.get(resolvedTableId);
      const briefTableData = logicalTableById.get(resolvedTableId)
        ?? (logicalTableById.size === 0 && params.tableData ? params.tableData : undefined);
      return [{
        tableId: resolvedTableId,
        name: sourceTable?.name || table.title,
        role: sourceTable?.role ?? (params.selectedSourceTableIds[0] === resolvedTableId ? "primary" : "supporting"),
        structure: table.structure,
        headerSummary: formatHeaderSummary(table),
        rangeLabel: formatRangeLabel(table),
        dimensions: table.dimensions,
        metrics: table.metrics,
        chartHint: getBestChartHintForTable({
          chartRecommendations: params.chartRecommendations,
          tableId: resolvedTableId,
          aliases,
          tableData: params.tableData,
        }),
        dataSnippet: briefTableData ? buildLayoutDataSnippet(briefTableData) : undefined,
      } satisfies LayoutTableBrief];
    })
    .filter(
      (brief) =>
        brief.dimensions.length > 0 ||
        brief.metrics.length > 0 ||
        brief.chartHint
    );
}

function hasReadyLayoutBriefInputs(params: {
  status?: AnalysisData["status"];
  sheetStructure?: AnalysisSheetStructure;
  reviewReasons?: string[];
  tableInterpretations?: TableInterpretationResult[];
}) {
  if (params.status !== "complete") return false;
  if (!params.sheetStructure || params.sheetStructure.tables.length === 0) return false;
  if (params.sheetStructure.needsReview || (params.reviewReasons?.length ?? 0) > 0) return false;
  return (params.tableInterpretations?.length ?? 0) === params.sheetStructure.tables.length;
}

async function runStructureAnalysis(apiKey: string, model: string, rawGridText: string, tableData?: TableData) {
  return callGeminiJson<{ schemaVersion?: string; sheetStructure?: AnalysisSheetStructure }>(apiKey, model, buildStructurePrompt(rawGridText, tableData));
}

async function runTableInterpretation(
  apiKey: string,
  model: string,
  sheetStructure: AnalysisSheetStructure,
  table: AnalysisStructuredTable,
  slicedGridText: string
) {
  return callGeminiJson<TableInterpretationResult>(apiKey, model, buildInterpretPrompt(sheetStructure, table, slicedGridText));
}

function buildComposeLayoutPrompt(params: {
  title: string;
  sheetStructure: AnalysisSheetStructure;
  layoutTableBriefs: LayoutTableBrief[];
  layoutPromptInstruction: string;
}) {
  const { title, sheetStructure, layoutTableBriefs, layoutPromptInstruction } = params;
  return `## Role
당신은 데이터 스토리텔링 기반 인포그래픽 레이아웃 설계자입니다.

## [Hard Constraints] 반드시 지켜야 합니다
- 레이아웃은 반드시 1개만 반환하세요.
- 선택된 모든 tableId를 최소 1회 이상 레이아웃에 반영하세요.
- layoutType은 반드시 "dashboard"만 사용하세요.
- section.type은 반드시 "header" | "chart-group" 중에서만 선택하세요.
- chart.chartType은 반드시 "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map" 중에서만 선택하세요.
- aspectRatio는 반드시 "portrait" | "square" | "landscape" 중에서만 선택하세요.
- 각 chart에는 가능한 한 tableId를 넣고, 각 section에는 관련 sourceTableIds를 넣으세요.
- dimensions 또는 metrics가 비어 있으면 임의로 축 이름을 추정하지 말고, 구조가 불명확한 표로 취급하세요.
- KPI 카드, takeaway, note, 요약 메모, 핵심 시사점 박스는 만들지 마세요.
- 설명 문단보다 차트와 범례 중심으로 구성하세요.
- section.title, chart.title, plan.name, description은 데이터 의미가 드러나는 구체적인 문장으로 쓰고, "섹션 1", "차트 1", "시안 1" 같은 generic 라벨은 피하세요.
- chart.title과 goal은 반드시 해당 chart의 dimension/metric/tableId와 의미적으로 일치해야 합니다. 제목만 과장되게 앞서가거나 다른 카테고리/다른 지표를 대신 말하면 안 됩니다.
- chart.title이나 section.title에 특정 카테고리명(예: 서울, 경기/인천, 게임/콘텐츠)을 썼다면, 그 카테고리는 반드시 해당 chart가 실제로 보여주는 label 문맥이나 dataSnippet/chartHint의 핵심 근거와 일치해야 합니다.
- 특정 카테고리명을 제목에 쓸 때는 dataSnippet, chartHint, dimensions/metrics 중 최소 하나에서 그 카테고리가 핵심 근거로 드러나야 합니다. 근거가 약하면 개별 카테고리명이 아니라 비교 축 자체(예: 지역별 매출 비중 비교)를 제목으로 쓰세요.
- 지역별/업종별/연도별처럼 비교 축이 분명한 표는 차트 제목과 goal에서 그 차원(dimension)을 보존하세요. metric만 단독으로 말하는 제목(예: "매출액 비중과 기업수 비중")으로 끝내지 마세요.
- 한 chart는 하나의 일관된 해석만 표현해야 합니다. 제목은 경기/인천을 말하면서 실제 값은 서울 수치를 보여주는 식의 혼합을 절대 만들지 마세요.
- JSON만 반환하고, 마크다운 코드블록이나 설명 문장은 포함하지 마세요.

## [Design Basis] 아래 구조와 차트 힌트를 설계의 출발점으로 삼으세요
선택된 표들의 관계는 차트 배치와 제목으로만 드러내고, 별도 요약 박스는 만들지 마세요.

[TITLE]
${title}

[SHEET_STRUCTURE]
${JSON.stringify(sheetStructure, null, 2)}

[TABLE_BRIEFS]
${JSON.stringify(layoutTableBriefs, null, 2)}

## [Soft Guidance] 데이터에 따라 조정 가능한 가이드라인입니다
- TABLE_BRIEFS의 chartHint가 있으면 이를 1순위 차트 추천으로 사용하세요. dataSnippet은 chartHint를 검증하거나 제목/구성 우선순위를 다듬는 보조 근거입니다.
- dataSnippet을 볼 때는 metricSignals의 범위/평균보다 dimensionSignals의 kind/cardinality/topValues를 더 우선해서 해석하세요. 예: date면 line, low-cardinality 범주면 bar/donut/pie, 보조 범주가 분명하면 stacked-bar를 우선 검토하세요.
- dataSnippet의 orientationHint/headerAxisHint/timeAxisLikelyIn/categoryAxisLikelyIn을 축 선택의 핵심 근거로 사용하세요. 특히 timeAxisLikelyIn이 "columns"면 연도 헤더가 가로로 흐르는 표로 보고, column header를 X축으로 우선 사용하세요.
- columnHeaderContainsYear=true 이고 categoryAxisLikelyIn이 "rows"면 첫 열의 카테고리(예: 매출액, 종사자 수)를 X축으로 쓰지 말고, 열 헤더의 시간축을 먼저 사용하세요. 이 경우 카테고리는 별도 시리즈나 비교 대상 후보로 해석하세요.
- rowHeaderContainsYear=true 이고 categoryAxisLikelyIn이 "columns"면 첫 행 또는 첫 열의 연도 축을 우선 시간축으로 사용하고, 열 방향 카테고리는 시리즈나 비교 대상 후보로 해석하세요.
- strongest insight를 고를 때는 키워드가 눈에 띄는 카테고리가 아니라 실제 우세한 값/비중/추세를 우선하세요. 예를 들어 지역별 비중 표라면 가장 큰 점유 지역을 근거 없이 놓치지 마세요.
- 비교형 차트라면 우선 "무엇을 무엇 기준으로 비교하는지"를 제목에 드러내고, 필요할 때만 상위 카테고리명을 덧붙이세요. 단일 카테고리명을 headline으로 쓰는 것은 그 항목이 실제 핵심 포인트일 때만 허용됩니다.
- 출력 전 스스로 점검하세요: (1) 제목에 등장한 카테고리명이 실제 chart의 핵심 label과 일치하는가, (2) chart.dimension이 비교 축을 보존하는가, (3) chart.metric이 제목/goal의 지표 설명과 일치하는가.
- header를 제외한 본문 섹션 수는 2~5개를 기본 범위로 생각하되, 데이터 복잡도에 따라 조정하세요.
- 첫 본문 섹션이 반드시 hero chart-group일 필요는 없지만, 가장 강한 메시지를 가장 먼저 전달하세요.
- 섹션 순서는 차트 비교 흐름이 자연스럽게 읽히도록 구성하세요.
- 상단/중단/하단 수직 배치와 좌우 분할 중, 데이터 비교와 읽기 흐름에 더 맞는 구성을 선택하세요.
- geometry를 확신할 때만 layout/titleLayout/noteLayout 필드를 채우세요. 좌표는 0~100 퍼센트 기준입니다.

## [Metadata] 향후 렌더러가 사용할 의미 힌트를 선택적으로 추가할 수 있습니다
- 각 section에는 선택적으로 sectionRole을 넣을 수 있습니다.
- sectionRole 예시: "HOOK", "EVIDENCE", "CONTEXT", "CONCLUSION"
- 각 plan에는 선택적으로 layoutIntent를 넣을 수 있습니다.
- layoutIntent 예시: "comparison", "timeline", "distribution", "ranking", "summary"
- sectionRole과 layoutIntent는 설명용 metadata일 뿐, 새로운 enum이나 구조를 만들면 안 됩니다.

## [Output Schema]
{
  "layoutPlans": [
    {
      "id": "layout-option-1",
      "name": "시안",
      "description": "선택된 여러 표를 연결한 통합 대시보드",
      "layoutType": "dashboard",
      "layoutIntent": "comparison",
      "aspectRatio": "portrait",
      "sections": [
        {
          "id": "section-1",
          "type": "chart-group",
          "sectionRole": "HOOK",
          "title": "섹션 제목",
          "sourceTableIds": ["table-1", "table-2"],
          "charts": [
            {
              "id": "chart-1",
              "tableId": "table-1",
              "chartType": "bar",
              "title": "차트 제목",
              "goal": "설명 목표",
              "dimension": "차원 열",
              "metric": "지표 열"
            }
          ]
        }
      ],
      "visualPolicy": { "textRatio": 0.15, "chartRatio": 0.75, "iconRatio": 0.1 }
    }
  ],
  "infographicPrompt": "선택된 여러 표를 함께 설명하는 한국어 인포그래픽 프롬프트"
}

## [Layout System Prompt]
${layoutPromptInstruction}
`.trim();
}

async function runComposedLayoutGeneration(
  apiKey: string,
  model: string,
  params: {
    title: string;
    sheetStructure: AnalysisSheetStructure;
    layoutTableBriefs: LayoutTableBrief[];
    chartRecommendations?: AnalysisData["chartRecommendations"];
    layoutPromptInstruction: string;
  }
) {
  return callGeminiJson<{ layoutPlans?: unknown; infographicPrompt?: unknown }>(apiKey, model, buildComposeLayoutPrompt(params));
}

function createPendingAnalysis(fileName: string, tableData: TableData): AnalysisData {
  const title = getDatasetTitle(fileName);
  const tableContext = buildTableContext(tableData);
  return normalizeAnalysisData(
    {
      schemaVersion: "3",
      title,
      dataset: {
        title,
        summary: "",
        tableCount: tableData.logicalTables?.length ?? 1,
        sourceType: tableData.sourceType,
      },
      sheetStructure: buildInitialSheetStructure(fileName, tableData),
      sourceInventory: buildSourceInventory(fileName, tableData),
      findings: [],
      implications: [],
      cautions: [],
      askNext: [],
      summaries: [],
      keywords: [],
      insights: "",
      issues: "",
      selectedSourceTableIds: getSelectedSourceTableIds(tableData),
      chartRecommendations: buildChartRecommendationsForLogicalTables(tableData),
      generatedLayoutPlans: undefined,
      selectedLayoutPlanId: undefined,
      generatedLayoutPlan: undefined,
      layoutPlan: undefined,
      generatedInfographicPrompt: "",
      infographicPrompt: "",
      tableContext,
      tableData,
      status: "pending",
    },
    title
  );
}

function createUnsupportedAnalysis(fileName: string): AnalysisData {
  const title = getDatasetTitle(fileName);
  return normalizeAnalysisData(
    {
      schemaVersion: "3",
      title,
      dataset: {
        title,
        summary: "표 미리보기용 데이터가 없어 새 업로드가 필요합니다.",
        tableCount: 0,
      },
      sourceInventory: {
        tables: [],
        relations: [],
      },
      findings: [
        {
          text: "이 세션은 표 미리보기용 데이터가 없어 새 CSV/XLSX 업로드가 필요합니다.",
          sourceTableIds: [],
          evidence: [],
          priority: "high",
        },
      ],
      implications: [
        {
          text: "새 CSV 또는 XLSX 파일로 다시 업로드하면 왼쪽 표 미리보기와 오른쪽 인포그래픽 인터페이스를 사용할 수 있습니다.",
          sourceTableIds: [],
          evidence: [],
          audience: "general",
        },
      ],
      cautions: [
        {
          text: "이 세션은 이전 형식으로 저장되어 표 인사이트 워크스페이스에 바로 복원할 수 없습니다.",
          sourceTableIds: [],
          evidence: [],
        },
      ],
      askNext: [],
      summaries: [
        {
          title: "지원 안내",
          lines: [{ text: "이 세션은 표 미리보기용 데이터가 없어 새 CSV/XLSX 업로드가 필요합니다.", pages: [] }],
        },
      ],
      keywords: ["legacy", "session"],
      insights: "",
      issues: "새 CSV 또는 XLSX 파일로 다시 업로드하면 왼쪽 표 미리보기와 오른쪽 인포그래픽 인터페이스를 사용할 수 있습니다.",
      chartRecommendations: undefined,
      generatedLayoutPlans: undefined,
      selectedLayoutPlanId: undefined,
      generatedLayoutPlan: undefined,
      layoutPlan: undefined,
      generatedInfographicPrompt: "",
      infographicPrompt: "",
      status: "complete",
    },
    title
  );
}

function cloneTableData(tableData: TableData): TableData {
  return {
    ...tableData,
    columns: [...tableData.columns],
    rows: tableData.rows.map((row) => [...row]),
    normalizationNotes: tableData.normalizationNotes ? [...tableData.normalizationNotes] : undefined,
    primaryLogicalTableId: tableData.primaryLogicalTableId,
    logicalTables: tableData.logicalTables?.map((table) => ({
      ...table,
      columns: [...table.columns],
      rows: table.rows.map((row) => [...row]),
      normalizationNotes: table.normalizationNotes ? [...table.normalizationNotes] : undefined,
    })),
  };
}

function mergeAnalysisSeed(fileName: string, source: AnalysisData): AnalysisData {
  if (!source.tableData) return source;
  const pending = createPendingAnalysis(fileName, source.tableData);
  return normalizeAnalysisData({
    ...pending,
    ...source,
    dataset: source.dataset ?? pending.dataset,
    sheetStructure: source.sheetStructure ?? pending.sheetStructure,
    sourceInventory: source.sourceInventory ?? pending.sourceInventory,
    findings: source.findings ?? pending.findings,
    implications: source.implications ?? pending.implications,
    cautions: source.cautions ?? pending.cautions,
    askNext: source.askNext ?? pending.askNext,
    visualizationBrief: source.visualizationBrief ?? pending.visualizationBrief,
    chartRecommendations: source.chartRecommendations && source.chartRecommendations.length > 0
      ? source.chartRecommendations
      : pending.chartRecommendations,
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
    tableContext: source.tableContext?.trim() || pending.tableContext,
    status: source.status ?? "pending",
  }, source.title?.trim() || pending.title || getDatasetTitle(fileName));
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
  const selectedLayoutModel = useAppStore((state) => state.selectedLayoutModel);
  const [sessions, setSessions] = useState<TableSession[]>([]);
  const [currentRawSheetGrid, setCurrentRawSheetGrid] = useState<RawSheetGrid | null>(null);
  const [persistedTableData, setPersistedTableData] = useState<TableData | null>(null);
  const [draftTableData, setDraftTableData] = useState<TableData | null>(null);
  const [selectedLogicalTableId, setSelectedLogicalTableId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);

  const isTableDirty =
    draftTableData !== null &&
    persistedTableData !== null &&
    JSON.stringify(draftTableData) !== JSON.stringify(persistedTableData);

  const confirmDiscardTableEdits = () => {
    if (!isTableDirty) return true;
    return window.confirm("적용하지 않은 표 수정 내용이 사라집니다. 계속하시겠어요?");
  };

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (!draftTableData) {
      setSelectedLogicalTableId(null);
      return;
    }

    const availableIds = draftTableData.logicalTables?.map((table) => table.id) ?? [];
    if (availableIds.length === 0) {
      setSelectedLogicalTableId(draftTableData.primaryLogicalTableId ?? null);
      return;
    }

    if (!selectedLogicalTableId || !availableIds.includes(selectedLogicalTableId)) {
      setSelectedLogicalTableId(draftTableData.primaryLogicalTableId ?? availableIds[0] ?? null);
    }
  }, [draftTableData, selectedLogicalTableId]);

  useEffect(() => {
    void loadSessions().then(() => {
      if (initialSessionId) {
        void handleSelectSession(initialSessionId, true);
      }
    });

    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/" || path === "") {
        if (!confirmDiscardTableEdits()) {
          window.history.pushState(null, "", currentSessionIdRef.current ? `/${currentSessionIdRef.current}` : "/");
          return;
        }
        handleReset(true, true);
      } else {
        const id = path.substring(1);
        if (!confirmDiscardTableEdits()) {
          window.history.pushState(null, "", currentSessionIdRef.current ? `/${currentSessionIdRef.current}` : "/");
          return;
        }
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
      ? mergeAnalysisSeed(
          session.fileName,
          normalizeAnalysisData({ ...session.analysisData, tableData: session.analysisData.tableData ?? sessionTableData }, getDatasetTitle(session.fileName))
        )
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

  const hydrateSessionRawSheetGrid = async (session: TableSession): Promise<RawSheetGrid | null> => {
    if (session.rawSheetGrid) return session.rawSheetGrid;
    if (!session.fileBase64) return null;

    try {
      return await parseRawGridBase64(session.fileBase64, session.fileName);
    } catch {
      return null;
    }
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
      const [tableData, rawSheetGrid, base64Data] = await Promise.all([
        parseTableFile(file, { apiKey: key }),
        parseRawGridFile(file),
        readFileAsBase64(file),
      ]);
      const fileType = tableData.sourceType ?? (file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
      const pendingAnalysis = createPendingAnalysis(file.name, tableData);

      const newSession: TableSession = {
        id: store.createNewSessionId(),
        fileName: file.name,
        fileType,
        fileBase64: base64Data,
        rawSheetGrid,
        tableData,
        analysisData: pendingAnalysis,
        messages: [],
        createdAt: Date.now(),
      };

      await store.saveSession(newSession);
      await loadSessions();
      setCurrentRawSheetGrid(rawSheetGrid);
      await handleSelectSession(newSession.id);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "테이블 업로드 중 오류가 발생했습니다.");
      setIsAnalyzing(false);
    }
  };

  const handleReset = (skipHistory = false, skipDirtyCheck = false) => {
    if (!skipDirtyCheck && !confirmDiscardTableEdits()) {
      return;
    }

    setFileUrl(null);
    setAnalysisData(null);
    setPersistedTableData(null);
    setDraftTableData(null);
    setSelectedLogicalTableId(null);
    setCurrentRawSheetGrid(null);
    setCurrentSessionId(null);
    setCurrentFileName(undefined);
    setPageNumber(1);
    setIsAnalyzing(false);
    if (!skipHistory) {
      window.history.pushState(null, "", "/");
    }
  };

  const handleSelectSession = async (id: string, skipHistory = false) => {
    if (!skipHistory && !confirmDiscardTableEdits()) {
      return;
    }

    const session = await store.getSession(id);
    if (!session) {
      if (!skipHistory) {
        window.history.pushState(null, "", "/");
      }
      return;
    }

    const { session: hydratedSession, analysis } = await hydrateSessionAnalysis(session);
    const rawSheetGrid = await hydrateSessionRawSheetGrid(hydratedSession);

    setFileUrl(`session://${hydratedSession.id}`);
    setCurrentSessionId(hydratedSession.id);
    setCurrentFileName(hydratedSession.fileName);
    setAnalysisData(analysis);
    setCurrentRawSheetGrid(rawSheetGrid);
    setPersistedTableData(analysis.tableData ? cloneTableData(analysis.tableData) : null);
    setDraftTableData(analysis.tableData ? cloneTableData(analysis.tableData) : null);
    setSelectedLogicalTableId(analysis.tableData?.primaryLogicalTableId ?? analysis.tableData?.logicalTables?.[0]?.id ?? null);

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
      analysisSource?: "raw-grid" | "edited-table";
    }
  ) => {
    const targetSessionId = session.id;
    const isTargetSessionActive = () => currentSessionIdRef.current === targetSessionId;
    const apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    const baseAnalysis = session.analysisData?.tableData
      ? mergeAnalysisSeed(session.fileName, session.analysisData)
      : null;

    if (!baseAnalysis?.tableData || !baseAnalysis.tableContext) {
      if (isTargetSessionActive()) {
        setAnalysisData(createUnsupportedAnalysis(session.fileName));
        setIsAnalyzing(false);
      }
      return;
    }

    if (isTargetSessionActive()) {
      setAnalysisData(baseAnalysis);
      setIsAnalyzing(true);
    }

    try {
      const currentTableData = baseAnalysis.tableData;
      const initialTableIdAliases = buildLogicalTableIdAliasMap({
        tableData: currentTableData,
        sheetStructure: baseAnalysis.sheetStructure,
        sourceTables: baseAnalysis.sourceInventory?.tables,
      });
      const hadExplicitSelection = Array.isArray(baseAnalysis.selectedSourceTableIds);
      const selectedSourceTableIds = getSelectedSourceTableIds(
        currentTableData,
        baseAnalysis.selectedSourceTableIds,
        baseAnalysis.sheetStructure,
        baseAnalysis.sourceInventory?.tables
      );
      const chartRecommendations = baseAnalysis.chartRecommendations?.length
        ? baseAnalysis.chartRecommendations.flatMap((item) => {
            const resolvedTableId = item.tableId ? (resolveLogicalTableId(item.tableId, initialTableIdAliases) ?? item.tableId) : undefined;
            if (resolvedTableId && !selectedSourceTableIds.includes(resolvedTableId)) {
              return [];
            }
            return [{ ...item, tableId: resolvedTableId }];
          })
        : buildChartRecommendationsForLogicalTables(currentTableData, selectedSourceTableIds);
      const useEditedTableSource = options?.analysisSource === "edited-table";
      const rawGrid = useEditedTableSource
        ? null
        : session.rawSheetGrid ?? (
            session.fileBase64
              ? await parseRawGridBase64(session.fileBase64, session.fileName).catch(() => null)
              : null
          );
      const structureResponse = rawGrid
        ? await runStructureAnalysis(apiKey, selectedLayoutModel, serializeRawGridForGemini(rawGrid), currentTableData)
        : { sheetStructure: buildInitialSheetStructure(session.fileName, currentTableData) };
      const structureValidation = rawGrid
        ? validateSheetStructure(structureResponse, rawGrid.rows)
        : { ok: true as const };
      const sheetStructure = structureResponse.sheetStructure;

      if (!structureValidation.ok || !sheetStructure) {
        const reviewData = normalizeAnalysisData(
          {
            ...baseAnalysis,
            schemaVersion: "3",
            dataset: {
              title: baseAnalysis.title || getDatasetTitle(session.fileName),
              summary: "표 구조를 자동 판정하지 못해 확인이 필요합니다.",
              tableCount: 0,
              sourceType: baseAnalysis.tableData?.sourceType,
            },
            sheetStructure: {
              sheetName: rawGrid?.sheetName ?? currentTableData.sheetName,
              tableCount: 0,
              needsReview: true,
              reviewReason: structureValidation.reason || "sheetStructure missing",
              tables: [],
            },
            reviewReasons: [structureValidation.reason || "sheetStructure missing"],
            findings: [],
            implications: [],
            cautions: [{ text: structureValidation.reason || "sheetStructure missing", sourceTableIds: [], evidence: [] }],
            issues: structureValidation.reason || "sheetStructure missing",
            chartRecommendations,
            selectedSourceTableIds,
            tableData: baseAnalysis.tableData,
            tableContext: baseAnalysis.tableContext,
            status: "complete",
          },
          baseAnalysis.title || getDatasetTitle(session.fileName)
        );
        const updatedSession = { ...session, analysisData: reviewData };
        await store.saveSession(updatedSession);
        if (isTargetSessionActive()) setAnalysisData(reviewData);
        await loadSessions();
        return;
      }

      const synthesizedReviewReasons = [
        ...(sheetStructure.reviewReason ? [sheetStructure.reviewReason] : []),
        ...sheetStructure.tables.flatMap((table) => table.reviewReasons ?? []),
        ...sheetStructure.tables.filter((table) => table.confidence < 0.7).map((table) => `${table.id}: confidence ${table.confidence.toFixed(2)}`),
        ...sheetStructure.tables.filter((table) => table.needsReview).map((table) => `${table.id}: 구조 재확인 필요`),
      ];
      const needsReview = Boolean(
        sheetStructure.tableCount === 0 ||
        sheetStructure.needsReview ||
        sheetStructure.tables.some((table) => table.confidence < 0.7 || table.needsReview)
      );
      if (needsReview) {
        const reviewReasons = synthesizedReviewReasons.length > 0
          ? synthesizedReviewReasons
          : [sheetStructure.tableCount === 0 ? "표 구조를 판정하지 못했습니다." : "표 구조 재확인이 필요합니다."];
        const reviewData = normalizeAnalysisData(
          {
            ...baseAnalysis,
            schemaVersion: "3",
            dataset: {
              title: baseAnalysis.title || getDatasetTitle(session.fileName),
              summary: "표 구조 신뢰도가 낮아 재확인이 필요합니다.",
              tableCount: sheetStructure.tableCount,
              sourceType: baseAnalysis.tableData?.sourceType,
            },
            sheetStructure,
            reviewReasons,
            findings: [],
            implications: [],
            cautions: reviewReasons.map((reason) => ({ text: reason, sourceTableIds: [], evidence: [] })),
            issues: reviewReasons.join("\n"),
            chartRecommendations,
            selectedSourceTableIds,
            tableData: baseAnalysis.tableData,
            tableContext: baseAnalysis.tableContext,
            status: "complete",
          },
          baseAnalysis.title || getDatasetTitle(session.fileName)
        );
        const updatedSession = { ...session, analysisData: reviewData };
        await store.saveSession(updatedSession);
        if (isTargetSessionActive()) setAnalysisData(reviewData);
        await loadSessions();
        return;
      }

      const tableIdAliases = buildLogicalTableIdAliasMap({
        tableData: currentTableData,
        sheetStructure,
        sourceTables: baseAnalysis.sourceInventory?.tables,
      });

      const interpretationResults = canonicalizeInterpretationResults(await Promise.all(
        sheetStructure.tables.map((table) => {
          const logicalTableId = resolveLogicalTableId(table.id, tableIdAliases) ?? table.id;
          const matchingLogicalTable = currentTableData.logicalTables?.find((candidate) => candidate.id === logicalTableId);
          const slicedText = matchingLogicalTable
            ? formatSlicedGrid([matchingLogicalTable.columns, ...matchingLogicalTable.rows], {
                originalRange: table.range,
              })
            : rawGrid
              ? formatSlicedGrid(sliceGridByRange(rawGrid.rows, table.range), { originalRange: table.range })
              : formatSlicedGrid([currentTableData.columns, ...currentTableData.rows], { originalRange: table.range });
          return runTableInterpretation(apiKey, selectedLayoutModel, sheetStructure, table, slicedText);
        })
      ), tableIdAliases);

      const merged = mergeTableInterpretations({ sheetStructure }, interpretationResults);
      const layoutPromptInstruction = options?.layoutPromptOverride?.trim() || layoutSystemPrompt?.trim() || DEFAULT_LAYOUT_SYSTEM_PROMPT;
      const selectedInterpretations = interpretationResults.filter((result) => selectedSourceTableIds.includes(result.tableId));
      const effectiveInterpretations = selectedInterpretations.length > 0 || !hadExplicitSelection ? (selectedInterpretations.length > 0 ? selectedInterpretations : interpretationResults) : [];
      const layoutTableBriefs = buildLayoutTableBriefs({
        sheetStructure,
        selectedSourceTableIds,
        sourceTables: baseAnalysis.sourceInventory?.tables,
        interpretationResults: effectiveInterpretations,
        chartRecommendations,
        tableData: currentTableData,
      });
      if (layoutTableBriefs.length === 0 || !hasReadyLayoutBriefInputs({
        status: "complete",
        sheetStructure,
        reviewReasons: synthesizedReviewReasons,
        tableInterpretations: interpretationResults,
      })) {
        throw new Error("Layout brief inputs are not ready.");
      }
      const composedLayout = await runComposedLayoutGeneration(apiKey, selectedLayoutModel, {
        title: baseAnalysis.title || getDatasetTitle(session.fileName),
        sheetStructure,
        layoutTableBriefs,
        chartRecommendations,
        layoutPromptInstruction,
      });
      const normalizedLayoutPlans = rerankLayoutPlansByRecommendations(
        canonicalizeLayoutPlans(
          normalizeLayoutPlans(composedLayout.layoutPlans) ??
            merged.generatedLayoutPlans ??
            baseAnalysis.generatedLayoutPlans ??
            (baseAnalysis.generatedLayoutPlan ? [baseAnalysis.generatedLayoutPlan] : baseAnalysis.layoutPlan ? [baseAnalysis.layoutPlan] : undefined),
          tableIdAliases
        ),
        chartRecommendations
      );
      const selectedLayoutPlan = getSelectedLayoutPlan(
        normalizedLayoutPlans,
        baseAnalysis.selectedLayoutPlanId,
        baseAnalysis.layoutPlan ?? baseAnalysis.generatedLayoutPlan
      );
      const generatedInfographicPrompt = options?.layoutPromptOverride?.trim() || (typeof composedLayout.infographicPrompt === "string" ? composedLayout.infographicPrompt.trim() : "") || merged.infographicPrompt || baseAnalysis.generatedInfographicPrompt || baseAnalysis.infographicPrompt || layoutPromptInstruction;
      const rawAnalysis = {
        ...baseAnalysis,
        ...merged,
        schemaVersion: "3",
        dataset: {
          title: baseAnalysis.title || getDatasetTitle(session.fileName),
          summary: baseAnalysis.dataset?.summary || "구조 판정 이후 표별 해석을 완료했습니다.",
          tableCount: sheetStructure.tableCount,
          sourceType: baseAnalysis.tableData?.sourceType,
        },
        chartRecommendations,
        selectedSourceTableIds,
        generatedLayoutPlans: normalizedLayoutPlans,
        selectedLayoutPlanId: selectedLayoutPlan?.id,
        generatedLayoutPlan: normalizedLayoutPlans?.[0] ?? selectedLayoutPlan,
        layoutPlan: selectedLayoutPlan,
        generatedInfographicPrompt,
        infographicPrompt: generatedInfographicPrompt,
        tableData: baseAnalysis.tableData,
        tableContext: baseAnalysis.tableContext,
        status: "complete" as const,
      };
      const normalizedData: AnalysisData = normalizeAnalysisData(rawAnalysis, baseAnalysis.title || getDatasetTitle(session.fileName));

      const updatedSession = { ...session, analysisData: normalizedData };
      await store.saveSession(updatedSession);
      if (isTargetSessionActive()) {
        setAnalysisData(normalizedData);
      }
      await loadSessions();
    } catch (error) {
      console.error(error);
      if (isTargetSessionActive()) {
        alert(
          "테이블 인사이트를 생성하는 중 오류가 발생했습니다: " +
            (error instanceof Error ? error.message : "API 통신 오류. 키가 올바른지 확인해주세요.")
        );
      }
    } finally {
      if (isTargetSessionActive()) {
        setIsAnalyzing(false);
      }
    }
  };

  const handleRegenerateLayoutCandidates = async (layoutPromptOverride: string, selectedSourceTableIds?: string[]) => {
    if (!currentSessionId) return;

    const session = await store.getSession(currentSessionId);
    if (!session) return;

    const { session: hydratedSession, analysis } = await hydrateSessionAnalysis(session);
    const resolvedSelectedSourceTableIds = analysis.tableData
      ? getSelectedSourceTableIds(
          analysis.tableData,
          selectedSourceTableIds,
          analysis.sheetStructure,
          analysis.sourceInventory?.tables
        )
      : selectedSourceTableIds;
    const nextAnalysis = resolvedSelectedSourceTableIds && selectedSourceTableIds
      ? normalizeAnalysisData(
          {
            ...analysis,
            selectedSourceTableIds: resolvedSelectedSourceTableIds,
            visualizationBrief: undefined,
            generatedInfographicPrompt: undefined,
            infographicPrompt: undefined,
            chartRecommendations: analysis.tableData
              ? buildChartRecommendationsForLogicalTables(analysis.tableData, resolvedSelectedSourceTableIds)
              : analysis.chartRecommendations,
          },
          analysis.title || getDatasetTitle(hydratedSession.fileName)
        )
      : analysis;

    if (nextAnalysis !== analysis) {
      await store.saveSession({ ...hydratedSession, analysisData: nextAnalysis });
    }

    await runAnalysisForSession(
      { ...hydratedSession, analysisData: nextAnalysis },
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

  const handleLogicalTableSelection = (tableId: string) => {
    setSelectedLogicalTableId(tableId);
  };

  const handleTableHeaderChange = (tableId: string, columnIndex: number, value: string) => {
    setDraftTableData((currentTableData) => {
      const sourceTableData = currentTableData ?? (analysisData?.tableData ? cloneTableData(analysisData.tableData) : null);
      if (!sourceTableData) return currentTableData;
      return updateLogicalTableHeader(sourceTableData, tableId, columnIndex, value);
    });
  };

  const handleTableCellChange = (tableId: string, rowIndex: number, cellIndex: number, value: string) => {
    setDraftTableData((currentTableData) => {
      const sourceTableData = currentTableData ?? (analysisData?.tableData ? cloneTableData(analysisData.tableData) : null);
      if (!sourceTableData) return currentTableData;
      return updateLogicalTableCell(sourceTableData, tableId, rowIndex, cellIndex, value);
    });
  };

  const handleResetTableEdits = () => {
    setDraftTableData((currentTableData) => {
      if (!persistedTableData) {
        return currentTableData;
      }

      const nextTableData = cloneTableData(persistedTableData);
      setSelectedLogicalTableId(nextTableData.primaryLogicalTableId ?? nextTableData.logicalTables?.[0]?.id ?? null);
      return nextTableData;
    });
  };

  const handleApplyTableEdits = async () => {
    if (!currentSessionId || isAnalyzing || !draftTableData || !persistedTableData || !isTableDirty) {
      return;
    }

    const session = await store.getSession(currentSessionId);
    if (!session) return;

    const nextTableData = syncPrimaryLogicalTableToTopLevel(cloneTableData(draftTableData));
    const nextAnalysisData: AnalysisData = session.analysisData
      ? normalizeAnalysisData(
          {
            ...session.analysisData,
            sheetStructure: buildInitialSheetStructure(session.fileName, nextTableData),
            dataset: session.analysisData.dataset
              ? {
                  ...session.analysisData.dataset,
                  tableCount: nextTableData.logicalTables?.length ?? (nextTableData.rowCount > 0 ? 1 : 0),
                  sourceType: nextTableData.sourceType,
                }
              : undefined,
            sourceInventory: buildSourceInventory(session.fileName, nextTableData),
            tableData: nextTableData,
            tableContext: buildTableContext(nextTableData),
            selectedSourceTableIds: getSelectedSourceTableIds(
              nextTableData,
              session.analysisData.selectedSourceTableIds,
              session.analysisData.sheetStructure,
              session.analysisData.sourceInventory?.tables
            ),
            visualizationBrief: undefined,
            generatedInfographicPrompt: undefined,
            infographicPrompt: undefined,
            chartRecommendations: buildChartRecommendationsForLogicalTables(
              nextTableData,
              getSelectedSourceTableIds(
                nextTableData,
                session.analysisData.selectedSourceTableIds,
                session.analysisData.sheetStructure,
                session.analysisData.sourceInventory?.tables
              )
            ),
            status: "pending",
          },
          getDatasetTitle(session.fileName)
        )
      : createPendingAnalysis(session.fileName, nextTableData);

    const updatedSession: TableSession = {
      ...session,
      tableData: nextTableData,
      analysisData: nextAnalysisData,
    };

    await store.saveSession(updatedSession);
    setPersistedTableData(cloneTableData(nextTableData));
    setDraftTableData(cloneTableData(nextTableData));
    setSelectedLogicalTableId(nextTableData.primaryLogicalTableId ?? nextTableData.logicalTables?.[0]?.id ?? null);
    setAnalysisData(nextAnalysisData);
    await loadSessions();
    await runAnalysisForSession(updatedSession, { analysisSource: "edited-table" });
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
                  tableData={draftTableData}
                  rawSheetGrid={currentRawSheetGrid}
                  selectedLogicalTableId={selectedLogicalTableId}
                  isTableDirty={isTableDirty}
                  isApplyTableEditsDisabled={!isTableDirty || isAnalyzing}
                  isResetTableEditsDisabled={!isTableDirty}
                  rawFileName={currentFileName}
                  onCellChange={handleTableCellChange}
                  onHeaderChange={handleTableHeaderChange}
                  onLogicalTableSelect={handleLogicalTableSelection}
                  onResetTableEdits={handleResetTableEdits}
                  onApplyTableEdits={handleApplyTableEdits}
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
