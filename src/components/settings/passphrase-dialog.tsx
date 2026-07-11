"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

// Generic passphrase prompt used by encrypted export (double entry) and
// encrypted import (single entry). onSubmit throwing keeps the dialog open
// and shows the error inline.
export function PassphraseDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmEntry = false,
  submitLabel = "OK",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmEntry?: boolean;
  submitLabel?: string;
  onSubmit: (passphrase: string) => Promise<void>;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirmEntry && confirm.length > 0 && pass !== confirm;
  const canSubmit = pass.length > 0 && (!confirmEntry || pass === confirm) && !busy;

  const close = (next: boolean) => {
    if (!next) {
      setPass("");
      setConfirm("");
      setError("");
    }
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(pass);
      close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <PasswordInput
            placeholder="Passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !confirmEntry) handleSubmit();
            }}
            autoFocus
          />
          {confirmEntry && (
            <PasswordInput
              placeholder="Confirm passphrase"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
          )}
          {mismatch && (
            <p className="text-xs text-destructive">Passphrases do not match</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="self-end"
          >
            {busy ? "Working..." : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
