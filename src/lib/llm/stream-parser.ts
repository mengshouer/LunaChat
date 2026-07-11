export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        yield data;
      }
    }
  }

  // Flush a trailing data line left in the buffer when the stream ends
  // without a final newline (e.g. no [DONE] sentinel).
  const trailing = buffer.trim();
  if (trailing.startsWith("data: ")) {
    const data = trailing.slice(6);
    if (data !== "[DONE]") {
      yield data;
    }
  }
}
