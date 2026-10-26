export const DEFAULT_RAG_CACHE_LIMIT_MB = 256;
export const MIN_RAG_CACHE_LIMIT_MB = 32;
export const MAX_RAG_CACHE_LIMIT_MB = 4096;

export function normalizeRagCacheLimitMB(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_RAG_CACHE_LIMIT_MB;
  return Math.min(MAX_RAG_CACHE_LIMIT_MB, Math.max(MIN_RAG_CACHE_LIMIT_MB, Math.round(numeric)));
}
