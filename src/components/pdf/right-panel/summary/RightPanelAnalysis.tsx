import type { AnalysisData } from "@/lib/session-types";
import {
  getCautionReferenceLines,
  getFindingsSummaryVariant,
  getImplicationsSummaryVariant,
  getSourceTables,
  getTableContextHighlights,
  getTableRelations,
  getVisualizationBrief,
} from "@/lib/analysis-selectors";
import { CheckPoints } from "./CheckPoints";
import { DetailedSummary } from "./DetailedSummary";
import { ReviewBanner } from "./ReviewBanner";
import { SourceInventoryPanel } from "./SourceInventoryPanel";
import { TableContextCaption } from "./TableContextCaption";
import { ThreeLineSummary } from "./ThreeLineSummary";
import { VisualizationBriefPanel } from "./VisualizationBriefPanel";

interface RightPanelAnalysisProps {
  analysisData: AnalysisData;
  onCitationClick?: (page: number) => void;
}

export function RightPanelAnalysis({ analysisData, onCitationClick }: RightPanelAnalysisProps) {
  const reviewReasons = [
    ...(analysisData.reviewReasons ?? []),
    ...(analysisData.sheetStructure?.reviewReason ? [analysisData.sheetStructure.reviewReason] : []),
  ];
  const tables = getSourceTables(analysisData);
  const relations = getTableRelations(analysisData);
  const tableContextHighlights = getTableContextHighlights(analysisData);
  const findingsSummary = getFindingsSummaryVariant(analysisData);
  const implicationsSummary = getImplicationsSummaryVariant(analysisData);
  const cautions = getCautionReferenceLines(analysisData);
  const visualizationBrief = getVisualizationBrief(analysisData);

  return (
    <>
      <ReviewBanner reasons={reviewReasons} />
      <SourceInventoryPanel tables={tables} relations={relations} />
      <TableContextCaption lines={tableContextHighlights} />
      <ThreeLineSummary summary={findingsSummary} onCitationClick={onCitationClick} />
      <DetailedSummary summary={implicationsSummary} onCitationClick={onCitationClick} />
      <CheckPoints issues={cautions} onCitationClick={onCitationClick} />
      <VisualizationBriefPanel brief={visualizationBrief} />
    </>
  );
}
