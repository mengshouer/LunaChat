interface ForwardLLMRequestOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export function forwardLLMRequest({
  url,
  method = "POST",
  headers = {},
  body,
  signal,
}: ForwardLLMRequestOptions): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
}
