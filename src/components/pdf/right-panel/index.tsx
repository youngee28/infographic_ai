"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/app-store";
import type { AnalysisData } from "@/lib/session-types";
import { InfographicChatPanel } from "./image-chat/InfographicChatPanel";
import { RightPanelHeader } from "./RightPanelHeader";
import { WorkspaceTabs } from "./WorkspaceTabs";
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
  const [activeTab, setActiveTab] = useState<"summary" | "image">("summary");
  const currentFileName = useAppStore((s) => s.currentFileName);
  const selectedQnaModel = useAppStore((s) => s.selectedQnaModel);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const setSelectedQnaModel = useAppStore((s) => s.setSelectedQnaModel);
  const setSelectedImageModel = useAppStore((s) => s.setSelectedImageModel);
  const effectiveTab = showImageTab ? activeTab : "summary";

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      <RightPanelHeader fileName={fileName || currentFileName} onShareSession={onShareSession} />
      <WorkspaceTabs
        activeTab={effectiveTab}
        onChange={setActiveTab}
        showImageTab={showImageTab}
        selectedQnaModel={selectedQnaModel}
        selectedImageModel={selectedImageModel}
        onChangeQnaModel={setSelectedQnaModel}
        onChangeImageModel={setSelectedImageModel}
      />

      <div className="flex-1 min-h-0 relative overflow-hidden">
        {effectiveTab === "summary" ? (
          <InsightsPanel
            analysisData={analysisData}
            isAnalyzing={isAnalyzing}
            sessionId={sessionId}
            onCitationClick={onCitationClick}
            sharedChatConfig={sharedChatConfig}
          />
        ) : (
          <InfographicChatPanel sessionId={sessionId} analysisData={analysisData} />
        )}
      </div>
    </div>
  );
}
