import { useState, type CSSProperties } from "react";
import { Pencil, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import type { Message } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "../tooltip-icon-button";

interface HumanMessageProps {
  message: Message;
  isStreaming?: boolean;
  onEditSubmit?: (newContent: string) => void;
  branchIndex?: number;
  branchCount?: number;
  onSwitchBranch?: (direction: "prev" | "next") => void;
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

  const startEdit = () => {
    setDraft(message.content);
    setIsEditing(true);
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEditSubmit?.(trimmed);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 items-end ml-auto w-full max-w-xl">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsEditing(false);
            } else if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submitEdit();
            }
          }}
          rows={1}
          className="w-full resize-none rounded-2xl bg-muted px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[40px] max-h-[300px] overflow-y-auto"
          style={{ fieldSizing: "content" } as CSSProperties}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submitEdit}
            disabled={!draft.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end ml-auto max-w-full">
      <div className="flex items-center gap-2 group">
        {onEditSubmit && (
          <TooltipIconButton
            tooltip="Edit message"
            side="left"
            disabled={isStreaming}
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Pencil className="size-3.5" />
          </TooltipIconButton>
        )}
        <div className="flex flex-col gap-2 items-end">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {attachments.map((a) =>
                a.kind === "image" ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
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
