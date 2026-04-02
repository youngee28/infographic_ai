"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import { useAppStore } from "@/lib/app-store";
import {
  getAnalysisTitle,
  getAskNext,
  getCautions,
  getDatasetSummary,
  getFindings,
  getImplications,
  getSourceTables,
} from "@/lib/analysis-selectors";
import { store } from "@/lib/store";
import type { AnalysisData } from "@/lib/session-types";
import { ChatInput } from "./ChatInput";
import { ChatTimeline } from "./ChatTimeline";
import { RecommendedQuestions } from "./RecommendedQuestions";
import { RightPanelAnalysis } from "./RightPanelAnalysis";

const buildContextText = (analysisData: AnalysisData | null) => {
  if (!analysisData) return "";

  const tables = getSourceTables(analysisData);
  const findingText = getFindings(analysisData).map((item) => item.text);
  const implicationText = getImplications(analysisData).map((item) => item.text);
  const cautionText = getCautions(analysisData).map((item) => item.text);

  const formatTableRole = (role: ReturnType<typeof getSourceTables>[number]["role"]) => {
    switch (role) {
      case "comparison":
        return "비교 표";
      case "breakdown":
        return "구성 표";
      case "trend":
        return "추이 표";
      case "reference":
        return "참고 표";
      default:
        return "";
    }
  };

  return [
    `데이터셋 제목: ${getAnalysisTitle(analysisData)}`,
    getDatasetSummary(analysisData) ? `요약: ${getDatasetSummary(analysisData)}` : "",
    tables.length > 0 ? `표 구성: ${tables.map((table) => {
      const roleLabel = formatTableRole(table.role);
      return roleLabel ? `${table.name}(${roleLabel})` : table.name;
    }).join(" | ")}` : "",
    findingText.length > 0 ? `핵심 신호: ${findingText.slice(0, 5).join(" | ")}` : "",
    implicationText.length > 0 ? `실무 시사점: ${implicationText.slice(0, 4).join(" | ")}` : "",
    cautionText.length > 0 ? `해석상 유의점: ${cautionText.slice(0, 4).join(" | ")}` : "",
  ].join("\n").trim();
};

interface InsightsPanelProps {
  analysisData: AnalysisData | null;
  isAnalyzing?: boolean;
  sessionId?: string | null;
  onCitationClick?: (page: number) => void;
  sharedChatConfig?: {
    publicId: string;
    password: string;
  };
}

