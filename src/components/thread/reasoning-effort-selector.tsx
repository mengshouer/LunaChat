"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ReasoningEffort } from "@/lib/llm/types";

const LEVELS: { value: ReasoningEffort; label: string; abbr: string }[] = [
  { value: "none", label: "None", abbr: "Off" },
  { value: "minimal", label: "Minimal", abbr: "Min" },
  { value: "low", label: "Low", abbr: "L" },
  { value: "medium", label: "Medium", abbr: "M" },
  { value: "high", label: "High", abbr: "" },
  { value: "xhigh", label: "Extra High", abbr: "XH" },
  { value: "max", label: "Max", abbr: "Max" },
];

const DEFAULT_LEVEL: ReasoningEffort = "high";
const DEFAULT_INDEX = 4;

function getEffortColor(value: ReasoningEffort): string {
  const idx = LEVELS.findIndex((l) => l.value === value);
  if (idx === DEFAULT_INDEX) return "text-muted-foreground";
  if (idx < DEFAULT_INDEX) return "text-amber-500";
  return "text-blue-500";
}

export function ReasoningEffortSelector({
  value,
  onChange,
  disabled,
}: {
  value: ReasoningEffort;
  onChange: (level: ReasoningEffort) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = LEVELS.find((l) => l.value === value) ?? LEVELS[DEFAULT_INDEX];
  const isDefault = value === DEFAULT_LEVEL;
  const colorClass = getEffortColor(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className={cn(
            "shrink-0 h-8 gap-0.5 px-2 text-xs",
            isDefault ? "w-8" : "w-auto",
          )}
          aria-label={`Thinking: ${current.label}`}
        >
          <Brain
            className={cn("size-4 transition-colors", colorClass)}
          />
          {!isDefault && current.abbr && (
            <span className={cn("text-[9px] font-medium leading-none", colorClass)}>
              {current.abbr}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-36 p-1"
      >
        <div className="flex flex-col">
          {LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              className={cn(
                "flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors",
                level.value === value
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
              onClick={() => {
                onChange(level.value);
                setOpen(false);
              }}
            >
              <span>{level.label}</span>
              {level.value === DEFAULT_LEVEL && (
                <span className="text-[10px] text-muted-foreground">default</span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
