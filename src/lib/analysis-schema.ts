import { z } from "zod";
import type { AnalysisData } from "@/lib/session-types";

export const chartRecommendationSchema = z.object({
  tableId: z.string().trim().optional(),
  chartType: z.enum(["bar", "line", "donut", "pie", "stacked-bar", "map"]),
  dimension: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  score: z.number(),
});

export const referenceLineSchema = z.object({
  text: z.string().trim().min(1),
  pages: z.array(z.coerce.number().int().positive()).default([]),
});

export const summaryVariantSchema = z.object({
  title: z.string().trim().min(1).default("요약"),
  content: z.string().optional(),
  lines: z.array(referenceLineSchema).optional(),
});

export const evidenceRefSchema = z.object({
  tableId: z.string().trim().min(1),
  rowHints: z.array(z.string().trim().min(1)).default([]),
  pages: z.array(z.coerce.number().int().positive()).default([]),
});

export const sourceTableSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.enum(["primary", "supporting", "comparison", "breakdown", "trend", "reference"]),
  purpose: z.string().trim().min(1),
  context: z.string().trim().min(1),
  dimensions: z.array(z.string().trim().min(1)).default([]),
  metrics: z.array(z.string().trim().min(1)).default([]),
  grain: z.string().trim().optional(),
  keyTakeaway: z.string().trim().optional(),
  structure: z.enum(["row-major", "column-major", "mixed", "ambiguous"]).optional(),
  rangeLabel: z.string().trim().optional(),
  headerSummary: z.string().trim().optional(),
});

export const analysisTableHeaderSchema = z.object({
  axis: z.enum(["row", "column", "mixed", "ambiguous"]),
  headerRows: z.array(z.number().int().positive()).optional(),
  headerCols: z.array(z.number().int().positive()).optional(),
});

export const analysisStructuredTableSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  structure: z.enum(["row-major", "column-major", "mixed", "ambiguous"]),
  confidence: z.number(),
  range: z.object({
    startRow: z.number().int().positive(),
    endRow: z.number().int().positive(),
    startCol: z.number().int().positive(),
    endCol: z.number().int().positive(),
  }),
  header: analysisTableHeaderSchema,
  dataRegion: z.object({
    startRow: z.number().int().positive(),
    endRow: z.number().int().positive(),
    startCol: z.number().int().positive(),
    endCol: z.number().int().positive(),
  }).optional(),
  dimensions: z.array(z.string().trim().min(1)).default([]),
  metrics: z.array(z.string().trim().min(1)).default([]),
  notes: z.array(z.string().trim().min(1)).optional(),
  needsReview: z.boolean().optional(),
  reviewReasons: z.array(z.string().trim().min(1)).optional(),
  candidates: z.array(z.object({
    range: z.object({
      startRow: z.number().int().positive(),
      endRow: z.number().int().positive(),
      startCol: z.number().int().positive(),
      endCol: z.number().int().positive(),
    }),
    structure: z.enum(["row-major", "column-major", "mixed", "ambiguous"]),
    confidence: z.number(),
    reason: z.string().trim().optional(),
  })).optional(),
});

export const analysisSheetStructureSchema = z.object({
  sheetName: z.string().trim().optional(),
  tableCount: z.number().int().nonnegative(),
  needsReview: z.boolean().optional(),
  reviewReason: z.string().trim().optional(),
  tables: z.array(analysisStructuredTableSchema).default([]),
});


export const tableRelationSchema = z.object({
  fromTableId: z.string().trim().min(1),
  toTableId: z.string().trim().min(1),
  type: z.enum(["same_entity", "comparison", "explains_driver", "breakdown_of", "time_continuation", "reference_for"]),
  description: z.string().trim().min(1),
});

export const narrativeItemSchema = z.object({
  text: z.string().trim().min(1),
  sourceTableIds: z.array(z.string().trim().min(1)).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  audience: z.enum(["general", "business", "executive"]).optional(),
});

export const layoutGeometrySchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().positive().max(100),
  height: z.number().positive().max(100),
}).superRefine((value, ctx) => {
  if (value.x + value.width > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "x + width must be within 100",
      path: ["width"],
    });
  }

  if (value.y + value.height > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "y + height must be within 100",
      path: ["height"],
    });
  }
});

export const layoutBlockStyleSchema = z.object({
  backgroundColor: z.string().trim().optional(),
  borderColor: z.string().trim().optional(),
  borderWidth: z.number().nonnegative().optional(),
  borderRadius: z.number().nonnegative().optional(),
  padding: z.object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
  }).optional(),
  textColor: z.string().trim().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
});

const layoutBlockBaseSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(["group", "heading", "text", "chart", "kpi"]),
  region: z.enum(["header", "canvas"]),
  parentId: z.string().trim().min(1).optional(),
  childIds: z.array(z.string().trim().min(1)).optional(),
  name: z.string().trim().optional(),
  layout: layoutGeometrySchema,
  style: layoutBlockStyleSchema.optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  zIndex: z.number().int().optional(),
});

