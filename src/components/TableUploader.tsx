"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";
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
        "w-full lg:max-w-3xl lg:mx-auto border-2 border-dashed rounded-2xl p-7 sm:p-10 text-center transition-all cursor-pointer bg-white flex flex-col items-center justify-center min-h-[300px] shadow-sm",
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
        <div className="flex flex-col items-center space-y-4 max-w-2xl">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner">
            <UploadCloud className="w-8 h-8" />
          </div>

          <div className="space-y-2.5">
            <p className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              {isDragActive ? "여기에 CSV 또는 XLSX 파일을 놓으세요" : "CSV, XLSX 파일을 업로드하세요"}
            </p>
            <p className="text-base text-gray-500 leading-relaxed">
              드래그 앤 드롭하거나 클릭해서 파일을 선택하세요.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
