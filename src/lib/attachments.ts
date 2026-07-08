export type AttachmentKind = "image" | "file";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  extractedText?: string; // text content extracted from non-image files
}

// Represents a file selected by the user before it has been uploaded/converted
export interface PendingAttachment {
  file: File;
  previewUrl: string; // object URL for local preview
}

// Result of editing a user message's attachments: originals the user kept
// plus files newly added in the editor.
export interface AttachmentEdit {
  kept: Attachment[];
  added: PendingAttachment[];
}

// Files extracted from a paste clipboard. Returns [] when the clipboard also
// carries text/plain（复制 Excel/Word 内容时剪贴板会附带一张渲染位图，
// 不应被抢占成图片附件，此时走默认文本粘贴）。
export function extractClipboardFiles(data: DataTransfer): File[] {
  if (data.types.includes("text/plain")) return [];
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null);
}

export function toPendingAttachments(
  files: FileList | File[],
): PendingAttachment[] {
  return Array.from(files).map((file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}
