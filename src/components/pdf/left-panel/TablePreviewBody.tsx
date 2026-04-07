interface TablePreviewBodyProps {
  viewMode: "raw" | "normalized";
  previewColumns: string[];
  previewRows: string[][];
  isEditable: boolean;
  activeLogicalTableId?: string | null;
  onCellChange?: (tableId: string, rowIndex: number, cellIndex: number, value: string) => void;
  onHeaderChange?: (tableId: string, columnIndex: number, value: string) => void;
}

export function TablePreviewBody({
  viewMode,
  previewColumns,
  previewRows,
  isEditable,
  activeLogicalTableId,
  onCellChange,
  onHeaderChange,
}: TablePreviewBodyProps) {
  return (
    <div className="min-w-max p-4">
      <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm">
          <tr>
            <th className="border-b border-r border-gray-200/70 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 whitespace-nowrap bg-gray-100/90 min-w-[56px]">
              {viewMode === "raw" ? "#" : ""}
            </th>
            {previewColumns.map((header, index) => (
              <th
                key={`${header}-${index}`}
                className="border-b border-r last:border-r-0 border-gray-200/70 px-3 py-2.5 text-left text-[12px] font-semibold text-gray-700 whitespace-nowrap"
              >
                {isEditable && activeLogicalTableId && onHeaderChange ? (
                  <input
                    type="text"
                    value={header}
                    onChange={(event) => onHeaderChange(activeLogicalTableId, index, event.target.value)}
                    aria-label={`헤더 ${index + 1} 편집`}
                    className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] font-semibold text-gray-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                ) : (
                  header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.length === 0 ? (
            <tr>
              <td className="border-b border-r border-gray-200/60 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 bg-gray-50 min-w-[56px]">
                1
              </td>
              <td colSpan={previewColumns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                헤더 아래에 표시할 데이터 행이 없습니다.
              </td>
            </tr>
          ) : (
            previewRows.slice(0, 80).map((row, rowIndex) => (
              <tr key={`preview-row-${rowIndex}`} className="odd:bg-white even:bg-gray-50/40">
                <td className="border-b border-r border-gray-200/60 px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 bg-gray-50/80 min-w-[56px] sticky left-0">
                  {rowIndex + 1}
                </td>
                {previewColumns.map((header, cellIndex) => {
                  const cell = row[cellIndex] ?? "";

                  return (
                    <td
                      key={`preview-cell-${rowIndex}-${cellIndex}`}
                      className="max-w-[240px] border-b border-r last:border-r-0 border-gray-200/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-700 align-top whitespace-pre-wrap break-words"
                    >
                      {isEditable ? (
                        <input
                          type="text"
                          value={cell}
                          onChange={(event) => activeLogicalTableId && onCellChange?.(activeLogicalTableId, rowIndex, cellIndex, event.target.value)}
                          placeholder="값 없음"
                          aria-label={`${rowIndex + 1}행 ${header} 편집`}
                          className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[12.5px] leading-relaxed text-gray-700 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100 placeholder:text-gray-300"
                        />
                      ) : (
                        cell || <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
