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
