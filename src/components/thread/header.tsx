"use client";

import {
  PanelRightOpen,
  Settings,
  Plus,
  Download,
  Upload,
  RotateCcw,
  MoreHorizontal,
  Wrench,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/providers/SettingsProvider";
import { useTheme } from "@/providers/ThemeProvider";
import type { ConfigTransfer } from "./use-config-transfer";

export function ThreadHeader({
  historyOpen,
  onOpenHistory,
  onNewThread,
  title,
  hideToolCalls,
  onToggleHideToolCalls,
  onOpenSettings,
  transfer,
}: {
  historyOpen: boolean;
  onOpenHistory: () => void;
  onNewThread: () => void;
  title: string;
  hideToolCalls: boolean;
  onToggleHideToolCalls: () => void;
  onOpenSettings: () => void;
  transfer: ConfigTransfer;
}) {
  const { profiles, activeProfileId, switchProfile } = useSettings();
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
      <div className="flex items-center gap-2">
        {!historyOpen && (
          <Button variant="ghost" onClick={onOpenHistory}>
            <PanelRightOpen className="size-5" />
          </Button>
        )}
        <Button variant="ghost" onClick={onNewThread}>
          <Plus className="size-5" />
        </Button>
      </div>

      {title && (
        <h2 className="hidden lg:block flex-1 min-w-0 truncate text-sm font-medium text-muted-foreground px-2">
          {title}
        </h2>
      )}

      <div className="flex items-center gap-1">
        {/* Profile switcher */}
        <select
          className="border-input bg-background text-xs rounded-md border px-2 py-1 max-w-[140px] truncate mr-1"
          value={activeProfileId ?? ""}
          onChange={(e) => switchProfile(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="More actions">
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              View
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={toggleTheme}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                {resolvedTheme === "dark" ? (
                  <Moon className="size-3.5" />
                ) : (
                  <Sun className="size-3.5" />
                )}
                Dark mode
              </span>
              <Switch
                checked={resolvedTheme === "dark"}
                onCheckedChange={toggleTheme}
                className="pointer-events-none"
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={onToggleHideToolCalls}
              className="justify-between"
            >
              <span className="flex items-center gap-2">
                <Wrench className="size-3.5" />
                Hide tools
              </span>
              <Switch
                checked={hideToolCalls}
                onCheckedChange={onToggleHideToolCalls}
                className="pointer-events-none"
              />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Data
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => transfer.setShowExportPanel((v) => !v)}>
              <Download className="size-3.5 mr-2" />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => transfer.importInputRef.current?.click()}
            >
              <Upload className="size-3.5 mr-2" />
              Import
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={transfer.handleReset}
            >
              <RotateCcw className="size-3.5 mr-2" />
              Reset All Data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={transfer.importInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) transfer.handleImportFile(file);
            e.target.value = "";
          }}
        />
        <Button variant="ghost" size="icon" onClick={onOpenSettings}>
          <Settings className="size-5" />
        </Button>
      </div>
    </div>
  );
}