export const layoutGroupBlockSchema = layoutBlockBaseSchema.extend({
  type: z.literal("group"),
  childIds: z.array(z.string().trim().min(1)).default([]),
  content: z.object({
    role: z.enum(["header", "chart-group", "kpi-group", "takeaway", "note", "generic"]),
    sectionId: z.string().trim().optional(),
  }),
});

export const layoutHeadingBlockSchema = layoutBlockBaseSchema.extend({
  type: z.literal("heading"),
  content: z.object({
    text: z.string(),
    sectionId: z.string().trim().optional(),
  }),
});

export const layoutTextBlockSchema = layoutBlockBaseSchema.extend({
  type: z.literal("text"),
  content: z.object({
    text: z.string(),
    sectionId: z.string().trim().optional(),
  }),
});

export const layoutChartBlockSchema = layoutBlockBaseSchema.extend({
  type: z.literal("chart"),
  content: z.object({
    sectionId: z.string().trim().min(1),
    chartId: z.string().trim().min(1),
    tableId: z.string().trim().optional(),
    chartType: z.enum(["bar", "line", "donut", "pie", "stacked-bar", "map"]),
    title: z.string(),
    goal: z.string(),
    dimension: z.string().trim().optional(),
    metric: z.string().trim().optional(),
  }),
});

export const layoutKpiBlockSchema = layoutBlockBaseSchema.extend({
  type: z.literal("kpi"),
  content: z.object({
    sectionId: z.string().trim().min(1),
    itemId: z.string().trim().min(1),
    tableId: z.string().trim().optional(),
    label: z.string(),
    value: z.string(),
    note: z.string().optional(),
  }),
});

export const layoutBlockSchema = z.discriminatedUnion("type", [
  layoutGroupBlockSchema,
  layoutHeadingBlockSchema,
  layoutTextBlockSchema,
  layoutChartBlockSchema,
  layoutKpiBlockSchema,
]);

export const layoutBlockTreeSchema = z.object({
  rootIds: z.array(z.string().trim().min(1)).default([]),
  blocks: z.record(z.string().trim().min(1), layoutBlockSchema),
});

export const layoutChartSpecSchema = z.object({
  id: z.string().trim().min(1),
  tableId: z.string().trim().optional(),
  chartType: z.enum(["bar", "line", "donut", "pie", "stacked-bar", "map"]),
  title: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  dimension: z.string().trim().optional(),
  metric: z.string().trim().optional(),
  layout: layoutGeometrySchema.optional(),
});

export const layoutKpiItemSchema = z.object({
  id: z.string().trim().min(1),
  tableId: z.string().trim().optional(),
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  layout: layoutGeometrySchema.optional(),
});

export const layoutSectionSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(["header", "chart-group", "kpi-group", "takeaway", "note"]),
  sourceTableIds: z.array(z.string().trim().min(1)).optional(),
  title: z.string().trim().optional(),
  layout: layoutGeometrySchema.optional(),
  titleLayout: layoutGeometrySchema.optional(),
  charts: z.array(layoutChartSpecSchema).optional(),
  items: z.array(layoutKpiItemSchema).optional(),
  note: z.string().trim().optional(),
  noteLayout: layoutGeometrySchema.optional(),
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
  layoutTree: layoutBlockTreeSchema.optional(),
  headerTitleLayout: layoutGeometrySchema.optional(),
  headerSummaryLayout: layoutGeometrySchema.optional(),
  previewImageDataUrl: z.string().optional(),
  sections: z.array(layoutSectionSchema).default([]),
  visualPolicy: layoutVisualPolicySchema,
});

export const tableInterpretationResultSchema = z.object({
  tableId: z.string().trim().min(1),
  findings: z.array(narrativeItemSchema).default([]),
  implications: z.array(narrativeItemSchema).default([]),
  cautions: z.array(narrativeItemSchema).default([]),
  layoutPlans: z.array(layoutPlanSchema).optional(),
  infographicPrompt: z.string().trim().optional(),
});

