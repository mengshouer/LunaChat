import { Undo2, FileText } from "lucide-react";
import type { Message } from "@/lib/db";
import { TooltipIconButton } from "../tooltip-icon-button";

interface HumanMessageProps {
  message: Message;
  isStreaming?: boolean;
  onRollback?: () => void;
}

export function HumanMessage({
  message,
  isStreaming,
  onRollback,
}: HumanMessageProps) {
  const attachments = message.attachments ?? [];

  return (
    <div className="flex items-center ml-auto gap-2 group">
      {onRollback && (
        <TooltipIconButton
          tooltip="Rollback to here"
          side="left"
          disabled={isStreaming}
          onClick={onRollback}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Undo2 className="size-3.5" />
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
  );
}
