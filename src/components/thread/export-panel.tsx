"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ConfigTransfer, ExportMode } from "./use-config-transfer";

export function ExportPanel({ transfer }: { transfer: ConfigTransfer }) {
  return (
    <div className="border-b px-4 py-3 flex items-center gap-4 bg-muted/50 shrink-0">
      <div className="flex items-center gap-2">
        <Switch
          id="export-chat"
          checked={transfer.exportIncludeChat}
          onCheckedChange={transfer.setExportIncludeChat}
        />
        <Label htmlFor="export-chat" className="text-xs">
          Include chat history
        </Label>
      </div>
      <select
        className="border-input bg-background text-xs rounded-md border px-2 py-1"
        value={transfer.exportMode}
        onChange={(e) => transfer.setExportMode(e.target.value as ExportMode)}
      >
        <option value="encrypted">Encrypted backup (with API keys)</option>
        <option value="plain">Plain JSON (without API keys)</option>
      </select>
      <div className="flex items-center gap-2 ml-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => transfer.setShowExportPanel(false)}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={transfer.handleExport}>
          Export
        </Button>
      </div>
    </div>
  );
}
