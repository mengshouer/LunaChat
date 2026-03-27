/**
 * Extract text content from a File for inclusion in LLM messages.
 * - Text files (md/txt/json/csv/xml/code): read as text directly
 * - PDF: use unpdf to extract text (for non-Anthropic providers)
 * Returns null if the file type is not supported for text extraction.
 */

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/typescript",
  "application/json",
  "application/xml",
  "text/xml",
  "application/x-yaml",
  "text/yaml",
]);

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json", ".xml", ".yaml", ".yml",
  ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx",
  ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h",
  ".sh", ".bash", ".zsh", ".env", ".toml", ".ini", ".cfg",
  ".sql", ".graphql", ".proto", ".diff", ".patch",
]);

function isTextFile(file: File): boolean {
  if (TEXT_MIME_TYPES.has(file.type)) return true;
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function extractFileText(file: File): Promise<string | null> {
  if (isTextFile(file)) {
    return readFileAsText(file);
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      const { extractText } = await import("unpdf");
      const buffer = await readFileAsArrayBuffer(file);
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      return text;
    } catch (err) {
      console.error("[unpdf] PDF text extraction failed:", err);
      return null;
    }
  }

  return null;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}