function normalizeLegacyLayoutPlan(value: unknown, fallbackId = "layout-option-1"): z.infer<typeof layoutPlanSchema> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    previewImageDataUrl?: unknown;
    layoutType?: unknown;
    aspectRatio?: unknown;
    layoutTree?: unknown;
    headerTitleLayout?: unknown;
    headerSummaryLayout?: unknown;
    sections?: unknown;
    visualPolicy?: unknown;
  };

  const normalizeGeometry = (geometry: unknown) => {
    const layoutCandidate = geometry as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
    return typeof layoutCandidate?.x === "number" &&
      typeof layoutCandidate?.y === "number" &&
      typeof layoutCandidate?.width === "number" &&
      typeof layoutCandidate?.height === "number"
      ? (() => {
          const x = Math.max(0, Math.min(100, layoutCandidate.x));
          const y = Math.max(0, Math.min(100, layoutCandidate.y));
          const width = Math.max(1, Math.min(100 - x, layoutCandidate.width));
          const height = Math.max(1, Math.min(100 - y, layoutCandidate.height));
          return { x, y, width, height };
        })()
      : undefined;
  };

  const normalizeLayoutTree = (value: unknown) => {
    const parsed = layoutBlockTreeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

  const aspectRatio = candidate.aspectRatio;
  if (candidate.layoutType !== "dashboard") return undefined;
  if (aspectRatio !== "portrait" && aspectRatio !== "square" && aspectRatio !== "landscape") return undefined;

  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.flatMap((section, sectionIndex) => {
        if (!section || typeof section !== "object") return [];
        const next = section as {
          id?: unknown;
          type?: unknown;
          title?: unknown;
          layout?: unknown;
          titleLayout?: unknown;
          charts?: unknown;
          chartType?: unknown;
          goal?: unknown;
          chartId?: unknown;
          dimension?: unknown;
          metric?: unknown;
          items?: unknown;
          note?: unknown;
          noteLayout?: unknown;
        };

        const normalizedType = next.type === "chart" ? "chart-group" : next.type;
        if (normalizedType !== "header" && normalizedType !== "chart-group" && normalizedType !== "kpi-group" && normalizedType !== "takeaway" && normalizedType !== "note") {
          return [];
        }
        const rawType: "header" | "chart-group" | "kpi-group" | "takeaway" | "note" = normalizedType;

        const charts = Array.isArray(next.charts)
          ? next.charts.flatMap((chart, chartIndex) => {
              if (!chart || typeof chart !== "object") return [];
              const chartCandidate = chart as {
                id?: unknown;
                chartType?: unknown;
                title?: unknown;
                goal?: unknown;
                dimension?: unknown;
                metric?: unknown;
                layout?: unknown;
              };
              if (
                chartCandidate.chartType !== "bar" &&
                chartCandidate.chartType !== "line" &&
                chartCandidate.chartType !== "donut" &&
                chartCandidate.chartType !== "pie" &&
                chartCandidate.chartType !== "stacked-bar" &&
                chartCandidate.chartType !== "map"
              ) {
                return [];
              }
              const title = typeof chartCandidate.title === "string" ? chartCandidate.title.trim() : "";
              const goal = typeof chartCandidate.goal === "string" ? chartCandidate.goal.trim() : "";
              if (!title || !goal) return [];
              const chartType: "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map" = chartCandidate.chartType;
              return [{
                id: typeof chartCandidate.id === "string" && chartCandidate.id.trim() ? chartCandidate.id.trim() : `chart-${sectionIndex + 1}-${chartIndex + 1}`,
                chartType,
                title,
                goal,
                dimension: typeof chartCandidate.dimension === "string" && chartCandidate.dimension.trim() ? chartCandidate.dimension.trim() : undefined,
                metric: typeof chartCandidate.metric === "string" && chartCandidate.metric.trim() ? chartCandidate.metric.trim() : undefined,
                layout: normalizeGeometry(chartCandidate.layout),
              }];
            })
          : rawType === "chart-group" &&
              (next.chartType === "bar" || next.chartType === "line" || next.chartType === "donut" || next.chartType === "pie" || next.chartType === "stacked-bar" || next.chartType === "map") &&
              typeof next.title === "string" &&
              next.title.trim() &&
              typeof next.goal === "string" &&
              next.goal.trim()
            ? (() => {
                const chartType: "bar" | "line" | "donut" | "pie" | "stacked-bar" | "map" = next.chartType;
                return [{
                id: typeof next.chartId === "string" && next.chartId.trim() ? next.chartId.trim() : `chart-${sectionIndex + 1}-1`,
                chartType,
                title: next.title.trim(),
                goal: next.goal.trim(),
                dimension: typeof next.dimension === "string" && next.dimension.trim() ? next.dimension.trim() : undefined,
                metric: typeof next.metric === "string" && next.metric.trim() ? next.metric.trim() : undefined,
                layout: undefined,
              }];
            })()
            : undefined;

        const layout = normalizeGeometry(next.layout);

        const items = Array.isArray(next.items)
          ? next.items.flatMap((item, itemIndex) => {
              if (!item || typeof item !== "object") return [];
              const itemCandidate = item as { id?: unknown; label?: unknown; value?: unknown; layout?: unknown };
              const label = typeof itemCandidate.label === "string" ? itemCandidate.label.trim() : "";
              const value = typeof itemCandidate.value === "string" ? itemCandidate.value.trim() : "";
              return label && value
                ? [{
                    id: typeof itemCandidate.id === "string" && itemCandidate.id.trim() ? itemCandidate.id.trim() : `item-${sectionIndex + 1}-${itemIndex + 1}`,
                    label,
                    value,
                    layout: normalizeGeometry(itemCandidate.layout),
                  }]
                : [];
            })
          : undefined;

        return [{
          id: typeof next.id === "string" && next.id.trim() ? next.id.trim() : `section-${sectionIndex + 1}`,
          type: rawType,
          title: typeof next.title === "string" && next.title.trim() ? next.title.trim() : undefined,
          layout,
          titleLayout: normalizeGeometry(next.titleLayout),
          charts: charts && charts.length > 0 ? charts : undefined,
          items: items && items.length > 0 ? items : undefined,
          note: typeof next.note === "string" && next.note.trim() ? next.note.trim() : undefined,
          noteLayout: normalizeGeometry(next.noteLayout),
        }];
      })
    : [];

  if (sections.length === 0) return undefined;

  const visualPolicyCandidate = candidate.visualPolicy as { textRatio?: unknown; chartRatio?: unknown; iconRatio?: unknown } | undefined;
  const textRatio = typeof visualPolicyCandidate?.textRatio === "number" ? visualPolicyCandidate.textRatio : 0.15;
  const chartRatio = typeof visualPolicyCandidate?.chartRatio === "number" ? visualPolicyCandidate.chartRatio : 0.75;
  const iconRatio = typeof visualPolicyCandidate?.iconRatio === "number" ? visualPolicyCandidate.iconRatio : 0.1;
  const ratioTotal = textRatio + chartRatio + iconRatio;

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : fallbackId,
    layoutType: "dashboard",
    aspectRatio,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : undefined,
    description: typeof candidate.description === "string" && candidate.description.trim() ? candidate.description.trim() : undefined,
    layoutTree: normalizeLayoutTree(candidate.layoutTree),
    headerTitleLayout: normalizeGeometry(candidate.headerTitleLayout),
    headerSummaryLayout: normalizeGeometry(candidate.headerSummaryLayout),
    previewImageDataUrl: typeof candidate.previewImageDataUrl === "string" && candidate.previewImageDataUrl.trim() ? candidate.previewImageDataUrl.trim() : undefined,
    sections,
    visualPolicy: ratioTotal > 0
      ? {
          textRatio: textRatio / ratioTotal,
          chartRatio: chartRatio / ratioTotal,
          iconRatio: iconRatio / ratioTotal,
        }
      : { textRatio: 0.15, chartRatio: 0.75, iconRatio: 0.1 },
  };
}

