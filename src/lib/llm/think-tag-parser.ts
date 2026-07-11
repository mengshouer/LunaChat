// Streaming parser for inline <think>/</think> tags emitted by some
// OpenAI-compatible models. Splits a token stream into text and thinking
// segments, correctly handling tags that straddle chunk boundaries via an
// internal tagBuffer. Extracted verbatim from the openai provider so the
// boundary logic can be unit-tested in isolation.

export interface ThinkSegment {
  type: "text" | "thinking";
  value: string;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export function createThinkTagParser(): {
  push(chunk: string): ThinkSegment[];
  flush(): ThinkSegment[];
} {
  let insideThink = false;
  // Holds a partial <think> or </think> tag split across chunk boundaries.
  let tagBuffer = "";

  const push = (delta: string): ThinkSegment[] => {
    const segments: ThinkSegment[] = [];
    let chunk = tagBuffer + delta;
    tagBuffer = "";

    while (chunk.length > 0) {
      if (insideThink) {
        const closeIdx = chunk.indexOf(CLOSE_TAG);
        if (closeIdx !== -1) {
          const thinkPart = chunk.slice(0, closeIdx);
          // Thinking side emits unconditionally (matches original behavior:
          // an empty thinkPart still produces an onThinkingToken("") call).
          segments.push({ type: "thinking", value: thinkPart });
          insideThink = false;
          chunk = chunk.slice(closeIdx + CLOSE_TAG.length);
        } else {
          // Check for partial </think> at end
          if (chunk.length < CLOSE_TAG.length && CLOSE_TAG.startsWith(chunk)) {
            tagBuffer = chunk;
            chunk = "";
          } else {
            // Check if ends with partial tag
            let partialMatch = "";
            for (let i = 1; i < CLOSE_TAG.length; i++) {
              const tail = chunk.slice(-i);
              if (CLOSE_TAG.startsWith(tail)) {
                partialMatch = tail;
                break;
              }
            }
            if (partialMatch) {
              const safePart = chunk.slice(0, -partialMatch.length);
              segments.push({ type: "thinking", value: safePart });
              tagBuffer = partialMatch;
            } else {
              segments.push({ type: "thinking", value: chunk });
            }
            chunk = "";
          }
        }
      } else {
        const openIdx = chunk.indexOf(OPEN_TAG);
        if (openIdx !== -1) {
          const before = chunk.slice(0, openIdx);
          if (before) segments.push({ type: "text", value: before });
          insideThink = true;
          chunk = chunk.slice(openIdx + OPEN_TAG.length);
        } else {
          // Check for partial <think> at end
          let partialMatch = "";
          for (let i = 1; i < OPEN_TAG.length; i++) {
            const tail = chunk.slice(-i);
            if (OPEN_TAG.startsWith(tail)) {
              partialMatch = tail;
              break;
            }
          }
          if (partialMatch) {
            const safePart = chunk.slice(0, -partialMatch.length);
            if (safePart) segments.push({ type: "text", value: safePart });
            tagBuffer = partialMatch;
          } else {
            segments.push({ type: "text", value: chunk });
          }
          chunk = "";
        }
      }
    }

    return segments;
  };

  const flush = (): ThinkSegment[] => {
    if (!tagBuffer) return [];
    const value = tagBuffer;
    tagBuffer = "";
    return [{ type: insideThink ? "thinking" : "text", value }];
  };

  return { push, flush };
}
