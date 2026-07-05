import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AppToaster } from "@/components/AppToaster";

const inter = Inter({
  subsets: ["latin"],
  preload: true,
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chat",
  description: "Browser-native AI chat with ReAct loop",
};

// Runs synchronously before first paint to avoid a flash of the wrong theme.
// Storage key must stay in sync with src/providers/ThemeProvider.tsx.
const themeInitScript = `(function(){try{var t=localStorage.getItem("chat-app-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <NuqsAdapter>{children}</NuqsAdapter>
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
