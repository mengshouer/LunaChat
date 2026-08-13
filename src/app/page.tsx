"use client";

import { SettingsProvider } from "@/providers/SettingsProvider";
import { ThreadProvider } from "@/providers/ThreadProvider";
import { ChatProvider } from "@/providers/chat";
import { Thread } from "@/components/thread";

export default function Home() {
  return (
    <SettingsProvider>
      <ThreadProvider>
        <ChatProvider>
          <Thread />
        </ChatProvider>
      </ThreadProvider>
    </SettingsProvider>
  );
}
