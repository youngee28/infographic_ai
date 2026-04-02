import { Database } from "lucide-react";
import type { SourceTable, TableRelation } from "@/lib/session-types";

function formatStructureLabel(structure?: string): string {
  switch (structure) {
    case "row-major":
      return "행 기준 구조";
    case "column-major":
      return "열 기준 구조";
    case "mixed":
      return "혼합 구조";
    case "ambiguous":
      return "판정 불확실";
    default:
      return "";
  }
}

interface SourceInventoryPanelProps {
  tables: SourceTable[];
  relations: TableRelation[];
}

export function SourceInventoryPanel({ tables, relations }: SourceInventoryPanelProps) {
  if (tables.length === 0 && relations.length === 0) return null;

  return (
    <div className="mb-5 animate-in fade-in duration-500">
      <div className="text-[12px] font-bold text-gray-800 mb-2.5 flex items-center tracking-tight">
        <Database className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> 표 구성
      </div>
      <div className="rounded-xl border border-gray-200/70 bg-white shadow-sm overflow-hidden">
        {tables.length > 0 && (
          <div className="divide-y divide-gray-100">
            {tables.map((table, index) => (
              <div key={table.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-indigo-700">표 {index + 1}</span>
                  <span className="text-[13px] font-semibold text-gray-800">{table.name}</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-100">
                    {table.role}
                  </span>
                  {table.structure && (
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200">
                      {formatStructureLabel(table.structure)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-gray-600 leading-relaxed">{table.context}</p>
                {(table.rangeLabel || table.headerSummary) && (
                  <div className="mt-2 space-y-1">
                    {table.rangeLabel && <div className="text-[11.5px] text-gray-500">범위: {table.rangeLabel}</div>}
                    {table.headerSummary && <div className="text-[11.5px] text-gray-500">{table.headerSummary}</div>}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {table.dimensions.slice(0, 3).map((item) => (
                    <span key={`${table.id}-dim-${item}`} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                      범주 {item}
                    </span>
                  ))}
                  {table.metrics.slice(0, 3).map((item) => (
                    <span key={`${table.id}-metric-${item}`} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                      지표 {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {relations.length > 0 && (
          <div className="border-t border-gray-200/70 bg-gray-50/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">표 간 관계</div>
            <div className="space-y-2">
              {relations.map((relation, index) => (
                <div key={`${relation.fromTableId}-${relation.toTableId}-${index}`} className="text-[12.5px] text-gray-600 leading-relaxed">
                  {relation.description}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
