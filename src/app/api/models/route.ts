import { NextRequest } from "next/server";
import { createLLMHeaders } from "@/lib/llm/headers";
import { resolveLLMEndpoint } from "@/lib/llm/endpoints";
import { forwardLLMRequest } from "@/lib/llm/server-request";
import type { ProviderType } from "@/lib/llm/types";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isProviderType(value: unknown): value is ProviderType {
  return value === "openai" || value === "anthropic";
}

export async function POST(request: NextRequest) {
  try {
    const { provider, baseUrl, apiKey } = await request.json();

    if (!isProviderType(provider) || typeof baseUrl !== "string" || !baseUrl.trim()) {
      return json({ error: "provider and baseUrl are required" }, 400);
    }

    const url = resolveLLMEndpoint(baseUrl, provider, "models");
    const response = await forwardLLMRequest({
      url,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...createLLMHeaders(provider, typeof apiKey === "string" ? apiKey : ""),
      },
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500,
    );
  }
}
