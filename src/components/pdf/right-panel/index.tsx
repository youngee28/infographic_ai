"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/app-store";
import type { AnalysisData } from "@/lib/session-types";
import { InfographicChatPanel } from "./image-chat/InfographicChatPanel";
import { LayoutPlanPanel } from "./layout/LayoutPlanPanel";
import { RightPanelHeader } from "./RightPanelHeader";
import { InsightsPanel } from "./summary/InsightsPanel";
import { WorkspaceTabs } from "./WorkspaceTabs";

interface RightPanelProps {
  analysisData: AnalysisData | null;
  isAnalyzing?: boolean;
  sessionId?: string | null;
  fileName?: string;
  onRegenerateLayoutImages?: (imagePromptOverride: string) => Promise<void>;
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
  onRegenerateLayoutImages,
  onCitationClick,
  onShareSession,
  showImageTab = true,
  sharedChatConfig,
}: RightPanelProps) {
  const currentFileName = useAppStore((s) => s.currentFileName);
  const selectedQnaModel = useAppStore((s) => s.selectedQnaModel);
  const selectedLayoutModel = useAppStore((s) => s.selectedLayoutModel);
  const selectedImageModel = useAppStore((s) => s.selectedImageModel);
  const setSelectedQnaModel = useAppStore((s) => s.setSelectedQnaModel);
  const setSelectedLayoutModel = useAppStore((s) => s.setSelectedLayoutModel);
  const setSelectedImageModel = useAppStore((s) => s.setSelectedImageModel);
  const [activeTab, setActiveTab] = useState<"summary" | "layout" | "image">(() => (showImageTab ? "layout" : "summary"));
  const effectiveActiveTab = showImageTab ? activeTab : "summary";
  const shouldShowInfographicWorkspace = effectiveActiveTab === "image";
  const shouldShowLayoutWorkspace = effectiveActiveTab === "layout";

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden">
      <RightPanelHeader
        fileName={fileName || currentFileName}
        onShareSession={onShareSession}
      />
      <WorkspaceTabs
        activeTab={effectiveActiveTab}
        onChange={(tab) => {
          if ((tab === "image" || tab === "layout") && !showImageTab) return;
          setActiveTab(tab);
        }}
        showImageTab={showImageTab}
        selectedQnaModel={selectedQnaModel}
        selectedLayoutModel={selectedLayoutModel}
        selectedImageModel={selectedImageModel}
        onChangeQnaModel={setSelectedQnaModel}
        onChangeLayoutModel={setSelectedLayoutModel}
        onChangeImageModel={setSelectedImageModel}
      />

      <div className="flex-1 min-h-0 relative overflow-hidden">
        {shouldShowInfographicWorkspace ? (
          <InfographicChatPanel sessionId={sessionId} analysisData={analysisData} isAnalyzing={isAnalyzing} />
        ) : shouldShowLayoutWorkspace ? (
          <LayoutPlanPanel
            sessionId={sessionId}
            analysisData={analysisData}
            isAnalyzing={isAnalyzing}
            onRegenerateLayoutImages={onRegenerateLayoutImages}
          />
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
