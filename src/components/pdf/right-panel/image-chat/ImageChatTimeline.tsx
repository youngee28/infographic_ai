"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Bot, ImageIcon, LoaderCircle } from "lucide-react";
import type { ImageChatMessage } from "./types";

interface ImageChatTimelineProps {
  messages: ImageChatMessage[];
  isGenerating: boolean;
  isPendingAnalysis: boolean;
}

export function ImageChatTimeline({
  messages,
  isGenerating,
  isPendingAnalysis,
}: ImageChatTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length === 0 && !isGenerating) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isGenerating]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 p-2 md:p-3">
        {isPendingAnalysis && messages.length === 0 ? (
          <div className="flex min-h-full w-full items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <LoaderCircle className="h-7 w-7 animate-spin text-blue-500" />
              <p className="text-sm font-medium tracking-[-0.01em] text-gray-500">AI가 문서를 분석하고 있습니다...</p>
            </div>
          </div>
        ) : isGenerating && messages.length === 0 ? (
          <div className="flex min-h-full w-full items-center justify-center px-4">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-sm font-medium text-gray-500 animate-pulse">AI가 인포그래픽을 생성하고 있습니다...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center rounded-[24px] border border-dashed border-gray-200 bg-white/80 px-5 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-gray-500 shadow-inner">
              <LoaderCircle className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-gray-800">인포그래픽 생성 준비가 완료되었습니다.</p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-gray-500">
              원하는 지표나 표현 방식을 입력하면 바로 첫 인포그래픽을 생성할 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto custom-scrollbar pr-1">
            <div className="space-y-4 pb-1 pt-1">
              {messages.map((message, index) => {
                const imageDataUrl = message.generatedImageDataUrl;
                const hasImage = Boolean(imageDataUrl);

                return (
                  <div
                    key={`image-message-${message.role}-${index}`}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "ai" && (
                      <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-100">
                        <Bot className="h-4 w-4 text-blue-700" />
                      </div>
                    )}

                    <div
                      className={`max-w-[88%] overflow-hidden rounded-[24px] border shadow-sm ${
                        message.role === "user"
                          ? "rounded-tr-sm border-blue-500/80 bg-blue-600 px-4 py-3 text-white"
                          : "rounded-tl-sm border-gray-200/80 bg-white/95 text-gray-800"
                      }`}
                    >
                      {message.role === "user" ? (
                        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white">{message.content}</p>
                        ) : (
                          <div className="space-y-3">
                            {hasImage && imageDataUrl ? (
                            <div className="p-3 sm:p-4">
                              <div className="relative overflow-hidden rounded-[20px] border border-gray-200 bg-white shadow-sm">
                                <Image
                                  src={imageDataUrl}
                                  alt="생성된 인포그래픽"
                                  width={1600}
                                  height={1200}
                                  unoptimized
                                  className="h-auto w-full bg-white object-contain"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 border-b border-gray-100 px-4 pt-4 text-gray-500">
                              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 shadow-inner">
                                <ImageIcon className="h-4.5 w-4.5" />
                              </div>
                              <p className="text-[12px] font-medium">이미지 대신 텍스트 응답이 도착했습니다.</p>
                            </div>
                          )}

                          <div className={`px-4 pb-4 ${hasImage ? "hidden" : "pt-3"}`}>
                            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600">{message.content}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isGenerating && (
                <div className="flex justify-start">
                  <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-100">
                    <Bot className="h-4 w-4 text-blue-700" />
                  </div>
                  <div className="inline-flex h-11 items-center space-x-1.5 rounded-[24px] rounded-tl-sm border border-gray-200/80 bg-white/95 px-4 py-3 shadow-sm">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "0ms" }} />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "150ms" }} />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
