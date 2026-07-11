"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderForm, ToolsForm } from "./provider-form";
import { SecurityForm } from "./security-form";
import { ProfileManager } from "./profile-manager";

export function SettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[min(720px,85vh)] flex flex-col gap-0">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Configure provider, model, API key, request mode, and tools.
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4 overflow-y-auto">
          <ProfileManager />
          <Tabs defaultValue="provider">
            <TabsList className="w-full">
              <TabsTrigger value="provider" className="flex-1">Provider</TabsTrigger>
              <TabsTrigger value="tools" className="flex-1">Tools</TabsTrigger>
              <TabsTrigger value="security" className="flex-1">Security</TabsTrigger>
            </TabsList>
            <TabsContent value="provider">
              <ProviderForm />
            </TabsContent>
            <TabsContent value="tools">
              <ToolsForm />
            </TabsContent>
            <TabsContent value="security">
              <SecurityForm />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
