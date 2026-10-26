import type { AISettings } from '../types';

export const DEFAULT_TOP_K = 30;
export const DEFAULT_TOP_K_TIERS = [
  { maxChunks: 200, topK: 15 },
  { maxChunks: 1_000, topK: 30 },
  { maxChunks: 5_000, topK: 50 },
  { maxChunks: Number.POSITIVE_INFINITY, topK: 80 },
] as const;

export interface TopKTier {
  maxChunks: number;
  topK: number;
}

function normalizeTopK(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value!))) : fallback;
}

/** Pick retrieval breadth from the size of the actual book index. */
export function getTopKForChunkCount(chunkCount: number, settings: AISettings): number {
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
    return normalizeTopK(settings.topKDefault, DEFAULT_TOP_K);
  }
  const tiers: readonly TopKTier[] =
    settings.topKTiers && settings.topKTiers.length > 0 ? settings.topKTiers : DEFAULT_TOP_K_TIERS;
  const tier = tiers.find((candidate) => chunkCount <= candidate.maxChunks) ?? tiers.at(-1);
  return normalizeTopK(tier?.topK, normalizeTopK(settings.topKDefault, DEFAULT_TOP_K));
}
