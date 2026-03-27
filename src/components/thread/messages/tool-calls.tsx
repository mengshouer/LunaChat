import type { ToolCallData, Message } from "@/lib/db";
import type { ToolCall } from "@/lib/llm/types";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function ToolCallWithResultCard({
  call,
  result,
}: {
  call: ToolCallData | ToolCall;
  result?: Message;
}) {
  const args = call.args as Record<string, unknown>;
  const hasArgs = Object.keys(args).length > 0;

  const [isExpanded, setIsExpanded] = useState(false);

  let displayedContent: string | null = null;
  let shouldTruncate = false;

  if (result) {
    let parsedContent: unknown;
    let isJsonContent = false;

    try {
      if (typeof result.content === "string") {
        parsedContent = JSON.parse(result.content);
        isJsonContent = true;
      }
    } catch {
      parsedContent = result.content;
    }

    const contentStr = isJsonContent
      ? JSON.stringify(parsedContent, null, 2)
      : String(result.content);
    const contentLines = contentStr.split("\n");
    shouldTruncate = contentLines.length > 4 || contentStr.length > 500;

    displayedContent = shouldTruncate && !isExpanded
      ? contentStr.length > 500
        ? contentStr.slice(0, 500) + "..."
        : contentLines.slice(0, 4).join("\n") + "\n..."
      : contentStr;
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
        <h3 className="font-medium text-gray-900">
          {call.name}
          {call.id && (
            <code className="ml-2 text-sm bg-gray-100 px-2 py-1 rounded">
              {call.id}
            </code>
          )}
        </h3>
      </div>
      {hasArgs ? (
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-200">
            {Object.entries(args).map(([key, value], argIdx) => (
              <tr key={argIdx}>
                <td className="px-4 py-2 text-sm font-medium text-gray-900 whitespace-nowrap">
                  {key}
                </td>
                <td className="px-4 py-2 text-sm text-gray-500">
                  {isComplexValue(value) ? (
                    <code className="bg-gray-50 rounded px-2 py-1 font-mono text-sm break-all">
                      {JSON.stringify(value, null, 2)}
                    </code>
                  ) : (
                    String(value)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <code className="text-sm block p-3">{"{}"}</code>
      )}

      {result && displayedContent !== null && (
        <div className="border-t border-gray-200 bg-gray-100">
          <div className="px-4 py-2 border-b border-gray-200">
            <h4 className="font-medium text-gray-900">Result</h4>
          </div>
          <motion.div
            className="min-w-full bg-gray-100"
            initial={false}
            animate={{ height: "auto" }}
            transition={{ duration: 0.3 }}
          >
            <div className="p-3">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={isExpanded ? "expanded" : "collapsed"}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <code className="text-sm block whitespace-pre-wrap break-all">
                    {displayedContent}
                  </code>
                </motion.div>
              </AnimatePresence>
            </div>
            {shouldTruncate && (
              <motion.button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full py-2 flex items-center justify-center border-t-[1px] border-gray-200 text-gray-500 hover:text-gray-600 hover:bg-gray-50 transition-all ease-in-out duration-200 cursor-pointer"
                initial={{ scale: 1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isExpanded ? <ChevronUp /> : <ChevronDown />}
              </motion.button>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

export function ToolCalls({
  toolCalls,
  resultsById,
}: {
  toolCalls: (ToolCallData | ToolCall)[];
  resultsById?: Record<string, Message>;
}) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="space-y-4 w-full max-w-4xl">
      {toolCalls.map((tc, idx) => (
        <ToolCallWithResultCard
          key={tc.id ?? idx}
          call={tc}
          result={resultsById && tc.id ? resultsById[tc.id] : undefined}
        />
      ))}
    </div>
  );
}

export function ToolResult({ message }: { message: Message }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsedContent: unknown;
  let isJsonContent = false;

  try {
    if (typeof message.content === "string") {
      parsedContent = JSON.parse(message.content);
      isJsonContent = true;
    }
  } catch {
    parsedContent = message.content;
  }

  const contentStr = isJsonContent
    ? JSON.stringify(parsedContent, null, 2)
    : String(message.content);
  const contentLines = contentStr.split("\n");
  const shouldTruncate = contentLines.length > 4 || contentStr.length > 500;
  const displayedContent =
    shouldTruncate && !isExpanded
      ? contentStr.length > 500
        ? contentStr.slice(0, 500) + "..."
        : contentLines.slice(0, 4).join("\n") + "\n..."
      : contentStr;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {message.name ? (
            <h3 className="font-medium text-gray-900">
              Tool Result:{" "}
              <code className="bg-gray-100 px-2 py-1 rounded">
                {message.name}
              </code>
            </h3>
          ) : (
            <h3 className="font-medium text-gray-900">Tool Result</h3>
          )}
          {message.toolCallId && (
            <code className="ml-2 text-sm bg-gray-100 px-2 py-1 rounded">
              {message.toolCallId}
            </code>
          )}
        </div>
      </div>
      <motion.div
        className="min-w-full bg-gray-100"
        initial={false}
        animate={{ height: "auto" }}
        transition={{ duration: 0.3 }}
      >
        <div className="p-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isExpanded ? "expanded" : "collapsed"}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              <code className="text-sm block whitespace-pre-wrap break-all">
                {displayedContent}
              </code>
            </motion.div>
          </AnimatePresence>
        </div>
        {shouldTruncate && (
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full py-2 flex items-center justify-center border-t-[1px] border-gray-200 text-gray-500 hover:text-gray-600 hover:bg-gray-50 transition-all ease-in-out duration-200 cursor-pointer"
            initial={{ scale: 1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
