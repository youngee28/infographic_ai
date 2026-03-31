import Image from "next/image";
import { Copy, ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import type { ImageChatMessage } from "./types";

interface ImageChatTimelineProps {
  latestResult: ImageChatMessage | null;
  isGenerating: boolean;
  isPendingAnalysis: boolean;
  onCopyImage: (imageDataUrl: string) => void;
}

export function ImageChatTimeline({
  latestResult,
  isGenerating,
  isPendingAnalysis,
  onCopyImage,
}: ImageChatTimelineProps) {
  if (isPendingAnalysis) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-[28px] border border-gray-200/70 bg-linear-to-br from-gray-50 via-white to-blue-50/50 px-6 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600 shadow-inner">
          <LoaderCircle className="h-6 w-6 animate-spin" />
        </div>
        <p className="mt-4 text-sm font-semibold text-gray-800">표 인사이트를 읽고 첫 인포그래픽을 준비하고 있습니다.</p>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-gray-500">
          데이터 요약이 끝나면 오른쪽 패널에 바로 결과가 나타나고, 아래 프롬프트로 원하는 톤과 구성을 다시 생성할 수 있습니다.
        </p>
      </div>
    );
  }

  const generatedImageDataUrl = latestResult?.generatedImageDataUrl;

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-[28px] border border-gray-200/70 bg-linear-to-br from-gray-50 via-white to-blue-50/50 shadow-sm">
      <div className="flex-1 overflow-y-auto p-5">
        {isGenerating ? (
          <div className="flex min-h-full flex-col items-center justify-center rounded-[24px] border border-dashed border-blue-200 bg-white/80 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-inner">
              <LoaderCircle className="h-6 w-6 animate-spin" />
            </div>
            <p className="mt-4 text-sm font-semibold text-gray-800">인포그래픽을 재구성하고 있습니다.</p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-gray-500">
              핵심 지표, 비교 구조, 읽는 순서를 반영해 새 결과를 만들고 있어요. 조금만 기다리면 이 영역이 최신 시안으로 교체됩니다.
            </p>
            <div className="mt-6 grid w-full max-w-lg gap-3 sm:grid-cols-2">
              <div className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-gray-100/80" />
              <div className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-gray-100/80" />
            </div>
          </div>
        ) : generatedImageDataUrl ? (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm">
              <Image
                src={generatedImageDataUrl}
                alt="생성된 인포그래픽"
                width={1600}
                height={1200}
                unoptimized
                className="h-auto w-full bg-white"
              />
              <button
                type="button"
                onClick={() => onCopyImage(generatedImageDataUrl)}
                className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/60 bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70"
              >
                <Copy className="h-3.5 w-3.5" /> 복사
              </button>
            </div>

          </div>
        ) : latestResult ? (
          <div className="flex min-h-full flex-col items-center justify-center rounded-[24px] border border-gray-200 bg-white/90 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-500 shadow-inner">
              <ImageIcon className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-gray-800">이미지 대신 텍스트 응답이 도착했습니다.</p>
            <p className="mt-2 max-w-md whitespace-pre-wrap text-[13px] leading-relaxed text-gray-500">{latestResult.content}</p>
          </div>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center rounded-[24px] border border-dashed border-gray-200 bg-white/80 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-500 shadow-inner">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-gray-800">첫 인포그래픽을 준비할 수 있습니다.</p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-gray-500">
              강조할 지표, 원하는 톤, 읽는 순서를 입력하면 이 영역에 하나의 대표 시안을 계속 갱신해 보여줍니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
