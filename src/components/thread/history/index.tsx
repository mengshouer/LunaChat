"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/providers/ThreadProvider";
import type { Thread } from "@/lib/db";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PanelRightOpen,
  PanelRightClose,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

function ThreadList({
  threads,
  currentThreadId,
  onThreadClick,
  onDeleteThread,
  onRenameThread,
}: {
  threads: Thread[];
  currentThreadId: string | null;
  onThreadClick: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEditing = (t: Thread) => {
    setEditingId(t.id);
    setDraft(t.title);
  };

  const commitEditing = () => {
    if (editingId) {
      const trimmed = draft.trim();
      if (trimmed) onRenameThread(editingId, trimmed);
    }
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col w-full gap-1 items-start justify-start overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
      {threads.map((t) => (
        <div key={t.id} className="w-full px-1 group flex items-center">
          {editingId === t.id ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEditing}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEditing();
                else if (e.key === "Escape") setEditingId(null);
              }}
              className="h-8 flex-1 min-w-0 mx-1"
            />
          ) : (
            <>
              <Button
                variant="ghost"
                className={cn(
                  "text-left items-start justify-start font-normal flex-1 min-w-0",
                  currentThreadId === t.id && "bg-accent",
                )}
                onClick={() => onThreadClick(t.id)}
                onDoubleClick={() => startEditing(t)}
              >
                <div className="flex flex-col min-w-0">
                  <p className="truncate text-ellipsis">{t.title}</p>
                </div>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing(t);
                }}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteThread(t.id);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="h-full flex flex-col w-full gap-2 items-start justify-start overflow-y-scroll">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={`skeleton-${i}`} className="w-[250px] h-10 mx-1" />
      ))}
    </div>
  );
}

export default function ThreadHistory({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const {
    threads,
    currentThreadId,
    isLoading,
    switchThread,
    createNewThread,
    removeThread,
    updateThreadTitle,
  } = useThreads();

  const handleThreadClick = (id: string) => {
    switchThread(id);
    if (!isLargeScreen) onToggle();
  };

  return (
    <>
      {/* Desktop sidebar */}
      {isOpen && isLargeScreen && (
        <div className="hidden lg:flex flex-col border-r-[1px] border-border items-start justify-start gap-4 h-screen w-[300px] shrink-0 shadow-inner-right">
          <div className="flex items-center justify-between w-full pt-1.5 px-4">
            <Button
              className="hover:bg-muted"
              variant="ghost"
              onClick={onToggle}
            >
              <PanelRightClose className="size-5" />
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">History</h1>
            <Button
              className="hover:bg-muted"
              variant="ghost"
              onClick={() => createNewThread()}
            >
              <Plus className="size-5" />
            </Button>
          </div>
          {isLoading ? (
            <ThreadHistoryLoading />
          ) : (
            <ThreadList
              threads={threads}
              currentThreadId={currentThreadId}
              onThreadClick={handleThreadClick}
              onDeleteThread={removeThread}
              onRenameThread={updateThreadTitle}
            />
          )}
        </div>
      )}

      {/* Mobile sheet */}
      <div className="lg:hidden">
        <Sheet
          open={isOpen && !isLargeScreen}
          onOpenChange={(open) => {
            if (!open) onToggle();
          }}
        >
          <SheetContent side="left" className="lg:hidden flex">
            <SheetHeader>
              <SheetTitle>History</SheetTitle>
            </SheetHeader>
            <Button
              variant="outline"
              className="mx-4 mb-2"
              onClick={() => createNewThread()}
            >
              <Plus className="size-4 mr-2" /> New Chat
            </Button>
            <ThreadList
              threads={threads}
              currentThreadId={currentThreadId}
              onThreadClick={handleThreadClick}
              onDeleteThread={removeThread}
              onRenameThread={updateThreadTitle}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