export function InsightsPanel({ analysisData, isAnalyzing, sessionId, onCitationClick, sharedChatConfig }: InsightsPanelProps) {
  const [isTyping, setIsTyping] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const firstTurnDoneBySessionRef = useRef(false);
  const chatMessagesBySession = useAppStore((s) => s.chatMessagesBySession);
  const messages = useMemo(
    () => (sessionId ? chatMessagesBySession[sessionId] ?? [] : []),
    [chatMessagesBySession, sessionId]
  );
  const setChatMessagesForSession = useAppStore((s) => s.setChatMessagesForSession);
  const selectedQnaModel = useAppStore((s) => s.selectedQnaModel);

  useEffect(() => {
    firstTurnDoneBySessionRef.current = Boolean(sessionId && messages.some((message) => message.role === "user"));
  }, [sessionId, messages]);

  useEffect(() => {
    if (messages.length === 0 && !isTyping) return;
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || isTyping) return;

    const newMessages = [...messages, { role: "user" as const, content }];
    if (sessionId) {
      setChatMessagesForSession(sessionId, newMessages);
    }
    setIsTyping(true);

    try {
      if (sharedChatConfig) {
        const response = await fetch("/api/share/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicId: sharedChatConfig.publicId,
            password: sharedChatConfig.password,
            message: content,
            history: messages,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "채팅 응답을 가져오지 못했습니다.");
        }

        if (sessionId) {
          setChatMessagesForSession(sessionId, [...newMessages, { role: "ai", content: data.answer || "응답이 없습니다." }]);
        }
        return;
      }

      const apiKey = localStorage.getItem("gemini_api_key");
      if (!apiKey) {
        throw new Error("API 키가 없습니다. 다시 로그인해주세요.");
      }

      const ai = new GoogleGenAI({ apiKey });

      const isFirstTurn = !firstTurnDoneBySessionRef.current;
      const historyParts = newMessages
        .map((m) => `[${m.role === "user" ? "사용자" : "AI"}]: ${m.content}`)
        .join("\n\n");

      const contextText = isFirstTurn ? buildContextText(analysisData) : "";
      const prompt = `${contextText ? `${contextText}\n\n` : ""}이전 대화 내역:\n${historyParts}\n\n위 테이블 데이터와 인사이트를 기반으로 답변해주세요.`;

      if (!sessionId) {
        throw new Error("세션 정보를 찾을 수 없습니다.");
      }

      const session = await store.getSession(sessionId);
      const tableContext = session
        ? JSON.stringify(
            {
              dataset: session.fileName,
              fileType: session.fileType,
              columns: session.tableData.columns,
              rowCount: session.tableData.rowCount,
              columnCount: session.tableData.columnCount,
              primaryLogicalTableId: session.tableData.primaryLogicalTableId,
              logicalTables: session.tableData.logicalTables?.map((table) => ({
                id: table.id,
                name: table.name,
                orientation: table.orientation,
                headerAxis: table.headerAxis,
                bounds: {
                  startRow: table.startRow,
                  endRow: table.endRow,
                  startCol: table.startCol,
                  endCol: table.endCol,
                },
                columns: table.columns,
                rowCount: table.rowCount,
                columnCount: table.columnCount,
                rows: table.rows.slice(0, 40),
              })),
              rows: session.tableData.rows.slice(0, 120),
            },
            null,
            2
          )
        : "";

      const contents = isFirstTurn
        ? [`${prompt}\n\n[테이블 데이터]\n${tableContext}`]
        : [prompt];
      firstTurnDoneBySessionRef.current = true;

      const result = await ai.models.generateContentStream({
        model: selectedQnaModel,
        contents,
        config: {
          systemInstruction:
            "당신은 테이블 분석 AI 어시스턴트입니다. 제공된 표 데이터와 이전 대화 내역을 바탕으로 한국어로 간결하고 실무적으로 답변하세요. 답변에서는 페이지 인용을 사용하지 말고, 가능한 경우 컬럼명과 수치 기준을 함께 언급하세요. 데이터만으로 확신할 수 없는 내용은 추정임을 명확히 밝히세요.",
        },
      });

      let botResponse = "";
      if (sessionId) {
        setChatMessagesForSession(sessionId, [...newMessages, { role: "ai" as const, content: "" }]);
      }

      let frameId: number | null = null;
      const flush = () => {
        if (!sessionId) return;
        const updated = [...newMessages, { role: "ai" as const, content: botResponse }];
        setChatMessagesForSession(sessionId, updated);
        frameId = null;
      };

      for await (const chunk of result) {
        const chunkText = chunk.text;
        if (!chunkText) continue;

        botResponse += chunkText;
        if (!frameId && sessionId) {
          frameId = requestAnimationFrame(flush);
        }
      }

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      flush();
    } catch (err) {
      console.error(err);
      if (sessionId) {
        setChatMessagesForSession(sessionId, [...newMessages, { role: "ai" as const, content: "죄송합니다, 응답을 가져오는 중 오류가 발생했습니다." }]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  if (isAnalyzing || !analysisData || analysisData.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-white relative overflow-hidden">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm font-medium text-gray-500 animate-pulse">AI가 표 인사이트를 생성하고 있습니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="p-5 md:p-6 lg:p-7 w-full">
          <RightPanelAnalysis analysisData={analysisData} onCitationClick={onCitationClick} />

          <div className="flex items-center my-6 opacity-40">
            <div className="flex-1 border-t border-gray-300"></div>
            <div className="px-4 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Insights Chat</div>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>

          <ChatTimeline messages={messages} isTyping={isTyping} onCitationClick={onCitationClick} />
          <RecommendedQuestions
            insights={analysisData?.insights}
            questions={getAskNext(analysisData)}
            onSelectQuestion={(q) => handleSendMessage(q)}
          />
          <div ref={chatBottomRef} />
        </div>
      </div>

      <ChatInput onSend={handleSendMessage} disabled={isTyping} />
    </div>
  );
}
