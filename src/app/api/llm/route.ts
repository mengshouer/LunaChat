import { NextRequest } from "next/server";
import { forwardLLMRequest } from "@/lib/llm/server-request";

export async function POST(request: NextRequest) {
  try {
    const { url, headers, body } = await request.json();

    if (!url || !body) {
      return new Response(JSON.stringify({ error: "url and body are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await forwardLLMRequest({ url, headers, body });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(errorText, { status: response.status });
    }

    // Stream the response back to the client
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
