import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings-types";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../prompts";
import {
  createToolRegistry,
  isSearchToolEnabled,
  settingsToToolContext,
} from "./registry";

describe("web search availability", () => {
  it("disables the effective search state when the selected API key is missing", () => {
    const context = settingsToToolContext(
      {
        ...DEFAULT_SETTINGS,
        searchProvider: "tavily",
        tavilyApiKey: "",
      },
      true,
    );

    expect(isSearchToolEnabled(context)).toBe(false);
    expect(createToolRegistry(context).definitions).toEqual([]);
    expect(
      buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, isSearchToolEnabled(context)),
    ).not.toContain("You have access to a web search tool");
  });

  it("enables the tool only when search is requested and its key is present", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      searchProvider: "exa" as const,
      exaApiKey: "exa-key",
    };

    expect(isSearchToolEnabled(settingsToToolContext(settings, false))).toBe(false);
    expect(isSearchToolEnabled(settingsToToolContext(settings, true))).toBe(true);
    expect(createToolRegistry(settingsToToolContext(settings, true)).definitions)
      .toHaveLength(1);
  });
});
