import type { ReactNode } from "react";
import Image from "next/image";

export type PreviewMode = "html" | "image";

interface LayoutPlanPreviewProps {
  previewMode: PreviewMode;
  candidateName: string;
  previewImageDataUrl?: string;
  htmlPreview: ReactNode;
  fallbackPreview: ReactNode;
}

export function LayoutPlanPreview({
  previewMode,
  candidateName,
  previewImageDataUrl,
  htmlPreview,
  fallbackPreview,
}: LayoutPlanPreviewProps) {
  return (
    <div className="mt-4 overflow-hidden rounded-[24px] border border-gray-200 bg-[#f7f8fb] p-3 shadow-inner md:p-4">
      {previewMode === "html" ? (
        htmlPreview
      ) : previewImageDataUrl ? (
        <div className="overflow-hidden rounded-[18px] border border-gray-200 bg-white shadow-sm">
          <Image
            src={previewImageDataUrl}
            alt={`${candidateName} 미리보기`}
            width={1600}
            height={1200}
            unoptimized
            className="h-auto w-full bg-white object-contain"
          />
        </div>
      ) : (
        fallbackPreview
      )}
    </div>
  );
}
