import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import { MarkdownText } from "../markdown-text";

function formatElapsedTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function useThinkingTimer(startTime: number | null, isActive: boolean) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive || !startTime) {
      if (!isActive && startTime) {
        // Freeze at final value
        setElapsed(Date.now() - startTime);
      }
      return;
    }

    setElapsed(Date.now() - startTime);
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);

    return () => clearInterval(timer);
  }, [startTime, isActive]);

  return elapsed;
}

export function ThinkingBlock({
  content,
  isStreaming,
  startTime,
  duration,
}: {
  content: string;
  isStreaming: boolean;
  startTime?: number | null;
  duration?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const elapsed = useThinkingTimer(startTime ?? null, isStreaming);

  // Auto-expand while streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
    }
  }, [isStreaming]);

  const displayTime = isStreaming
    ? formatElapsedTime(elapsed)
    : duration
      ? formatElapsedTime(duration)
      : null;

  const toggle = useCallback(() => {
    if (!isStreaming) {
      setIsExpanded((prev) => !prev);
    }
  }, [isStreaming]);

  if (!content && !isStreaming) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-1"
      >
        {isStreaming ? (
          <span className="relative flex size-4 items-center justify-center">
            <span className="absolute inline-flex size-3 rounded-full bg-amber-400 opacity-75 animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
          </span>
        ) : (
          <Lightbulb className="size-4 text-amber-500" />
        )}
        <span>
          {isStreaming ? "Thinking" : "Thought"}
          {displayTime && ` for ${displayTime}`}
          {isStreaming && "..."}
        </span>
        {!isStreaming && (
          isExpanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && content && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-l-2 border-amber-300 pl-3 py-1 my-1 text-sm text-muted-foreground">
              <MarkdownText>{content}</MarkdownText>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