function normalizeLegacyLayoutPlans(value: unknown): z.infer<typeof layoutPlanSchema>[] | undefined {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  const plans = candidates
    .map((candidate, index) => normalizeLegacyLayoutPlan(candidate, `layout-option-${index + 1}`))
    .filter((plan): plan is z.infer<typeof layoutPlanSchema> => plan !== undefined);
  return plans.length > 0 ? plans : undefined;
}

export const normalizedTableSchema = z.object({
  sheetName: z.string().optional(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())).default([]),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  normalizationNotes: z.array(z.string()).optional(),
  sourceType: z.enum(["csv", "xlsx"]).optional(),
  logicalTables: z.array(
    z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1),
      source: z.enum(["detected", "sheet"]),
      orientation: z.enum(["row-major", "column-major", "ambiguous"]),
      headerAxis: z.enum(["row", "column", "ambiguous"]),
      confidence: z.number(),
      startRow: z.number().int().positive(),
      endRow: z.number().int().positive(),
      startCol: z.number().int().positive(),
      endCol: z.number().int().positive(),
      columns: z.array(z.string()).default([]),
      rows: z.array(z.array(z.string())).default([]),
      rowCount: z.number().int().nonnegative(),
      columnCount: z.number().int().nonnegative(),
      normalizationNotes: z.array(z.string()).optional(),
    })
  ).optional(),
  primaryLogicalTableId: z.string().trim().optional(),
});

export const rawSheetGridSchema = z.object({
  fileType: z.enum(["csv", "xlsx"]),
  sheetName: z.string().optional(),
  rows: z.array(z.array(z.string())).default([]),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
});

export const visualizationBriefSchema = z.object({
  headline: z.string().trim().min(1),
  coreMessage: z.string().trim().min(1),
  primaryTableId: z.string().trim().min(1),
  supportingTableIds: z.array(z.string().trim().min(1)).default([]),
  storyFlow: z.array(z.string().trim().min(1)).default([]),
  chartDirections: z.array(
    z.object({
      tableId: z.string().trim().min(1),
      chartType: z.enum(["bar", "line", "donut", "pie", "stacked-bar", "map"]),
      goal: z.string().trim().min(1),
    })
  ).default([]),
  tone: z.enum(["practical", "executive", "editorial"]).default("practical"),
  prompt: z.string().trim().optional(),
});

