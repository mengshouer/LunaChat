import { NextRequest, NextResponse } from "next/server";

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

export async function POST(request: NextRequest) {
  try {
    const {
      query,
      apiKey,
      baseUrl,
      maxResults = 5,
    } = await request.json();

    if (!query || !apiKey) {
      return NextResponse.json(
        { error: "query and apiKey are required" },
        { status: 400 },
      );
    }

    const tavilyBaseUrl = (baseUrl || DEFAULT_TAVILY_BASE_URL).replace(
      /\/+$/,
      "",
    );

    const response = await fetch(`${tavilyBaseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(maxResults, 10),
        include_answer: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Tavily API error: ${errorText}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    const results = (data.results || []).map(
      (r: { title?: string; url?: string; content?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.content || "",
      }),
    );

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
