"use client";

import { useAppStore } from "@/lib/app-store";
import type { AnalysisData } from "@/lib/session-types";
import { InfographicChatPanel } from "./image-chat/InfographicChatPanel";
import { RightPanelHeader } from "./RightPanelHeader";
import { InsightsPanel } from "./summary/InsightsPanel";

interface RightPanelProps {
  analysisData: AnalysisData | null;
  isAnalyzing?: boolean;
  sessionId?: string | null;
  fileName?: string;
  onCitationClick?: (page: number) => void;
  onShareSession?: () => void;
  showImageTab?: boolean;
  sharedChatConfig?: {
    publicId: string;
    password: string;
  };
}

export function RightPanel({
  analysisData,
  isAnalyzing,
  sessionId,
  fileName,
  onCitationClick,
  onShareSession,
  showImageTab = true,
  sharedChatConfig,
}: RightPanelProps) {
  const currentFileName = useAppStore((s) => s.currentFileName);
  const shouldShowInfographicWorkspace = showImageTab;

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      <RightPanelHeader fileName={fileName || currentFileName} onShareSession={onShareSession} />

      <div className="flex-1 min-h-0 relative overflow-hidden">
        {shouldShowInfographicWorkspace ? (
          <InfographicChatPanel sessionId={sessionId} analysisData={analysisData} isAnalyzing={isAnalyzing} />
        ) : (
          <InsightsPanel
            analysisData={analysisData}
            isAnalyzing={isAnalyzing}
            sessionId={sessionId}
            onCitationClick={onCitationClick}
            sharedChatConfig={sharedChatConfig}
          />
        )}
      </div>
    </div>
  );
}
