"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderForm, ToolsForm } from "./provider-form";
import { ProfileManager } from "./profile-manager";
import { useSettings } from "@/providers/SettingsProvider";
import {
  DEFAULT_SETTINGS,
  profileToSettings,
  type Settings,
} from "@/lib/settings-types";

// Field-wise so it does not depend on key order, and so a value that is
// present-but-undefined compares equal to an absent one. Every Settings value
// is a primitive, which is what makes !== sufficient here.
function sameSettings(left: Settings, right: Settings): boolean {
  const keys = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ]) as Set<keyof Settings>;
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

export function SettingsPanel({
  open,
  onOpenChange,
  profileId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Which profile to open on: the one the conversation on screen actually
  // uses, which is not necessarily the global default.
  profileId: string | null;
}) {
  const { profiles, keysLocked, saveProfile, getProfileById } = useSettings();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Settings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  );
  const dirty = !keysLocked && !sameSettings(baseline, draft);
  const busy = saving || profileBusy;

  const loadProfile = useCallback(
    (id: string | null) => {
      const currentProfiles = profilesRef.current;
      const profile =
        (id ? getProfileById(id) : undefined) ?? currentProfiles[0];
      if (!profile) return;
      const settings = profileToSettings(profile);
      setSelectedProfileId(profile.id);
      setBaseline(settings);
      setDraft(settings);
    },
    [getProfileById],
  );

  useEffect(() => {
    // Never seed a draft from locked profiles: their API keys are blanked, so
    // saving would look like it is clearing them (saveProfile refuses anyway).
    if (open && !keysLocked) loadProfile(profileId);
  }, [open, profileId, keysLocked, loadProfile]);

  const handleSelectProfile = (id: string) => {
    if (busy) return;
    loadProfile(id);
  };

  const updateDraft = (updates: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  const handleSave = async () => {
    if (!selectedProfile || busy) return;
    setSaving(true);
    try {
      await saveProfile(selectedProfile.id, draft);
      setBaseline(draft);
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (busy) return;
    setDraft(baseline);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (dirty || busy)) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-[600px] h-[min(720px,85vh)] flex flex-col gap-0"
        showCloseButton={!dirty && !busy}
        onPointerDownOutside={(event) => {
          if (dirty || busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (dirty || busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Profile settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure the selected provider profile. Changes are saved manually.
          </DialogDescription>
        </DialogHeader>
        {keysLocked ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted-foreground">
            API keys are encrypted and locked. Unlock them from the Security
            menu before editing a profile.
          </div>
        ) : (
          <div className="px-4 pb-4 overflow-y-auto flex-1">
            <fieldset disabled={busy} className="contents">
              <ProfileManager
                selectedProfileId={selectedProfileId}
                onSelectProfile={handleSelectProfile}
                disabled={saving}
                onBusyChange={setProfileBusy}
              />
              <Tabs defaultValue="provider">
                <TabsList className="w-full">
                  <TabsTrigger value="provider" className="flex-1">
                    Provider
                  </TabsTrigger>
                  <TabsTrigger value="tools" className="flex-1">
                    Tools
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="provider">
                  <ProviderForm
                    key={selectedProfileId ?? "none"}
                    value={draft}
                    onChange={updateDraft}
                  />
                </TabsContent>
                <TabsContent value="tools">
                  <ToolsForm value={draft} onChange={updateDraft} />
                </TabsContent>
              </Tabs>
            </fieldset>
          </div>
        )}
        <DialogFooter className="border-t">
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={busy}>
            {keysLocked ? "Close" : "Cancel"}
          </Button>
          {!keysLocked && (
            <Button type="button" onClick={handleSave} disabled={!dirty || busy}>
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
