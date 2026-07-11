"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { useSettings } from "@/providers/SettingsProvider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { UnlockDialog } from "./unlock-dialog";

// Passphrase form shared by "enable encryption" and "change passphrase":
// two matching inputs, submit enabled only when they match.
function PassphraseForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (passphrase: string) => Promise<void>;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && pass !== confirm;
  const canSubmit = pass.length > 0 && pass === confirm && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(pass);
      setPass("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <PasswordInput
        placeholder="Passphrase"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
      />
      <PasswordInput
        placeholder="Confirm passphrase"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {mismatch && <p className="text-xs text-destructive">Passphrases do not match</p>}
      <Button type="button" onClick={handleSubmit} disabled={!canSubmit} className="self-start">
        {busy ? "Working..." : submitLabel}
      </Button>
    </div>
  );
}

export function SecurityForm() {
  const {
    encryptionEnabled,
    keysLocked,
    enableEncryption,
    disableEncryption,
    changePassphrase,
  } = useSettings();
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (!encryptionEnabled) {
    return (
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <Label>Encrypt API keys</Label>
          <p className="text-xs text-muted-foreground">
            Encrypt the API keys of all profiles with a passphrase
            (PBKDF2 + AES-GCM). You will be asked to unlock once per browser
            session. The passphrase is never stored — if you forget it, the
            keys cannot be recovered and must be re-entered. Chat history is
            not encrypted.
          </p>
        </div>
        <PassphraseForm
          submitLabel="Enable encryption"
          onSubmit={async (pass) => {
            await enableEncryption(pass);
            toast.success("API key encryption enabled");
          }}
        />
      </div>
    );
  }

  if (keysLocked) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="size-4" />
          API keys are encrypted and locked.
        </div>
        <Button type="button" className="self-start" onClick={() => setUnlockOpen(true)}>
          Unlock
        </Button>
        <UnlockDialog open={unlockOpen} onOpenChange={setUnlockOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm">
        <LockOpen className="size-4" />
        API keys are encrypted and unlocked for this session.
      </div>

      <div className="space-y-2">
        <Label>Change passphrase</Label>
        <PassphraseForm
          submitLabel="Change passphrase"
          onSubmit={async (pass) => {
            await changePassphrase(pass);
            toast.success("Passphrase changed");
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Disable encryption</Label>
        <p className="text-xs text-muted-foreground">
          API keys will be stored in plaintext again.
        </p>
        <Button
          type="button"
          variant="destructive"
          onClick={async () => {
            if (!window.confirm("Disable encryption and store API keys in plaintext?")) return;
            try {
              await disableEncryption();
              toast.success("Encryption disabled");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Operation failed");
            }
          }}
        >
          Disable encryption
        </Button>
      </div>
    </div>
  );
}
