import { v4 as uuidv4 } from "uuid";
import type { Attachment, PendingAttachment } from "./attachments";
import { extractFileText } from "./file-extractor";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadAttachments(
  pending: PendingAttachment[],
): Promise<Attachment[]> {
  return Promise.all(
    pending.map(async ({ file }) => {
      const isImage = file.type.startsWith("image/");
      const kind = isImage ? "image" : "file";

      // For images: store as data URL for display and multimodal API use
      // For files: store data URL too (for download), but also extract text
      const [url, extractedText] = await Promise.all([
        fileToDataUrl(file),
        isImage ? Promise.resolve(undefined) : extractFileText(file).then((t) => t ?? undefined),
      ]);

      return {
        id: uuidv4(),
        kind,
        name: file.name,
        url,
        mimeType: file.type,
        sizeBytes: file.size,
        ...(extractedText !== undefined ? { extractedText } : {}),
      } satisfies Attachment;
    }),
  );
}
