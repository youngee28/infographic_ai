import { AlertTriangle } from "lucide-react";

interface ReviewBannerProps {
  reasons: string[];
}

export function ReviewBanner({ reasons }: ReviewBannerProps) {
  if (reasons.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/80 p-4 animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-[12px] font-bold text-amber-800 mb-2">
        <AlertTriangle className="w-4 h-4" /> 구조 재확인 필요
      </div>
      <div className="space-y-1.5">
        {reasons.map((reason, index) => (
          <div key={`review-reason-${index}-${reason}`} className="text-[12.5px] leading-relaxed text-amber-900">
            {reason}
          </div>
        ))}
      </div>
    </div>
  );
}
