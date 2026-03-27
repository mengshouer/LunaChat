const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant.

System time: {system_time}`;

const SEARCH_INSTRUCTIONS = `

You have access to a web search tool. Use it when:
- The user asks about current events, real-time data, or recent information
- You need to verify facts you're unsure about
- The question requires up-to-date information beyond your knowledge

Do NOT use the search tool when:
- The user asks general knowledge questions you can confidently answer
- The task is code generation, math, or creative writing
- The answer doesn't require current/external information`;

export const DEFAULT_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + SEARCH_INSTRUCTIONS;

export function buildSystemPrompt(template: string, searchEnabled: boolean): string {
  // User custom prompt: use as-is (with time substitution only)
  if (template !== DEFAULT_SYSTEM_PROMPT) {
    return template.replace("{system_time}", new Date().toISOString());
  }
  // Default prompt: conditionally include search instructions
  const prompt = searchEnabled
    ? BASE_SYSTEM_PROMPT + SEARCH_INSTRUCTIONS
    : BASE_SYSTEM_PROMPT;
  return prompt.replace("{system_time}", new Date().toISOString());
}
