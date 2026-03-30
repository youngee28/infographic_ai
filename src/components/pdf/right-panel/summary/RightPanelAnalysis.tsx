import { Sparkles } from "lucide-react";
import type { AnalysisData } from "@/lib/session-types";
import { CheckPoints } from "./CheckPoints";
import { DetailedSummary } from "./DetailedSummary";
import { Keywords } from "./Keywords";
import { ThreeLineSummary } from "./ThreeLineSummary";

interface RightPanelAnalysisProps {
  analysisData: AnalysisData;
  onCitationClick?: (page: number) => void;
}

export function RightPanelAnalysis({ analysisData, onCitationClick }: RightPanelAnalysisProps) {
  return (
    <>
      <Keywords keywords={analysisData.keywords} />
      <ThreeLineSummary summary={analysisData.summaries[0]} onCitationClick={onCitationClick} />
      <DetailedSummary summary={analysisData.summaries[1]} onCitationClick={onCitationClick} />
      <CheckPoints issues={analysisData.issues} onCitationClick={onCitationClick} />
      {analysisData.infographicPrompt && (
        <div className="mb-6 animate-in fade-in duration-500 delay-300">
          <div className="text-[12px] font-bold text-violet-700 mb-2.5 flex items-center tracking-tight">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> 인포그래픽 브리프
          </div>
          <div className="bg-violet-50/60 border border-violet-100 rounded-xl p-4 text-[13.5px] text-gray-700 leading-relaxed whitespace-pre-wrap">
            {analysisData.infographicPrompt}
          </div>
        </div>
      )}
    </>
  );
}
