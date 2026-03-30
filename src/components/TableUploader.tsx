"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Database, Sheet, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableUploaderProps {
  onFileUpload: (file: File) => void;
  isLoading: boolean;
}

export function TableUploader({ onFileUpload, isLoading }: TableUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileUpload(acceptedFiles[0]);
      }
    },
    [onFileUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    maxFiles: 1,
    disabled: isLoading,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer bg-white flex flex-col items-center justify-center min-h-[320px] shadow-sm",
        isDragActive
          ? "border-blue-500 bg-blue-50/60"
          : "border-gray-300 hover:border-blue-400 hover:bg-gray-50 hover:shadow-md",
        isLoading && "opacity-60 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />

      {isLoading ? (
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-lg font-semibold text-gray-800">테이블을 정규화하고 인사이트를 만드는 중입니다...</p>
          <p className="text-sm text-gray-500">CSV/XLSX 구조를 읽고 미리보기와 인포그래픽 브리프를 준비하고 있어요.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-5 max-w-2xl">
          <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner">
            <UploadCloud className="w-10 h-10" />
          </div>

          <div className="space-y-3">
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              {isDragActive ? "여기에 CSV 또는 XLSX 파일을 놓으세요" : "표 데이터를 업로드하고 인포그래픽 워크스페이스를 시작하세요"}
            </p>
            <p className="text-base text-gray-500 leading-relaxed">
              업로드한 테이블은 자동으로 정규화되고, 왼쪽에는 표 미리보기, 오른쪽에는 인사이트와 인포그래픽 생성 도구가 열립니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
              <Sheet className="w-4 h-4 text-blue-600" /> CSV · XLSX 지원
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
              <Database className="w-4 h-4 text-blue-600" /> 표 정규화 + 샘플 미리보기
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
