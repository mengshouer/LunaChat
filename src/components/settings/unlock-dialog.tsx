"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useSettings } from "@/providers/SettingsProvider";

// Unlock prompt for passphrase-encrypted API keys. Reused by the composer
// gate and the settings Security tab.
export function UnlockDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlocked?: () => void;
}) {
  const { unlock, resetEncryption } = useSettings();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setPassphrase("");
      setError("");
    }
    onOpenChange(next);
  };

  const handleUnlock = async () => {
    if (!passphrase || busy) return;
    setBusy(true);
    setError("");
    try {
      if (await unlock(passphrase)) {
        close(false);
        onUnlocked?.();
      } else {
        setError("Wrong passphrase");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = () => {
    if (
      !window.confirm(
        "Forgot passphrase? Your API keys are unrecoverable and will be CLEARED. Encryption will be turned off. Profiles and chat history are kept. Continue?",
      )
    )
      return;
    resetEncryption();
    close(false);
    toast.info("API keys cleared and encryption disabled. Re-enter your keys in Settings.");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Unlock API keys</DialogTitle>
          <DialogDescription>
            Your API keys are encrypted. Enter the passphrase to unlock them
            for this session.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <PasswordInput
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="link"
              className="px-0 text-xs text-muted-foreground"
              onClick={handleForgot}
            >
              Forgot passphrase?
            </Button>
            <Button type="button" onClick={handleUnlock} disabled={!passphrase || busy}>
              {busy ? "Unlocking..." : "Unlock"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
