import { resolveLogicalTableId, resolveLogicalTableIds } from "@/lib/table-id-resolution";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";

function buildChartSignature(plan: LayoutPlan): string {
  return JSON.stringify(
    plan.sections.flatMap((section) =>
      (section.charts ?? []).map((chart) => ({
        chartType: chart.chartType,
        dimension: chart.dimension ?? "",
        metric: chart.metric ?? "",
      }))
    )
  );
}

export function getSelectedLayoutPlan(
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
      const fallbackChartSignature = buildChartSignature(fallbackPlan);

      const semanticallyMatchedPlan = layoutPlans.find((plan) => {
        const planChartSignature = buildChartSignature(plan);
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

export function resolveSelectedLayoutPlan(analysisData?: AnalysisData | null): LayoutPlan | undefined {
  if (!analysisData) return undefined;
  return analysisData.layoutPlan
    ?? getSelectedLayoutPlan(
      analysisData.generatedLayoutPlans,
      analysisData.selectedLayoutPlanId,
      analysisData.generatedLayoutPlan
    )
    ?? analysisData.generatedLayoutPlan;
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

export function canonicalizeLayoutPlans(layoutPlans: LayoutPlan[] | undefined, aliases: Map<string, string>): LayoutPlan[] | undefined {
  return layoutPlans?.map((plan) => canonicalizeLayoutPlan(plan, aliases) ?? plan);
}

export function buildAnalysisWithSingleLayoutPlan(analysisData: AnalysisData, layoutPlan?: LayoutPlan): AnalysisData {
  return {
    ...analysisData,
    generatedLayoutPlans: undefined,
    selectedLayoutPlanId: undefined,
    generatedLayoutPlan: undefined,
    layoutPlan,
  };
}
