"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderForm, ToolsForm } from "./provider-form";

export function SettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription className="sr-only">
            Configure provider, model, API key, request mode, and tools.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <Tabs defaultValue="provider">
            <TabsList className="w-full">
              <TabsTrigger value="provider" className="flex-1">Provider</TabsTrigger>
              <TabsTrigger value="tools" className="flex-1">Tools</TabsTrigger>
            </TabsList>
            <TabsContent value="provider">
              <ProviderForm />
            </TabsContent>
            <TabsContent value="tools">
              <ToolsForm />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
