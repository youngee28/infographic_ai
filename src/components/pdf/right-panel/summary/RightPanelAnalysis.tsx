import type { AnalysisData } from "@/lib/session-types";
import {
  getFindingsSummaryVariant,
  getImplicationsSummaryVariant,
  getTableInsightCards,
  getTableChartRecommendationCaptionItems,
  getSourceTables,
  getTableRelations,
} from "@/lib/analysis-selectors";
import { TableContextCaption } from "./chart/TableContextCaption";
import { ReviewBanner } from "./info/ReviewBanner";
import { SourceInventoryPanel } from "./info/SourceInventoryPanel";
import { DetailedSummary } from "./insights/DetailedSummary";
import { TableInfographicFocusPanel } from "./insights/TableInfographicFocusPanel";
import { ThreeLineSummary } from "./insights/ThreeLineSummary";

interface RightPanelAnalysisProps {
  analysisData: AnalysisData;
  onCitationClick?: (page: number) => void;
}

export function RightPanelAnalysis({ analysisData, onCitationClick }: RightPanelAnalysisProps) {
  const reviewReasons = Array.from(new Set([
    ...(analysisData.reviewReasons ?? []),
    ...(analysisData.sheetStructure?.reviewReason ? [analysisData.sheetStructure.reviewReason] : []),
  ]));
  const tables = getSourceTables(analysisData);
  const relations = getTableRelations(analysisData);
  const tableInsightCards = getTableInsightCards(analysisData);
  const tableChartRecommendationCaptionItems = getTableChartRecommendationCaptionItems(analysisData);
  const findingsSummary = getFindingsSummaryVariant(analysisData);
  const implicationsSummary = getImplicationsSummaryVariant(analysisData);

  return (
    <>
      <ReviewBanner reasons={reviewReasons} />
      <SourceInventoryPanel tables={tables} relations={relations} />
      <TableContextCaption items={tableChartRecommendationCaptionItems} />
      <TableInfographicFocusPanel cards={tableInsightCards} />
      <ThreeLineSummary summary={findingsSummary} onCitationClick={onCitationClick} />
      <DetailedSummary summary={implicationsSummary} onCitationClick={onCitationClick} />
    </>
  );
}
