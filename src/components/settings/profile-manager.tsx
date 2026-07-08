"use client";

import { useState } from "react";
import { Pencil, Check, X, Plus, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/providers/SettingsProvider";

export function ProfileManager() {
  const {
    profiles,
    activeProfileId,
    switchProfile,
    createProfile,
    deleteProfile,
    renameProfile,
    duplicateProfile,
  } = useSettings();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const active = profiles.find((p) => p.id === activeProfileId);

  const startRename = () => {
    if (!active) return;
    setRenameValue(active.name);
    setRenaming(true);
  };

  const confirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && activeProfileId) renameProfile(activeProfileId, trimmed);
    setRenaming(false);
  };

  const handleDelete = () => {
    if (!activeProfileId || !active) return;
    if (!window.confirm(`Delete profile "${active.name}"?`)) return;
    setRenaming(false);
    deleteProfile(activeProfileId);
  };

  return (
    <div className="flex items-center gap-1 border-b pb-3 mb-1">
      {renaming ? (
        <>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) confirmRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-7 text-xs flex-1 min-w-0"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Confirm"
            onClick={confirmRename}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Cancel"
            onClick={() => setRenaming(false)}
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <select
            className="border-input bg-background text-xs rounded-md border px-2 py-1 flex-1 min-w-0 truncate"
            value={activeProfileId ?? ""}
            onChange={(e) => switchProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Rename"
            onClick={startRename}
          >
            <Pencil className="size-3.5" />
          </Button>
          {/* createProfile/duplicateProfile intentionally auto-switch the
              active profile so the forms below immediately show it */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="New profile"
            onClick={() => createProfile()}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Duplicate"
            onClick={() => activeProfileId && duplicateProfile(activeProfileId)}
          >
            <Copy className="size-3.5" />
          </Button>
          {profiles.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive"
              title="Delete"
              onClick={handleDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
