import { Rows3 } from "lucide-react";

interface TableContextCaptionProps {
  lines: string[];
}

export function TableContextCaption({ lines }: TableContextCaptionProps) {
  if (lines.length === 0) return null;

  return (
    <div className="mb-5 animate-in fade-in duration-500 delay-100">
      <div className="text-[12px] font-bold text-slate-700 mb-2.5 flex items-center tracking-tight">
        <Rows3 className="w-3.5 h-3.5 mr-1.5 text-slate-500" /> 테이블 컨텍스트
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line} className="rounded-md bg-white/80 px-3 py-2 text-[12.5px] leading-relaxed text-slate-700 border border-slate-200/70">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