export const analysisDataSchema = z.object({
  schemaVersion: z.enum(["1", "2", "3"]).optional(),
  title: z.string().trim().optional(),
  dataset: z.object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    tableCount: z.number().int().nonnegative(),
    sourceType: z.enum(["csv", "xlsx"]).optional(),
  }).optional(),
  sheetStructure: analysisSheetStructureSchema.optional(),
  sourceInventory: z.object({
    tables: z.array(sourceTableSchema).default([]),
    relations: z.array(tableRelationSchema).default([]),
  }).optional(),
  findings: z.array(narrativeItemSchema).optional(),
  implications: z.array(narrativeItemSchema).optional(),
  cautions: z.array(narrativeItemSchema).optional(),
  askNext: z.array(z.string().trim().min(1)).max(3).optional(),
  visualizationBrief: visualizationBriefSchema.optional(),
  summaries: z.array(summaryVariantSchema).default([]),
  keywords: z.array(z.string()).default([]),
  insights: z.string().default(""),
  issues: z.union([z.string(), z.array(referenceLineSchema)]).default(""),
  selectedSourceTableIds: z.array(z.string().trim().min(1)).optional(),
  chartRecommendations: z.array(chartRecommendationSchema).optional(),
  generatedLayoutPlans: z.preprocess((value) => normalizeLegacyLayoutPlans(value), z.array(layoutPlanSchema).optional()),
  selectedLayoutPlanId: z.string().trim().optional(),
  generatedLayoutPlan: z.preprocess((value) => normalizeLegacyLayoutPlan(value), layoutPlanSchema.optional()),
  layoutPlan: z.preprocess((value) => normalizeLegacyLayoutPlan(value), layoutPlanSchema.optional()),
  generatedInfographicPrompt: z.string().optional(),
  infographicPrompt: z.string().optional(),
  tableContext: z.string().optional(),
  tableData: normalizedTableSchema.optional(),
  reviewReasons: z.array(z.string().trim().min(1)).optional(),
  tableInterpretations: z.array(tableInterpretationResultSchema).optional(),
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
  rawSheetGrid: rawSheetGridSchema.optional(),
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

function compactUnique(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseLegacyQuestions(value: string): string[] {
  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return compactUnique(parsed.filter((item): item is string => typeof item === "string")).slice(0, 3);
      }
    } catch {}
  }
  return compactUnique(raw.split(/\n+|\s+(?=\d+[.)]\s*)|[;|]/)).slice(0, 3);
}

function narrativeLines(items: Array<{ text: string; evidence: Array<{ pages: number[] }> }> | undefined) {
  return (items ?? [])
    .map((item) => ({
      text: item.text,
      pages: dedupePages(item.evidence.flatMap((entry) => entry.pages)),
    }))
    .filter((item) => item.text.trim().length > 0);
}

