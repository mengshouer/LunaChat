"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/providers/SettingsProvider";

export function ProfileManager({
  selectedProfileId,
  onSelectProfile,
  disabled = false,
  onBusyChange,
}: {
  selectedProfileId: string | null;
  onSelectProfile: (id: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const {
    profiles,
    createProfile,
    deleteProfile,
    renameProfile,
    duplicateProfile,
  } = useSettings();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedProfileId);
  const controlsDisabled = busy || disabled;

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const run = async (work: () => Promise<void>) => {
    if (controlsDisabled) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profile operation failed");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const startRename = () => {
    if (!selected) return;
    setRenameValue(selected.name);
    setRenaming(true);
  };

  const confirmRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !selectedProfileId) {
      setRenaming(false);
      return;
    }
    void run(async () => {
      await renameProfile(selectedProfileId, trimmed);
      setRenaming(false);
    });
  };

  return (
    <div className="flex items-center gap-1 border-b pb-3 mb-1">
      {renaming ? (
        <>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmRename();
              if (event.key === "Escape") setRenaming(false);
            }}
            className="h-7 text-xs flex-1 min-w-0"
            disabled={controlsDisabled}
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="Confirm"
            disabled={controlsDisabled}
            onClick={confirmRename}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="Cancel"
            disabled={controlsDisabled}
            onClick={() => setRenaming(false)}
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <select
            className="border-input bg-background text-xs rounded-md border px-2 py-1 flex-1 min-w-0 truncate"
            value={selectedProfileId ?? ""}
            disabled={controlsDisabled}
            onChange={(event) => onSelectProfile(event.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="Rename"
            disabled={controlsDisabled}
            onClick={startRename}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="New profile"
            disabled={controlsDisabled}
            onClick={() =>
              void run(async () => onSelectProfile(await createProfile()))
            }
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="Duplicate"
            disabled={controlsDisabled || !selectedProfileId}
            onClick={() =>
              selectedProfileId &&
              void run(async () =>
                onSelectProfile(await duplicateProfile(selectedProfileId)),
              )
            }
          >
            <Copy className="size-3.5" />
          </Button>
          {profiles.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-destructive"
              title="Delete"
              disabled={controlsDisabled || !selected}
              onClick={() => {
                if (
                  !selected ||
                  !window.confirm(`Delete profile "${selected.name}"?`)
                ) {
                  return;
                }
                void run(async () => {
                  await deleteProfile(selected.id);
                  const fallback = profiles.find(
                    (profile) => profile.id !== selected.id,
                  );
                  if (fallback) onSelectProfile(fallback.id);
                });
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
