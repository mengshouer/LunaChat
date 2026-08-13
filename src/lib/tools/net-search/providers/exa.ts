import { callHttpTool } from "../../http-tool";
import type { SearchProvider, SearchResult } from "../types";

export class ExaSearchProvider implements SearchProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const raw = await callHttpTool({
      url: "/api/exa",
      body: {
        query,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        numResults: Math.min(maxResults, 10),
      },
      requestMode: "client",
      signal,
    });

    const data = JSON.parse(raw);
    const results: SearchResult[] = (data.results || []).map(
      (r: { title?: string; url?: string; text?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.text || "",
      }),
    );
    return results;
  }
}