function deriveSourceInventory(data: z.infer<typeof analysisDataSchema>, title: string) {
  if (data.sheetStructure?.tables.length) {
    const primaryStructuredTableId = data.visualizationBrief?.primaryTableId ?? data.sheetStructure.tables[0]?.id;
    const structuredTables = data.sheetStructure.tables.map((table, index) => ({
      id: table.id,
      name: table.title,
      role: table.id === primaryStructuredTableId ? "primary" as const : table.structure === "column-major" ? "reference" as const : "supporting" as const,
      purpose:
        table.structure === "mixed"
          ? "행과 열 헤더가 혼합된 표 구조를 파악"
          : table.structure === "column-major"
            ? "열 방향 표 구조 파악"
            : table.structure === "ambiguous"
              ? "구조가 애매한 표 후보 검토"
              : "행 방향 표 구조 파악",
      context: `${table.range.startRow}-${table.range.endRow}행, ${table.range.startCol}-${table.range.endCol}열 범위의 구조화 표입니다.`,
      dimensions: table.dimensions,
      metrics: table.metrics,
      grain: table.structure,
      keyTakeaway: table.id === primaryStructuredTableId ? data.summaries[0]?.lines?.[0]?.text : undefined,
      structure: table.structure,
      rangeLabel: `R${table.range.startRow}-R${table.range.endRow} / C${table.range.startCol}-C${table.range.endCol}`,
      headerSummary:
        table.header.axis === "mixed"
          ? `행 헤더 ${table.header.headerRows?.join(", ") || "-"}, 열 헤더 ${table.header.headerCols?.join(", ") || "-"}`
          : table.header.axis === "row"
            ? `헤더 행 ${table.header.headerRows?.join(", ") || "-"}`
            : table.header.axis === "column"
              ? `헤더 열 ${table.header.headerCols?.join(", ") || "-"}`
              : "헤더 축이 불명확함",
    }));

    return {
      tables: data.sourceInventory?.tables.length
        ? structuredTables.map((table) => {
            const existing = data.sourceInventory?.tables.find((candidate) => candidate.id === table.id);
            return existing ? { ...table, ...existing, id: table.id } : table;
          })
        : structuredTables,
      relations: data.sourceInventory?.relations ?? [],
    };
  }

  if (!data.tableData) {
    return data.sourceInventory ?? { tables: [], relations: [] };
  }

  const primaryLogicalTableId = data.tableData.primaryLogicalTableId ?? data.tableData.logicalTables?.[0]?.id;
  const derivedLogicalTables = data.tableData.logicalTables && data.tableData.logicalTables.length > 0
    ? data.tableData.logicalTables.map((table) => ({
        id: table.id,
        name: table.name,
        role: table.id === primaryLogicalTableId
          ? "primary" as const
          : table.orientation === "column-major"
            ? "reference" as const
            : "supporting" as const,
        purpose: table.orientation === "column-major" ? "열 방향 표 구조 파악" : "행 방향 표 구조 파악",
        context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열 범위의 논리 표입니다.`,
        dimensions: table.columns.slice(0, 2),
        metrics: table.columns.slice(2),
        grain: table.orientation,
        keyTakeaway: table.id === primaryLogicalTableId ? data.summaries[0]?.lines?.[0]?.text : undefined,
        structure: table.orientation,
        rangeLabel: `R${table.startRow}-R${table.endRow} / C${table.startCol}-C${table.endCol}`,
        headerSummary: table.headerAxis === "row" ? "헤더 행 기준" : table.headerAxis === "column" ? "헤더 열 기준" : "헤더 축이 불명확함",
      }))
    : null;

  if (data.sourceInventory?.tables.length) {
    return {
      tables: derivedLogicalTables
        ? derivedLogicalTables.map((table) => {
            const existing = data.sourceInventory?.tables.find((candidate) => candidate.id === table.id);
            return existing ? { ...table, ...existing, id: table.id } : table;
          })
        : data.sourceInventory.tables,
      relations: data.sourceInventory.relations,
    };
  }

  return {
    tables: [
      ...(derivedLogicalTables
        ? derivedLogicalTables
        : [{
            id: "table-1",
            name: data.tableData.sheetName?.trim() || title,
            role: "primary" as const,
            purpose: "핵심 데이터 구조 파악",
            context: data.tableContext?.trim() || "업로드된 표의 핵심 구조와 수치를 해석하기 위한 기본 표입니다.",
            dimensions: data.tableData.columns.slice(0, 2),
            metrics: data.tableData.columns.slice(2),
            grain: data.tableData.sheetName ? "sheet" : undefined,
            keyTakeaway: data.summaries[0]?.lines?.[0]?.text,
          }]),
    ],
    relations: [],
  };
}

function deriveNarrativeItems(
  current: z.infer<typeof narrativeItemSchema>[] | undefined,
  fallbackSummary?: z.infer<typeof summaryVariantSchema>,
  fallbackIssues?: string | z.infer<typeof referenceLineSchema>[]
) {
  if (current && current.length > 0) return current;
  if (fallbackSummary?.lines?.length) {
    return fallbackSummary.lines.map((line) => ({
      text: line.text,
      sourceTableIds: [],
      evidence: line.pages.length > 0 ? [{ tableId: "table-1", rowHints: [], pages: line.pages }] : [],
    }));
  }
  if (fallbackSummary?.content?.trim()) {
    return [{ text: fallbackSummary.content.trim(), sourceTableIds: [], evidence: [] }];
  }
  if (fallbackIssues) {
    if (Array.isArray(fallbackIssues)) {
      return fallbackIssues.map((line) => ({
        text: line.text,
        sourceTableIds: [],
        evidence: line.pages.length > 0 ? [{ tableId: "table-1", rowHints: [], pages: line.pages }] : [],
      }));
    }
    if (fallbackIssues.trim()) {
      return [{ text: fallbackIssues.trim(), sourceTableIds: [], evidence: [] }];
    }
  }
  return [];
}

function deriveVisualizationBrief(data: z.infer<typeof analysisDataSchema>, title: string, primaryTableId: string) {
  if (data.visualizationBrief) {
    return data.visualizationBrief;
  }

  const headline = title;
  const coreMessage =
    data.summaries[0]?.lines?.[0]?.text ||
    data.summaries[1]?.lines?.[0]?.text ||
    data.tableContext?.trim() ||
    "핵심 변화와 비교 포인트가 잘 드러나는 구조로 정리합니다.";
  const storyFlow = compactUnique([
    data.summaries[0]?.title,
    data.summaries[1]?.title,
    Array.isArray(data.issues) ? data.issues[0]?.text : data.issues,
  ]);

  const selectedSourceTableIds = data.selectedSourceTableIds?.length
    ? compactUnique(data.selectedSourceTableIds)
    : [primaryTableId];
  const effectivePrimaryTableId = selectedSourceTableIds[0] ?? primaryTableId;

  return {
    headline,
    coreMessage,
    primaryTableId: effectivePrimaryTableId,
    supportingTableIds: selectedSourceTableIds.slice(1),
    storyFlow: storyFlow.length > 0 ? storyFlow : ["핵심 흐름 파악", "비교 포인트 정리", "실무 시사점 제안"],
    chartDirections: (data.chartRecommendations ?? []).slice(0, 3).map((item) => ({
      tableId: item.tableId?.trim() || effectivePrimaryTableId,
      chartType: item.chartType,
      goal: item.reason,
    })),
    tone: "practical" as const,
    prompt: data.infographicPrompt?.trim() || data.generatedInfographicPrompt?.trim() || undefined,
  };
}

function deriveKeywords(data: z.infer<typeof analysisDataSchema>, sourceInventory: { tables: z.infer<typeof sourceTableSchema>[] }) {
  if (data.keywords.length > 0) {
    return data.keywords.filter((k) => k.trim().length > 0);
  }
  return compactUnique(sourceInventory.tables.flatMap((table) => [table.name, ...table.dimensions, ...table.metrics])).slice(0, 6);
}

export function normalizeAnalysisData(input: unknown, fallbackTitle: string): AnalysisData {
  const parsed = analysisDataSchema.safeParse(input);
  if (!parsed.success) {
    const raw = input && typeof input === "object" ? input as Record<string, unknown> : null;
    const rawTableData = raw?.tableData ? normalizedTableSchema.safeParse(raw.tableData) : null;
    const rawSheetStructure = raw?.sheetStructure ? analysisSheetStructureSchema.safeParse(raw.sheetStructure) : null;
    const rawTitle = typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim() : fallbackTitle;
    const rawTableContext = typeof raw?.tableContext === "string" ? raw.tableContext : "";
    const rawStatus = raw?.status === "pending" || raw?.status === "complete" ? raw.status : undefined;
    const hasContent = Boolean(rawTitle || rawTableContext || rawTableData?.success);
    const fallbackTableCount = rawSheetStructure?.success
      ? rawSheetStructure.data.tableCount
      : rawTableData?.success
        ? rawTableData.data.logicalTables?.length ?? (rawTableData.data.rowCount > 0 ? 1 : 0)
        : 0;
    return {
      schemaVersion: "3",
      title: rawTitle,
      dataset: {
        title: rawTitle,
        summary: rawTableContext,
        tableCount: fallbackTableCount,
        sourceType: rawTableData?.success ? rawTableData.data.sourceType : undefined,
      },
      sheetStructure: rawSheetStructure?.success
        ? rawSheetStructure.data
        : rawTableData?.success
        ? {
            sheetName: rawTableData.data.sheetName,
            tableCount: rawTableData.data.logicalTables?.length ?? (rawTableData.data.rowCount > 0 ? 1 : 0),
            tables: rawTableData.data.logicalTables?.map((table) => ({
              id: table.id,
              title: table.name,
              structure: table.orientation,
              confidence: table.confidence,
              range: {
                startRow: table.startRow,
                endRow: table.endRow,
                startCol: table.startCol,
                endCol: table.endCol,
              },
              header: {
                axis: table.headerAxis === "row" ? "row" : table.headerAxis === "column" ? "column" : "ambiguous",
              },
              dimensions: table.columns.slice(0, 2),
              metrics: table.columns.slice(2),
              notes: table.normalizationNotes,
            })) ?? (rawTableData.data.rowCount > 0 ? [{
              id: "table-1",
              title: rawTableData.data.sheetName?.trim() || rawTitle,
              structure: "ambiguous" as const,
              confidence: 0.4,
              range: { startRow: 1, endRow: Math.max(1, rawTableData.data.rowCount + 1), startCol: 1, endCol: Math.max(1, rawTableData.data.columnCount) },
              header: { axis: "ambiguous" as const },
              dimensions: rawTableData.data.columns.slice(0, 2),
              metrics: rawTableData.data.columns.slice(2),
            }] : []),
          }
        : undefined,
      sourceInventory: {
        tables: rawTableData?.success
          ? rawTableData.data.logicalTables && rawTableData.data.logicalTables.length > 0
            ? rawTableData.data.logicalTables.map((table) => ({
                id: table.id,
                name: table.name,
                role: table.id === (rawTableData.data.primaryLogicalTableId ?? rawTableData.data.logicalTables?.[0]?.id) ? "primary" : table.orientation === "column-major" ? "reference" : "supporting",
                purpose: table.orientation === "column-major" ? "열 방향 표 구조 파악" : "행 방향 표 구조 파악",
                context: `${table.startRow}-${table.endRow}행, ${table.startCol}-${table.endCol}열 범위의 논리 표입니다.`,
                dimensions: table.columns.slice(0, 2),
                metrics: table.columns.slice(2),
                grain: table.orientation,
              }))
            : [{
                id: "table-1",
                name: rawTableData.data.sheetName?.trim() || rawTitle,
                role: "primary",
                purpose: "핵심 데이터 구조 파악",
                context: rawTableContext || "업로드된 표의 핵심 구조와 수치를 해석하기 위한 기본 표입니다.",
                dimensions: rawTableData.data.columns.slice(0, 2),
                metrics: rawTableData.data.columns.slice(2),
                grain: rawTableData.data.sheetName ? "sheet" : undefined,
              }]
          : [],
        relations: [],
      },
      findings: [],
      implications: [],
      cautions: [],
      askNext: [],
      visualizationBrief: undefined,
      summaries: [],
      keywords: [],
      insights: "",
      issues: "",
      selectedSourceTableIds: undefined,
      chartRecommendations: undefined,
      generatedLayoutPlans: undefined,
      selectedLayoutPlanId: undefined,
      generatedLayoutPlan: undefined,
      layoutPlan: undefined,
      generatedInfographicPrompt: "",
      infographicPrompt: "",
      tableContext: rawTableContext,
      tableData: rawTableData?.success ? rawTableData.data : undefined,
      reviewReasons: raw?.reviewReasons && Array.isArray(raw.reviewReasons)
        ? raw.reviewReasons.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : undefined,
      tableInterpretations: raw?.tableInterpretations && Array.isArray(raw.tableInterpretations)
        ? raw.tableInterpretations.flatMap((item) => {
            const parsedInterpretation = tableInterpretationResultSchema.safeParse(item);
            return parsedInterpretation.success ? [parsedInterpretation.data] : [];
          })
        : undefined,
      status: rawStatus ?? (hasContent ? "complete" : "pending"),
    };
  }

  const data = parsed.data;
  const title = data.dataset?.title?.trim() || data.title?.trim() || fallbackTitle;
  const sourceInventory = deriveSourceInventory(data, title);
  const findings = deriveNarrativeItems(data.findings, data.summaries[0]);
  const implications = deriveNarrativeItems(data.implications, data.summaries[1]);
  const cautions = deriveNarrativeItems(data.cautions, undefined, data.issues);
  const askNext = data.askNext && data.askNext.length > 0 ? compactUnique(data.askNext).slice(0, 3) : parseLegacyQuestions(data.insights);
  const visualizationBrief = deriveVisualizationBrief(data, title, sourceInventory.tables[0]?.id ?? "table-1");
  const summaryLines = narrativeLines(findings).slice(0, 3);
  const implicationLines = narrativeLines(implications).slice(0, 4);
  const cautionLines = narrativeLines(cautions);
  const normalizedIssues = cautionLines.length > 0
    ? cautionLines
    : Array.isArray(data.issues)
      ? data.issues.map((line) => ({ text: line.text, pages: dedupePages(line.pages) }))
      : data.issues;

  return {
      schemaVersion: "3",
      title,
      dataset: {
        title,
      summary: data.dataset?.summary?.trim() || implicationLines[0]?.text || summaryLines[0]?.text || data.tableContext?.trim() || "",
      tableCount: Math.max(data.dataset?.tableCount ?? 0, sourceInventory.tables.length),
        sourceType: data.dataset?.sourceType ?? data.tableData?.sourceType,
      },
      sheetStructure: data.sheetStructure ?? (data.tableData
        ? {
            sheetName: data.tableData.sheetName,
            tableCount: data.tableData.logicalTables?.length ?? (data.tableData.rowCount > 0 ? 1 : 0),
            tables: data.tableData.logicalTables?.map((table) => ({
              id: table.id,
              title: table.name,
              structure: table.orientation,
              confidence: table.confidence,
              range: {
                startRow: table.startRow,
                endRow: table.endRow,
                startCol: table.startCol,
                endCol: table.endCol,
              },
              header: {
                axis: table.headerAxis === "row" ? "row" : table.headerAxis === "column" ? "column" : "ambiguous",
              },
              dimensions: table.columns.slice(0, 2),
              metrics: table.columns.slice(2),
              notes: table.normalizationNotes,
            })) ?? [{
              id: "table-1",
              title,
              structure: "ambiguous" as const,
              confidence: 0.4,
              range: { startRow: 1, endRow: Math.max(1, data.tableData.rowCount + 1), startCol: 1, endCol: Math.max(1, data.tableData.columnCount) },
              header: { axis: "ambiguous" as const },
              dimensions: data.tableData.columns.slice(0, 2),
              metrics: data.tableData.columns.slice(2),
            }],
          }
        : undefined),
      sourceInventory,
    findings,
    implications,
    cautions,
    askNext,
    visualizationBrief,
    summaries: [
      {
        title: data.summaries[0]?.title || "핵심 신호",
        content: data.summaries[0]?.content,
        lines: summaryLines.length > 0 ? summaryLines : data.summaries[0]?.lines?.map((line) => ({ text: line.text, pages: dedupePages(line.pages) })),
      },
      {
        title: data.summaries[1]?.title || "실무 시사점",
        content: data.summaries[1]?.content,
        lines: implicationLines.length > 0 ? implicationLines : data.summaries[1]?.lines?.map((line) => ({ text: line.text, pages: dedupePages(line.pages) })),
      },
    ].filter((summary) => summary.lines?.length || summary.content),
    keywords: deriveKeywords(data, sourceInventory),
    insights: askNext.join("\n"),
    issues: normalizedIssues,
    selectedSourceTableIds: data.selectedSourceTableIds?.length ? compactUnique(data.selectedSourceTableIds) : undefined,
    chartRecommendations: data.chartRecommendations,
    generatedLayoutPlans: data.generatedLayoutPlans,
    selectedLayoutPlanId: data.selectedLayoutPlanId,
    generatedLayoutPlan: data.generatedLayoutPlan,
    layoutPlan: data.layoutPlan,
    generatedInfographicPrompt: data.generatedInfographicPrompt ?? visualizationBrief?.prompt,
    infographicPrompt: data.infographicPrompt ?? visualizationBrief?.prompt,
    tableContext: data.tableContext,
    tableData: data.tableData,
    reviewReasons: data.reviewReasons,
    tableInterpretations: data.tableInterpretations,
    status: data.status,
  };
}
