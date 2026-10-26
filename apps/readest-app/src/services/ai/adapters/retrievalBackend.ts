import type { Tool } from 'ai';
import type { BookDoc } from '@/libs/document';
import type { AISettings, EmbeddingProgress, ScoredChunk } from '../types';
import type { ReedySourceStore } from './reedySourceStore';

export type RetrievalBackendKind = 'legacy-idb' | 'reedy';

export type SearchStatus = 'ok' | 'not_indexed' | 'empty_index' | 'stale_index' | 'degraded';

export type BackendIndexStatus = 'not_indexed' | 'indexing' | 'indexed' | 'failed' | 'empty_index';

export interface IndexStats {
  /** True only when retrieval can use a complete, non-empty index. */
  indexed: boolean;
  status: BackendIndexStatus;
  chunkCount: number;
  embeddingModel: string;
  embeddingDim: number;
  error?: string | null;
}

export interface SearchBookResult {
  id: string;
  text: string;
  chapterTitle: string | null;
  sectionIndex: number;
  score: number;
  /** Reedy passages expose a precise CFI; legacy chunks only expose a page. */
  cfi?: string;
  pageNumber?: number;
}

export interface SearchBookResponse {
  results: SearchBookResult[];
  status: SearchStatus;
  reason?: string;
}

export interface SearchOptions {
  topK: number;
  spoilerBoundPosition?: number;
  /** Exact chapter (spine section) scope for one-shot chapter analysis. */
  sectionIndex?: number;
}

export interface BackendIndexOptions {
  onProgress?: (progress: EmbeddingProgress) => void;
  signal?: AbortSignal;
}

/**
 * Common surface every retrieval backend exposes. Two implementations exist:
 *
 *   - `LegacyIdbBackend` — wraps the original IndexedDB-backed ragService
 *     (`indexBook`, `isBookIndexed`, `hybridSearch`, `aiStore.clearBook`).
 *     Used on web and as the fallback when Reedy is disabled or unavailable.
 *   - `ReedyBackend` — wraps Reedy's BookIndexer + BookRetriever and
 *     exposes a `lookupPassage` Vercel tool to the chat adapter.
 *
 * The legacy path injects retrieved chunks into the system prompt (the
 * model never sees a tool). The Reedy path lets the model decide when to
 * call lookupPassage; results land in `ReedySourceStore` under the
 * adapter's per-turn id.
 */
export interface RetrievalBackend {
  readonly kind: RetrievalBackendKind;

  isIndexed(bookHash: string): Promise<boolean>;
  /** Metadata used for size-aware retrieval without opening the full corpus. */
  getIndexStats?(bookHash: string): Promise<IndexStats | null>;
  indexBook(bookDoc: BookDoc, bookHash: string, options?: BackendIndexOptions): Promise<void>;
  clearBook(bookHash: string): Promise<void>;

  /** User-facing semantic/keyword search used by the AI analysis panel. */
  searchBook(query: string, bookHash: string, options: SearchOptions): Promise<SearchBookResponse>;

  /**
   * Legacy IDB path only. Returns top-K chunks the adapter folds into the
   * system prompt before calling streamText. `undefined` on Reedy.
   */
  searchForSystemPrompt?(
    query: string,
    bookHash: string,
    options: SearchOptions,
  ): Promise<ScoredChunk[]>;

  /**
   * Reedy path only. Returns the Vercel `ai`-SDK Tool the adapter passes
   * via `streamText({ tools: { lookupPassage: ... } })`. `undefined` on
   * legacy.
   */
  buildLookupTool?(args: {
    bookHash: string;
    turnId: string;
    sourceStore: ReedySourceStore;
    sectionIndex?: number;
    spoilerBoundPosition?: number;
  }): Tool;
}

/**
 * Pick the backend for a turn. Reedy is gated behind both the user setting
 * AND the Tauri platform per plan D15 — web users always get the legacy
 * path so the MVP cohort is desktop-only.
 */
export function selectBackend(args: {
  settings: AISettings;
  isTauri: boolean;
  legacy: RetrievalBackend;
  reedy: RetrievalBackend | null;
}): RetrievalBackend {
  if (args.settings.reedy?.enabled && args.isTauri && args.reedy) {
    return args.reedy;
  }
  return args.legacy;
}
