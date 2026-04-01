import { z } from "zod";
import type { AnalysisData } from "@/lib/session-types";

export const referenceLineSchema = z.object({
  text: z.string().trim().min(1),
  pages: z.array(z.coerce.number().int().positive()).default([]),
});

export const summaryVariantSchema = z.object({
  title: z.string().trim().min(1).default("요약"),
  content: z.string().optional(),
  lines: z.array(referenceLineSchema).optional(),
});

export const layoutChartSpecSchema = z.object({
  id: z.string().trim().min(1),
  chartType: z.enum(["bar", "line", "donut", "pie", "stacked-bar", "map"]),
  title: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  dimension: z.string().trim().optional(),
  metric: z.string().trim().optional(),
});

export const layoutSectionSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(["header", "chart-group", "kpi-group", "takeaway", "note"]),
  title: z.string().trim().optional(),
  charts: z.array(layoutChartSpecSchema).optional(),
  items: z.array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) })).optional(),
  note: z.string().trim().optional(),
});

export const layoutVisualPolicySchema = z.object({
  textRatio: z.number(),
  chartRatio: z.number(),
  iconRatio: z.number(),
});

export const layoutPlanSchema = z.object({
  id: z.string().trim().min(1),
  layoutType: z.literal("dashboard"),
  aspectRatio: z.enum(["portrait", "square", "landscape"]),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  previewImageDataUrl: z.string().optional(),
  sections: z.array(layoutSectionSchema).default([]),
  visualPolicy: layoutVisualPolicySchema,
});

export const normalizedTableSchema = z.object({
  sheetName: z.string().optional(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())).default([]),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  normalizationNotes: z.array(z.string()).optional(),
  sourceType: z.enum(["csv", "xlsx"]).optional(),
});

export const analysisDataSchema = z.object({
  title: z.string().trim().optional(),
  summaries: z.array(summaryVariantSchema).default([]),
  keywords: z.array(z.string()).default([]),
  insights: z.string().default(""),
  issues: z.union([z.string(), z.array(referenceLineSchema)]).default(""),
  generatedLayoutPlans: z.array(layoutPlanSchema).optional(),
  selectedLayoutPlanId: z.string().trim().optional(),
  generatedLayoutPlan: layoutPlanSchema.optional(),
  layoutPlan: layoutPlanSchema.optional(),
  generatedInfographicPrompt: z.string().optional(),
  infographicPrompt: z.string().optional(),
  tableContext: z.string().optional(),
  tableData: normalizedTableSchema.optional(),
  status: z.enum(["pending", "complete"]).optional(),
});

export const messageSchema = z.object({
  role: z.enum(["user", "ai"]),
  content: z.string(),
  citations: z.array(z.number().int().positive()).optional(),
  generatedImageDataUrl: z.string().optional(),
});

export const infographicControlsSchema = z.object({
  aspectRatio: z.enum(["portrait", "square", "landscape"]).optional(),
  colorTone: z.enum(["clean", "neutral", "warm"]).optional(),
  emphasis: z.enum(["visual", "balanced", "text"]).optional(),
});

export const annotationSchema = z.object({
  id: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    pageNumber: z.number().int().positive(),
  }),
  imageOriginBase64: z.string(),
  messages: z.array(messageSchema).default([]),
  createdAt: z.number(),
});

export const tableSessionSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.enum(["csv", "xlsx"]),
  fileBase64: z.string().optional(),
  tableData: normalizedTableSchema,
  analysisData: analysisDataSchema.nullable(),
  messages: z.array(messageSchema).default([]),
  infographicMessages: z
    .array(
      z.object({
        role: z.enum(["user", "ai"]),
        content: z.string(),
        generatedImageDataUrl: z.string().optional(),
      })
    )
    .optional(),
  infographicControls: infographicControlsSchema.optional(),
  annotations: z.array(annotationSchema).optional(),
  createdAt: z.number(),
});

const dedupePages = (pages: number[]) => Array.from(new Set(pages));

export function normalizeAnalysisData(input: unknown, fallbackTitle: string): AnalysisData {
  const parsed = analysisDataSchema.safeParse(input);
  if (!parsed.success) {
    return {
      title: fallbackTitle,
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
      tableContext: "",
      status: "pending",
    };
  }

  const data = parsed.data;
  return {
    title: data.title?.trim() || fallbackTitle,
    summaries: data.summaries.map((summary) => ({
      title: summary.title,
      content: summary.content,
      lines: summary.lines?.map((line) => ({
        text: line.text,
        pages: dedupePages(line.pages),
      })),
    })),
    keywords: data.keywords.filter((k) => k.trim().length > 0),
    insights: data.insights,
    issues: Array.isArray(data.issues)
      ? data.issues.map((line) => ({ text: line.text, pages: dedupePages(line.pages) }))
      : data.issues,
    generatedLayoutPlans: data.generatedLayoutPlans,
    selectedLayoutPlanId: data.selectedLayoutPlanId,
    generatedLayoutPlan: data.generatedLayoutPlan,
    layoutPlan: data.layoutPlan,
    generatedInfographicPrompt: data.generatedInfographicPrompt,
    infographicPrompt: data.infographicPrompt,
    tableContext: data.tableContext,
    tableData: data.tableData,
    status: data.status,
  };
}
