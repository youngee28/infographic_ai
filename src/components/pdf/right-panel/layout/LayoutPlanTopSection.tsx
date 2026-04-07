import { LayoutPlanControls } from "./LayoutPlanControls";

interface LayoutPlanTopSectionSourceTable {
  id: string;
  name: string;
}

interface LayoutPlanTopSectionProps {
  promptDraft: string;
  isSubmittingPrompt: boolean;
  isAnalyzing?: boolean;
  sourceTables: LayoutPlanTopSectionSourceTable[];
  selectedSourceTableIds: string[];
  onPromptDraftChange: (value: string) => void;
  onResetPrompt: () => void;
  onSaveAndRegenerate: () => void;
  onToggleSourceTableSelection: (tableId: string) => void;
}

export function LayoutPlanTopSection({
  promptDraft,
  isSubmittingPrompt,
  isAnalyzing,
  sourceTables,
  selectedSourceTableIds,
  onPromptDraftChange,
  onResetPrompt,
  onSaveAndRegenerate,
  onToggleSourceTableSelection,
}: LayoutPlanTopSectionProps) {
  return (
    <LayoutPlanControls
      promptDraft={promptDraft}
      isSubmittingPrompt={isSubmittingPrompt}
      isAnalyzing={isAnalyzing}
      sourceTables={sourceTables}
      selectedSourceTableIds={selectedSourceTableIds}
      onPromptDraftChange={onPromptDraftChange}
      onResetPrompt={onResetPrompt}
      onSaveAndRegenerate={onSaveAndRegenerate}
      onToggleSourceTableSelection={onToggleSourceTableSelection}
    />
  );
}
