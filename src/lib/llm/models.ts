export interface ModelListItem {
  id: string;
  name?: string;
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function normalizeModels(payload: unknown): ModelListItem[] {
  const source =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: unknown }).data
      : payload && typeof payload === "object" && "models" in payload
        ? (payload as { models?: unknown }).models
        : payload;

  if (!Array.isArray(source)) return [];

  const seen = new Set<string>();
  const models: ModelListItem[] = [];

  for (const item of source) {
    const id =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object"
          ? pickText(
              (item as { id?: unknown }).id,
              (item as { model?: unknown }).model,
              (item as { name?: unknown }).name,
            )
          : undefined;

    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name =
      item && typeof item === "object"
        ? pickText(
            (item as { display_name?: unknown }).display_name,
            (item as { displayName?: unknown }).displayName,
            (item as { name?: unknown }).name,
          )
        : undefined;

    models.push({ id, ...(name && name !== id ? { name } : {}) });
  }

  return models;
}
