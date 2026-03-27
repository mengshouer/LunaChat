export type SearchProviderId = "exa" | "tavily";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchProvider {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}
