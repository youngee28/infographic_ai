"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Menu, Sparkles } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { buildLayoutTableBriefs, hasReadyLayoutBriefInputs } from "@/components/pdf/right-panel/layout/briefs";
import { buildDeterministicLayoutPlans } from "@/components/pdf/right-panel/layout/planner";
import { canonicalizeLayoutPlans, getSelectedLayoutPlan } from "@/components/pdf/right-panel/layout/selection";
import { useAppStore } from "@/lib/app-store";
import { normalizeAnalysisData } from "@/lib/analysis-schema";
import { mergeTableInterpretations, validateSheetStructure } from "@/lib/analysis-pipeline";
import { buildChartRecommendationsForLogicalTables, rerankLayoutPlansByRecommendations } from "@/lib/chart-recommendation";
import { DEFAULT_LAYOUT_IMAGE_PROMPT } from "@/lib/layout-image-prompts";
import { buildLogicalTableIdAliasMap, resolveLogicalTableId, resolveLogicalTableIds } from "@/lib/table-id-resolution";
import { store, type TableSession } from "@/lib/store";
import type {
  AnalysisData,
  AnalysisSheetStructure,
  AnalysisStructuredTable,
  RawSheetGrid,
  ReferenceLine,
  SourceTable,
  SummaryVariant,
  TableInterpretationResult,
} from "@/lib/session-types";
import { formatSlicedGrid, parseRawGridBase64, parseRawGridFile, serializeRawGridForGemini, sliceGridByRange } from "@/lib/table-parser";
import { buildTableInsightFacts } from "@/lib/table-insight";
import {
  buildTableContext,
  deriveAndResolveTableFieldRolesWithAI,
  resolveTableFieldRoles,
  getDatasetTitle,
  parseTableFile,
  rebaseLogicalTableGeometry,
  serializeTableDataForFieldRoleAI,
  syncPrimaryLogicalTableToTopLevel,
  type TableFieldRoles,
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

type TableFieldRoleMap = Record<string, TableFieldRoles>;

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

function getPrecomputedFieldRoles(roleMap: TableFieldRoleMap | undefined, tableId: string): TableFieldRoles | undefined {
  return roleMap?.[tableId];
}

function buildSourceInventory(fileName: string, tableData: TableData, roleMap?: TableFieldRoleMap) {
  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    const primaryLogicalTableId = tableData.primaryLogicalTableId ?? tableData.logicalTables[0]?.id;
    return {
      tables: tableData.logicalTables.map((table) => {
        const normalizedStructure = table.localStructureHint?.winner ?? table.orientation;
        const fieldRoles = getPrecomputedFieldRoles(roleMap, table.id) ?? resolveTableFieldRoles(table);
        return {
          id: table.id,
          name: table.name,
          role: table.id === primaryLogicalTableId ? "primary" as const : normalizedStructure === "column-major" ? "reference" as const : "supporting" as const,
          purpose:
            normalizedStructure === "mixed"
              ? "행/열 헤더가 혼합된 표 구조를 파악합니다."
              : normalizedStructure === "column-major"
                ? "열 기준 항목 구조를 파악합니다."
                : normalizedStructure === "ambiguous"
                  ? "표 구조를 재검토합니다."
                  : "행 기준 레코드 구조를 파악합니다.",
          context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열에서 감지한 논리 표입니다.`,
          dimensions: fieldRoles.dimensions,
          metrics: fieldRoles.metrics,
          grain: normalizedStructure,
          structure: normalizedStructure,
        };
      }),
      relations: [],
    };
  }

  return {
    tables: (() => {
      const fieldRoles = getPrecomputedFieldRoles(roleMap, "table-1") ?? resolveTableFieldRoles({
        columns: tableData.columns,
        rows: tableData.rows,
        rowCount: tableData.rowCount,
        columnCount: tableData.columnCount,
      });
      return [
        {
          id: "table-1",
          name: tableData.sheetName?.trim() || getDatasetTitle(fileName),
          role: "primary" as const,
          purpose: "업로드된 표의 핵심 구조와 수치를 파악합니다.",
          context: `전체 표 ${tableData.rowCount}행 × ${tableData.columnCount}열 구조를 해석하기 위한 기본 표입니다.`,
          dimensions: fieldRoles.dimensions,
          metrics: fieldRoles.metrics,
          grain: tableData.sheetName ? "sheet" : undefined,
        },
      ];
    })(),
    relations: [],
  };
}

function buildInitialSheetStructure(fileName: string, tableData: TableData, roleMap?: TableFieldRoleMap): AnalysisSheetStructure {
  if (tableData.logicalTables && tableData.logicalTables.length > 0) {
    return {
      sheetName: tableData.sheetName,
      tableCount: tableData.logicalTables.length,
      tables: tableData.logicalTables.map((table) => {
        const fieldRoles = getPrecomputedFieldRoles(roleMap, table.id) ?? resolveTableFieldRoles(table);
        const geometry = rebaseLogicalTableGeometry(table);
        return {
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
            headerRows: geometry.headerRows,
            headerCols: geometry.headerCols,
          },
          dataRegion: geometry.dataRegion,
          dimensions: fieldRoles.dimensions,
          metrics: fieldRoles.metrics,
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
        };
      }),
    };
  }

  const fieldRoles = getPrecomputedFieldRoles(roleMap, "table-1") ?? resolveTableFieldRoles({
    columns: tableData.columns,
    rows: tableData.rows,
    rowCount: tableData.rowCount,
    columnCount: tableData.columnCount,
  });

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
          dimensions: fieldRoles.dimensions,
          metrics: fieldRoles.metrics,
        }]
      : [],
  };
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

function isTableStructureDebugEnabled(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem("debug_table_structure") === "1";
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

function buildInterpretPrompt(
  sheetStructure: AnalysisSheetStructure,
  table: AnalysisStructuredTable,
  slicedGridText: string,
  insightFacts?: ReturnType<typeof buildTableInsightFacts>
) {
  const modeInstructions = insightFacts?.analysisMode === "trend"
    ? [
        '- 이 표는 시간 흐름 중심 데이터입니다.',
        '- firstLastDelta, firstLastDeltaRate 같은 변화량을 우선 해석하세요.',
        '- topGap이나 shareOfTop이 비어 있으면 순위/비중 비교를 억지로 만들지 마세요.',
        '- 성장세, 하락세, 변동성 같은 추세 인사이트를 우선 도출하세요.',
      ].join("\n")
    : insightFacts?.analysisMode === "ranking"
      ? [
          '- 이 표는 항목 간 비교 중심 데이터입니다.',
          '- topGap, topGapRatio, shareOfTop 같은 격차/비중 fact를 우선 해석하세요.',
          '- firstLastDelta가 비어 있으면 시간 흐름이나 추세를 억지로 만들지 마세요.',
          '- 특정 항목의 우위, 집중도, 상하위 격차를 우선 설명하세요.',
        ].join("\n")
      : [
          '- 이 표의 분석 모드는 불명확합니다.',
          '- 제공된 LOCAL_FACTS 안에서 확실한 내용만 보수적으로 해석하세요.',
          '- 비어 있거나 없는 비교 지표를 억지로 확장하지 마세요.',
        ].join("\n");

  return `당신은 데이터 해석가이자 인포그래픽 기획자입니다.

중요:
- 구조를 다시 판정하지 마세요.
- 전체 시트를 다시 해석하지 마세요.
- 아래의 sheetStructure와 대상 표 구조를 그대로 신뢰하세요.
- 아래 sliced grid는 보조 참고용이며, insight와 significantNumbers는 LOCAL_FACTS를 우선 근거로 사용하세요.
- row/col 번호는 sliced grid 내부 기준 1-indexed입니다.
- 직접 계산을 다시 하기보다 제공된 fact를 바탕으로 의미를 해석하세요.
- LOCAL_FACTS에 없는 숫자나 비율은 새로 만들지 마세요.
- topGap, spread, firstLastDelta처럼 값이 없거나 누락된 지표는 비교 불가로 간주하고 문장에 쓰지 마세요.
- significantNumbers의 각 문장은 LOCAL_FACTS 안의 수치 비교나 비중, 변화량을 직접 참조해야 합니다.
- insight는 숫자를 반복 나열하기보다, LOCAL_FACTS가 말하는 핵심 맥락을 한 문장으로 요약하세요.
- 과장이나 인과 추정은 피하세요.

[ANALYSIS MODE RULES]
${modeInstructions}

반드시 JSON만 반환하세요.

반환 형식:
{
  "tableId": "${table.id}",
  "findings": [{ "text": "핵심 발견", "sourceTableIds": ["${table.id}"], "evidence": [], "priority": "high" }],
  "implications": [{ "text": "실무 시사점", "sourceTableIds": ["${table.id}"], "evidence": [], "audience": "business" }],
  "cautions": [{ "text": "해석상 유의점", "sourceTableIds": ["${table.id}"], "evidence": [] }],
  "insight": "표 맥락을 반영한 짧은 인사이트 1문장",
  "significantNumbers": ["LOCAL_FACTS에 있는 비교/비중/변화량을 근거로 한 문장 1", "LOCAL_FACTS에 있는 비교/비중/변화량을 근거로 한 문장 2"],
  "layoutPlans": [],
  "infographicPrompt": "이 표를 인포그래픽으로 요약하는 프롬프트"
}

[판정된 구조]
${JSON.stringify(sheetStructure, null, 2)}

[대상 표]
${JSON.stringify(table, null, 2)}

[LOCAL_FACTS]
${JSON.stringify(insightFacts ?? null, null, 2)}

[해당 range의 sliced grid]
${slicedGridText}`.trim();
}

async function runStructureAnalysis(apiKey: string, model: string, rawGridText: string, tableData?: TableData) {
  return callGeminiJson<{ schemaVersion?: string; sheetStructure?: AnalysisSheetStructure }>(apiKey, model, buildStructurePrompt(rawGridText, tableData));
}

async function runTableInterpretation(
  apiKey: string,
  model: string,
  sheetStructure: AnalysisSheetStructure,
  table: AnalysisStructuredTable,
  slicedGridText: string,
  insightFacts?: ReturnType<typeof buildTableInsightFacts>
) {
  return callGeminiJson<TableInterpretationResult>(apiKey, model, buildInterpretPrompt(sheetStructure, table, slicedGridText, insightFacts));
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

async function buildGeminiFieldRoleMap(
  apiKey: string,
  fileName: string,
  tableData: TableData,
  sheetStructure: AnalysisSheetStructure
): Promise<TableFieldRoleMap> {
  const aliases = buildLogicalTableIdAliasMap({
    tableData,
    sheetStructure,
  });

  const roleEntries = await Promise.all(
    sheetStructure.tables.map(async (table) => {
      const resolvedId = resolveLogicalTableId(table.id, aliases) ?? table.id;
      const matchingLogicalTable = tableData.logicalTables?.find((candidate) => candidate.id === resolvedId);
      const tableSource = matchingLogicalTable
        ? {
            columns: matchingLogicalTable.columns,
            rows: matchingLogicalTable.rows,
            rowCount: matchingLogicalTable.rowCount,
            columnCount: matchingLogicalTable.columnCount,
            orientation: matchingLogicalTable.orientation,
            headerAxis: matchingLogicalTable.headerAxis,
            localStructureHint: matchingLogicalTable.localStructureHint,
          }
        : {
            columns: tableData.columns,
            rows: tableData.rows,
            rowCount: tableData.rowCount,
            columnCount: tableData.columnCount,
          };
      const rawTableText = [
        `fileName=${fileName}`,
        `tableId=${table.id}`,
        `tableTitle=${table.title}`,
        serializeTableDataForFieldRoleAI(tableSource),
      ].join("\n\n");
      const roles = await deriveAndResolveTableFieldRolesWithAI(tableSource, rawTableText, { apiKey });
      return [
        [table.id, roles],
        ...(resolvedId !== table.id ? [[resolvedId, roles] as const] : []),
      ] as const;
    })
  );

  return Object.fromEntries(roleEntries.flat());
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
  const layoutImagePrompt = useAppStore((state) => state.layoutImagePrompt);
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
      imagePromptOverride?: string;
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
       const selectedSourceTableIds = getSelectedSourceTableIds(
         currentTableData,
         baseAnalysis.selectedSourceTableIds,
         baseAnalysis.sheetStructure,
         baseAnalysis.sourceInventory?.tables
       );
       const chartRecommendations = baseAnalysis.chartRecommendations?.length
         ? baseAnalysis.chartRecommendations.map((item) => ({
             ...item,
             tableId: item.tableId ? (resolveLogicalTableId(item.tableId, initialTableIdAliases) ?? item.tableId) : undefined,
           }))
         : buildChartRecommendationsForLogicalTables(currentTableData);
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
        if (isTableStructureDebugEnabled()) {
          console.warn("[Table Structure] Validation failed.", {
            fileName: session.fileName,
            sheetName: rawGrid?.sheetName ?? currentTableData.sheetName,
            reason: structureValidation.reason || "sheetStructure missing",
            tables: structureResponse.sheetStructure?.tables.map((table) => ({
              id: table.id,
              structure: table.structure,
              axis: table.header.axis,
              confidence: table.confidence,
              range: table.range,
              headerRows: table.header.headerRows,
              headerCols: table.header.headerCols,
              dataRegion: table.dataRegion,
              reviewReasons: table.reviewReasons,
            })),
          });
        }

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

      const aiFieldRoleMap = await buildGeminiFieldRoleMap(apiKey, session.fileName, currentTableData, sheetStructure);
      const enrichedSheetStructure: AnalysisSheetStructure = {
        ...sheetStructure,
        tables: sheetStructure.tables.map((table) => {
          const roles = getPrecomputedFieldRoles(aiFieldRoleMap, table.id);
          return roles
            ? {
                ...table,
                dimensions: roles.dimensions,
                metrics: roles.metrics,
              }
            : table;
        }),
      };
      const sourceInventory = buildSourceInventory(session.fileName, currentTableData, aiFieldRoleMap);

      const tableIdAliases = buildLogicalTableIdAliasMap({
        tableData: currentTableData,
        sheetStructure: enrichedSheetStructure,
        sourceTables: sourceInventory.tables,
      });

      const interpretationResults = canonicalizeInterpretationResults(await Promise.all(
        enrichedSheetStructure.tables.map((table) => {
          const logicalTableId = resolveLogicalTableId(table.id, tableIdAliases) ?? table.id;
          const matchingLogicalTable = currentTableData.logicalTables?.find((candidate) => candidate.id === logicalTableId);
          const slicedText = matchingLogicalTable
            ? formatSlicedGrid([matchingLogicalTable.columns, ...matchingLogicalTable.rows], {
                originalRange: table.range,
              })
            : rawGrid
              ? formatSlicedGrid(sliceGridByRange(rawGrid.rows, table.range), { originalRange: table.range })
              : formatSlicedGrid([currentTableData.columns, ...currentTableData.rows], { originalRange: table.range });
          const insightFacts = buildTableInsightFacts({
            tableId: logicalTableId,
            tableName: table.title,
            columns: matchingLogicalTable?.columns ?? currentTableData.columns,
            rows: matchingLogicalTable?.rows ?? currentTableData.rows,
            dimensions: table.dimensions,
            metrics: table.metrics,
          });
          return runTableInterpretation(apiKey, selectedLayoutModel, enrichedSheetStructure, table, slicedText, insightFacts);
        })
      ), tableIdAliases);

      const merged = mergeTableInterpretations({ sheetStructure: enrichedSheetStructure }, interpretationResults);
      const layoutImagePromptInstruction = options?.imagePromptOverride?.trim() || layoutImagePrompt?.trim() || DEFAULT_LAYOUT_IMAGE_PROMPT;
      const layoutTableBriefs = buildLayoutTableBriefs({
        sheetStructure: enrichedSheetStructure,
        sourceTables: sourceInventory.tables,
        interpretationResults,
        chartRecommendations,
        tableData: currentTableData,
      });
      if (layoutTableBriefs.length === 0 || !hasReadyLayoutBriefInputs({
        status: "complete",
        sheetStructure: enrichedSheetStructure,
        reviewReasons: synthesizedReviewReasons,
        tableInterpretations: interpretationResults,
      })) {
        throw new Error("Layout brief inputs are not ready.");
      }
      const generatedLayoutPlans = canonicalizeLayoutPlans(
        buildDeterministicLayoutPlans({
          title: baseAnalysis.title || getDatasetTitle(session.fileName),
          tableBriefs: layoutTableBriefs,
          selectedSourceTableIds,
          chartRecommendations,
          findings: merged.findings,
          implications: merged.implications,
          cautions: merged.cautions,
        }),
        tableIdAliases
      );
      const normalizedLayoutPlans = rerankLayoutPlansByRecommendations(
        generatedLayoutPlans ??
          merged.generatedLayoutPlans ??
          baseAnalysis.generatedLayoutPlans ??
          (baseAnalysis.generatedLayoutPlan ? [baseAnalysis.generatedLayoutPlan] : baseAnalysis.layoutPlan ? [baseAnalysis.layoutPlan] : undefined),
        chartRecommendations
      );
      const selectedLayoutPlan = getSelectedLayoutPlan(
        normalizedLayoutPlans,
        baseAnalysis.selectedLayoutPlanId,
        baseAnalysis.layoutPlan ?? baseAnalysis.generatedLayoutPlan
      );
      const generatedInfographicPrompt = options?.imagePromptOverride?.trim() || merged.infographicPrompt || baseAnalysis.generatedInfographicPrompt || baseAnalysis.infographicPrompt || layoutImagePromptInstruction;
      const rawAnalysis = {
        ...baseAnalysis,
        ...merged,
        schemaVersion: "3",
        dataset: {
          title: baseAnalysis.title || getDatasetTitle(session.fileName),
          summary: baseAnalysis.dataset?.summary || "구조 판정 이후 표별 해석을 완료했습니다.",
          tableCount: enrichedSheetStructure.tableCount,
          sourceType: baseAnalysis.tableData?.sourceType,
        },
        chartRecommendations,
        selectedSourceTableIds,
        sourceInventory,
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

  const handleRegenerateLayoutImages = async (imagePromptOverride: string) => {
    if (!currentSessionId) return;

    const session = await store.getSession(currentSessionId);
    if (!session) return;

    const { session: hydratedSession, analysis } = await hydrateSessionAnalysis(session);
    const nextAnalysis = normalizeAnalysisData(
      {
        ...analysis,
        visualizationBrief: undefined,
        generatedInfographicPrompt: undefined,
        infographicPrompt: undefined,
        chartRecommendations: analysis.tableData
          ? buildChartRecommendationsForLogicalTables(analysis.tableData)
          : analysis.chartRecommendations,
      },
      analysis.title || getDatasetTitle(hydratedSession.fileName)
    );

    if (nextAnalysis !== analysis) {
      await store.saveSession({ ...hydratedSession, analysisData: nextAnalysis });
    }

    await runAnalysisForSession(
      { ...hydratedSession, analysisData: nextAnalysis },
      { imagePromptOverride }
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
              nextTableData
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
              onRegenerateLayoutImages={handleRegenerateLayoutImages}
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
