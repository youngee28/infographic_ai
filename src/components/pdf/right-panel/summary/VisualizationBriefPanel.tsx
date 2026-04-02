import { Wand2 } from "lucide-react";
import type { VisualizationBrief } from "@/lib/session-types";

interface VisualizationBriefPanelProps {
  brief?: VisualizationBrief;
}

export function VisualizationBriefPanel({ brief }: VisualizationBriefPanelProps) {
  if (!brief) return null;

  return (
    <div className="mb-6 animate-in fade-in duration-500 delay-300">
      <div className="text-[12px] font-bold text-emerald-700 mb-2.5 flex items-center tracking-tight">
        <Wand2 className="w-3.5 h-3.5 mr-1.5" /> 인포그래픽 기획안
      </div>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">Headline</div>
          <p className="mt-1 text-[13px] font-semibold text-gray-800">{brief.headline}</p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">Core message</div>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-700">{brief.coreMessage}</p>
        </div>
        {brief.storyFlow.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">Story flow</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {brief.storyFlow.map((item) => (
                <span key={item} className="rounded-full border border-emerald-100 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
