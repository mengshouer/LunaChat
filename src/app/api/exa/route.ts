import { NextRequest, NextResponse } from "next/server";

const DEFAULT_EXA_BASE_URL = "https://api.exa.ai";

export async function POST(request: NextRequest) {
  try {
    const {
      query,
      apiKey,
      baseUrl,
      numResults = 5,
    } = await request.json();

    if (!query || !apiKey) {
      return NextResponse.json(
        { error: "query and apiKey are required" },
        { status: 400 },
      );
    }

    const exaBaseUrl = (baseUrl || DEFAULT_EXA_BASE_URL).replace(/\/+$/, "");

    const response = await fetch(`${exaBaseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: Math.min(numResults, 10),
        type: "auto",
        contents: {
          text: { maxCharacters: 2000 },
        },
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Exa API error: ${errorText}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    const results = (data.results || []).map(
      (r: { title?: string; url?: string; text?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        text: r.text || "",
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
