import { Sparkles } from "lucide-react";

interface Props {
  insights?: string;
  onSelectQuestion: (q: string) => void;
}

const cleanQuestion = (value: string): string =>
  value
    .replace(/^\s*(?:[-*•]\s*|\d+[.)]\s*)/, "")
    .replace(/^['"`\s]+|['"`\s]+$/g, "")
    .trim();

const parseQuestions = (insights?: string): string[] => {
  if (!insights) return [];
  const raw = insights.trim();
  if (!raw) return [];

  if (raw.startsWith("[") && raw.endsWith("]")) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map(cleanQuestion)
        .filter(Boolean)
        .slice(0, 3);
    }
  }

  const segments = raw.includes("\n")
    ? raw.split("\n")
    : raw.split(/\s+(?=\d+[.)]\s*)|[;|]/);

  const unique: string[] = [];
  for (const segment of segments) {
    const question = cleanQuestion(segment);
    if (!question) continue;
    if (!unique.includes(question)) unique.push(question);
    if (unique.length >= 3) break;
  }

  return unique;
};

export function RecommendedQuestions({ insights, onSelectQuestion }: Props) {
  const defaultQuestions = [
    "가장 눈에 띄는 변화나 격차를 설명해줘",
    "의사결정에 바로 쓸 수 있는 핵심 수치를 골라줘",
    "이 데이터를 한 장 인포그래픽으로 요약하면 어떻게 구성할까"
  ];

  const questions = parseQuestions(insights);
  const displayQuestions = questions.length > 0 ? questions : defaultQuestions;

  return (
    <div className="mb-2 mt-2">
      <div className="flex items-center text-[10.5px] font-bold text-gray-400 mb-2 ml-1 uppercase tracking-wide">
        <Sparkles className="w-3 h-3 mr-1" /> 추천 질문
      </div>
      <div className="flex flex-wrap gap-1.5">
        {displayQuestions.map((q) => (
          <button 
            key={`rec-${q}`}
            type="button"
            onClick={() => onSelectQuestion(q)}
            className="px-3 py-1.5 bg-white hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-gray-500 text-[12px] font-medium border border-gray-200 rounded-full transition-all text-left"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
