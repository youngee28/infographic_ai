import { Send } from "lucide-react";
import { useRef, useState } from "react";

interface ImageChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  showTopBorder?: boolean;
}

export function ImageChatInput({
  onSend,
  disabled,
  placeholder = "예: 상위 3개 지표를 강조한 세로형 인포그래픽으로 만들어줘",
  allowEmpty = false,
  showTopBorder = true,
}: ImageChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if ((!input.trim() && !allowEmpty) || disabled) return;
    onSend(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const adjustHeight = (value: string) => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
    if (!value) textareaRef.current.style.height = "auto";
  };

  return (
    <div className={`p-3 bg-white mt-auto sticky bottom-0 z-20 ${showTopBorder ? "border-t border-gray-200" : ""}`}>
      <div className="flex relative rounded-xl bg-gray-50/50 border border-gray-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all group">
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          onChange={(e) => {
            const next = e.target.value;
            setInput(next);
            adjustHeight(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full flex-1 bg-transparent border-transparent rounded-xl pl-4 pr-12 py-3 text-[13.5px] outline-none text-gray-800 placeholder-gray-400 disabled:opacity-50 resize-none leading-5 max-h-36 overflow-y-auto"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || (!allowEmpty && !input.trim())}
          className="absolute right-1 top-1 bottom-1 p-2 bg-gray-100/50 text-gray-400 focus-within:text-white focus-within:bg-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center group-focus-within:bg-blue-600 group-focus-within:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
