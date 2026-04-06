import type { AnalysisData } from "@/lib/session-types";
import {
  getCautionReferenceLines,
  getFindingsSummaryVariant,
  getImplicationsSummaryVariant,
  getTableChartRecommendationCaptionItems,
  getSourceTables,
  getTableInsightContextCards,
  getTableRelations,
} from "@/lib/analysis-selectors";
import { CheckPoints } from "./CheckPoints";
import { DetailedSummary } from "./DetailedSummary";
import { ReviewBanner } from "./ReviewBanner";
import { SourceInventoryPanel } from "./SourceInventoryPanel";
import { TableContextCaption } from "./TableContextCaption";
import { TableInfographicFocusPanel } from "./TableInfographicFocusPanel";
import { ThreeLineSummary } from "./ThreeLineSummary";

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
  const tableInsightContextCards = getTableInsightContextCards(analysisData);
  const tableChartRecommendationCaptionItems = getTableChartRecommendationCaptionItems(analysisData);
  const findingsSummary = getFindingsSummaryVariant(analysisData);
  const implicationsSummary = getImplicationsSummaryVariant(analysisData);
  const cautions = getCautionReferenceLines(analysisData);

  return (
    <>
      <ReviewBanner reasons={reviewReasons} />
      <SourceInventoryPanel tables={tables} relations={relations} />
      <TableContextCaption items={tableChartRecommendationCaptionItems} />
      <TableInfographicFocusPanel cards={tableInsightContextCards} />
      <ThreeLineSummary summary={findingsSummary} onCitationClick={onCitationClick} />
      <DetailedSummary summary={implicationsSummary} onCitationClick={onCitationClick} />
      <CheckPoints issues={cautions} onCitationClick={onCitationClick} />
    </>
  );
}
