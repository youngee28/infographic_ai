import { resolveLogicalTableId, resolveLogicalTableIds } from "@/lib/table-id-resolution";
import type { AnalysisData, LayoutPlan } from "@/lib/session-types";

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

export function resolveSelectedLayoutPlan(analysisData?: AnalysisData | null): LayoutPlan | undefined {
  if (!analysisData) return undefined;
  return getSelectedLayoutPlan(
    analysisData.generatedLayoutPlans,
    analysisData.selectedLayoutPlanId,
    analysisData.layoutPlan ?? analysisData.generatedLayoutPlan
  );
}

export function canonicalizeLayoutPlans(layoutPlans: LayoutPlan[] | undefined, aliases: Map<string, string>): LayoutPlan[] | undefined {
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
