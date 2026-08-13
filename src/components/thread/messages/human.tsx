import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  Pencil,
  FileText,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  X,
} from "lucide-react";
import type { Message } from "@/lib/db";
import {
  extractClipboardFiles,
  toPendingAttachments,
  type Attachment,
  type AttachmentEdit,
  type PendingAttachment,
} from "@/lib/attachments";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "../tooltip-icon-button";
import { toast } from "sonner";

interface HumanMessageProps {
  message: Message;
  isStreaming?: boolean;
  onEditSubmit?: (
    newContent: string,
    attachmentEdit: AttachmentEdit,
  ) => Promise<void>;
  branchIndex?: number;
  branchCount?: number;
  onSwitchBranch?: (direction: "prev" | "next") => void;
}

// Removable attachment thumbnail shown while editing a message
function AttachmentThumb({
  isImage,
  url,
  name,
  onRemove,
}: {
  isImage: boolean;
  url: string;
  name: string;
  onRemove: () => void;
}) {
  return (
    <div className="relative group">
      {isImage ? (
        // Edit previews may be object URLs, which next/image cannot optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          className="h-16 w-16 object-cover rounded-lg border"
        />
      ) : (
        <div className="flex items-center gap-1.5 h-16 px-3 rounded-lg border bg-muted text-sm max-w-[160px]">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

export function HumanMessage({
  message,
  isStreaming,
  onEditSubmit,
  branchIndex,
  branchCount,
  onSwitchBranch,
}: HumanMessageProps) {
  const attachments = message.attachments ?? [];
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftKept, setDraftKept] = useState<Attachment[]>([]);
  const [draftAdded, setDraftAdded] = useState<PendingAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Mirror of draftAdded so preview object URLs can be revoked when the
  // component unmounts mid-edit (e.g. switching threads or branches).
  const draftAddedRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    draftAddedRef.current = draftAdded;
  }, [draftAdded]);
  useEffect(
    () => () => {
      draftAddedRef.current.forEach((pa) => URL.revokeObjectURL(pa.previewUrl));
    },
    [],
  );

  const startEdit = () => {
    draftAdded.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setDraft(message.content);
    setDraftKept(attachments);
    setDraftAdded([]);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    draftAdded.forEach((pa) => URL.revokeObjectURL(pa.previewUrl));
    setDraftAdded([]);
    setIsEditing(false);
  };

  const addEditFiles = (files: FileList | File[]) => {
    setDraftAdded((prev) => [...prev, ...toPendingAttachments(files)]);
  };

  const removeKept = (index: number) => {
    setDraftKept((prev) => prev.filter((_, i) => i !== index));
  };

  const removeAdded = (index: number) => {
    setDraftAdded((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const hasDraftContent = (trimmed: string) =>
    !!trimmed || draftKept.length > 0 || draftAdded.length > 0;

  const submitEdit = async () => {
    // Keep the edit open while streaming — editMessage would silently
    // drop the draft otherwise.
    if (isStreaming || submitting || !onEditSubmit) return;
    const trimmed = draft.trim();
    if (!hasDraftContent(trimmed)) return;
    setSubmitting(true);
    try {
      await onEditSubmit(trimmed, { kept: draftKept, added: draftAdded });
      draftAdded.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setDraftAdded([]);
      setIsEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to edit message");
    } finally {
      setSubmitting(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 items-end ml-auto w-full max-w-xl">
        {(draftKept.length > 0 || draftAdded.length > 0) && (
          <div className="flex flex-wrap gap-2 justify-end">
            {draftKept.map((a, i) => (
              <AttachmentThumb
                key={a.id}
                isImage={a.kind === "image"}
                url={a.url}
                name={a.name}
                onRemove={() => removeKept(i)}
              />
            ))}
            {draftAdded.map((pa, i) => (
              <AttachmentThumb
                key={pa.previewUrl}
                isImage={pa.file.type.startsWith("image/")}
                url={pa.previewUrl}
                name={pa.file.name}
                onRemove={() => removeAdded(i)}
              />
            ))}
          </div>
        )}
        <textarea
          autoFocus
          value={draft}
          disabled={submitting}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = extractClipboardFiles(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault();
            addEditFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelEdit();
            } else if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void submitEdit();
            }
          }}
          rows={1}
          className="w-full resize-none rounded-2xl bg-muted px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[40px] max-h-[300px] overflow-y-auto"
          style={{ fieldSizing: "content" } as CSSProperties}
        />
        <div className="flex gap-2">
          <input
            ref={editFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addEditFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Add attachment"
            onClick={() => editFileInputRef.current?.click()}
            disabled={submitting}
          >
            <Paperclip className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelEdit}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submitEdit()}
            disabled={
              isStreaming || submitting || !hasDraftContent(draft.trim())
            }
          >
            {submitting ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end ml-auto max-w-full">
      <div className="flex items-center gap-2 group min-w-0 max-w-full">
        {onEditSubmit && (
          <TooltipIconButton
            tooltip="Edit message"
            side="left"
            disabled={isStreaming}
            onClick={startEdit}
            className="can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
          >
            <Pencil className="size-3.5" />
          </TooltipIconButton>
        )}
        <div className="flex flex-col gap-2 items-end min-w-0 max-w-full">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {attachments.map((a) =>
                a.kind === "image" ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                    {/* Persisted attachments are data URLs, not image endpoints. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.name}
                      className="h-32 max-w-[240px] object-cover rounded-2xl border"
                    />
                  </a>
                ) : (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    download={a.name}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border bg-muted text-sm hover:bg-muted/80 transition-colors"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="max-w-[180px] truncate">{a.name}</span>
                  </a>
                ),
              )}
            </div>
          )}
          {message.content && (
            <p className="px-4 py-2 rounded-3xl bg-muted ml-auto max-w-full whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
      {branchCount !== undefined &&
        branchCount > 1 &&
        branchIndex !== undefined &&
        onSwitchBranch && (
          <div className="flex items-center gap-0.5 mt-1 text-xs text-muted-foreground">
            <TooltipIconButton
              tooltip="Previous branch"
              disabled={isStreaming || branchIndex <= 1}
              onClick={() => onSwitchBranch("prev")}
            >
              <ChevronLeft className="size-3.5" />
            </TooltipIconButton>
            <span className="tabular-nums select-none">
              {branchIndex}/{branchCount}
            </span>
            <TooltipIconButton
              tooltip="Next branch"
              disabled={isStreaming || branchIndex >= branchCount}
              onClick={() => onSwitchBranch("next")}
            >
              <ChevronRight className="size-3.5" />
            </TooltipIconButton>
          </div>
        )}
    </div>
  );
}
