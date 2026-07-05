"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/providers/ThemeProvider";

// sonner does not react to the `.dark` class on <html>, so the theme
// must be passed explicitly from ThemeProvider.
export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster position="top-right" theme={resolvedTheme} />;
}
