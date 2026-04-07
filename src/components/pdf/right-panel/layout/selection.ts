import { resolveLogicalTableId, resolveLogicalTableIds } from "@/lib/table-id-resolution";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";

export function resolveSelectedLayoutPlan(analysisData?: AnalysisData | null): LayoutPlan | undefined {
  return analysisData?.layoutPlan;
}

export function canonicalizeLayoutPlan(layoutPlan: LayoutPlan | undefined, aliases: Map<string, string>): LayoutPlan | undefined {
  if (!layoutPlan) return undefined;

  return {
    ...layoutPlan,
    sections: layoutPlan.sections.map((section) => ({
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
  };
}

export function buildAnalysisWithSingleLayoutPlan(analysisData: AnalysisData, layoutPlan?: LayoutPlan): AnalysisData {
  return {
    ...analysisData,
    layoutPlan,
  };
}
