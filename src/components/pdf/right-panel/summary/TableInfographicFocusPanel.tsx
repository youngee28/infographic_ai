import { Gauge, Sparkles, TrendingUp } from "lucide-react";
import type { TableInsightContextCard } from "@/lib/session-types";

interface TableInfographicFocusPanelProps {
  cards: TableInsightContextCard[];
}

const ROLE_LABELS: Record<TableInsightContextCard["role"], string> = {
  primary: "",
  supporting: "",
  comparison: "비교 표",
  breakdown: "구성 표",
  trend: "추이 표",
  reference: "참고 표",
};

const CHART_TYPE_LABELS = {
  bar: "막대",
  line: "라인",
  donut: "도넛",
  pie: "파이",
  "stacked-bar": "누적 막대",
  map: "지도",
} as const;

export function TableInfographicFocusPanel({ cards }: TableInfographicFocusPanelProps) {
  if (cards.length === 0) return null;

  return (
    <div className="mb-6 animate-in fade-in duration-500 delay-300">
      <div className="text-[12px] font-bold text-violet-800 mb-2.5 flex items-center tracking-tight">
        <Gauge className="w-3.5 h-3.5 mr-1.5 text-violet-600" /> 표별 핵심 인사이트와 맥락
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <div key={card.tableId} className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-semibold text-gray-900">{card.tableName}</div>
              {ROLE_LABELS[card.role] ? (
                <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] font-medium text-violet-700">
                  {ROLE_LABELS[card.role]}
                </span>
              ) : null}
              {card.isPrimary && !["primary", "supporting"].includes(card.role) && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  우선 강조
                </span>
              )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <SectionBlock
                icon={<Sparkles className="w-3.5 h-3.5 text-violet-600" />}
                title="핵심 인사이트"
                items={card.coreInsights}
                emptyLabel="핵심 해석이 아직 정리되지 않았습니다."
              />
              <SectionBlock
                icon={<TrendingUp className="w-3.5 h-3.5 text-sky-600" />}
                title="왜 중요한가"
                items={card.contexts}
                emptyLabel="중요한 배경과 해석 맥락이 아직 정리되지 않았습니다."
              />
            </div>

            {(card.cautions.length > 0 || card.chartHints.length > 0) && (
              <div className="mt-3 space-y-2.5 border-t border-violet-100 pt-3">
                {card.cautions.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700/80">주의할 점</div>
                    <ul className="mt-1 space-y-1">
                      {card.cautions.map((item) => (
                        <li key={`${card.tableId}-caution-${item}`} className="text-[12.5px] leading-relaxed text-rose-800">
                          • {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {card.chartHints.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold tracking-wide text-violet-700/70">시각화 힌트 (선택)</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {card.chartHints.map((item) => (
                        <span
                          key={`${card.tableId}-${item.chartType}-${item.goal}`}
                          className="rounded-full border border-violet-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-violet-700"
                        >
                          {CHART_TYPE_LABELS[item.chartType]} · {item.goal}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionBlock({
  icon,
  title,
  items,
  emptyLabel,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/80 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        <span>{title}</span>
      </div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={`${title}-${item}`} className="text-[12.5px] leading-relaxed text-gray-700">
              • {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-400">{emptyLabel}</p>
      )}
    </div>
  );
}
