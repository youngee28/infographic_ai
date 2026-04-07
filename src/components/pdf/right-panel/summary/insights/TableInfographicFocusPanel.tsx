import { Gauge } from "lucide-react";
import type { TableInsightCard } from "@/lib/session-types";

interface TableInfographicFocusPanelProps {
  cards: TableInsightCard[];
}

export function TableInfographicFocusPanel({ cards }: TableInfographicFocusPanelProps) {
  if (cards.length === 0) return null;

  return (
    <div className="mb-6 animate-in fade-in duration-500 delay-300">
      <div className="text-[12px] font-bold text-violet-800 mb-2.5 flex items-center tracking-tight">
        <Gauge className="w-3.5 h-3.5 mr-1.5 text-violet-600" /> 표별 핵심 인사이트
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <div key={card.tableId} className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 shadow-sm">
            <div className="text-[13px] font-semibold text-gray-900">{card.tableName}</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700">
              {card.insight}
            </p>
            {card.significantNumbers.length > 0 && (
              <div className="mt-3 rounded-lg border border-white/80 bg-white/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700/80">의미있는 수치</div>
                <ul className="mt-2 space-y-1.5">
                  {card.significantNumbers.map((item) => (
                    <li key={`${card.tableId}-${item}`} className="text-[12.5px] leading-relaxed text-gray-700">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
