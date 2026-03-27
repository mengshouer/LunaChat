import { callHttpTool } from "../../http-tool";
import type { SearchProvider, SearchResult } from "../types";

export class TavilySearchProvider implements SearchProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const raw = await callHttpTool({
      url: "/api/tavily",
      body: {
        query,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        maxResults: Math.min(maxResults, 10),
      },
      requestMode: "client",
    });

    const data = JSON.parse(raw);
    const results: SearchResult[] = (data.results || []).map(
      (r: { title?: string; url?: string; content?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.content || "",
      }),
    );
    return results;
  }
}
