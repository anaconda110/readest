import type { BookDoc } from '@/libs/document';
import { hybridSearch, indexBook as ragIndexBook, isBookIndexed } from '../ragService';
import { aiStore } from '../storage/aiStore';
import type { AISettings, ScoredChunk } from '../types';
import type {
  BackendIndexOptions,
  RetrievalBackend,
  SearchBookResponse,
  SearchOptions,
} from './retrievalBackend';

/**
 * Thin RetrievalBackend façade around the legacy IndexedDB ragService so
 * the chat adapter can hold a uniform reference. No behaviour change vs.
 * the pre-Reedy code path — just decouples the adapter from direct module
 * imports so we can swap to Reedy without `if (backendKind === ...)`
 * branches scattered across the file.
 */
export class LegacyIdbBackend implements RetrievalBackend {
  readonly kind = 'legacy-idb' as const;

  constructor(private readonly settings: AISettings) {}

  isIndexed(bookHash: string): Promise<boolean> {
    return isBookIndexed(bookHash);
  }

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    options?: BackendIndexOptions,
  ): Promise<void> {
    await ragIndexBook(
      bookDoc as unknown as Parameters<typeof ragIndexBook>[0],
      bookHash,
      this.settings,
      options?.onProgress,
    );
  }

  clearBook(bookHash: string): Promise<void> {
    return aiStore.clearBook(bookHash);
  }

  async searchBook(
    query: string,
    bookHash: string,
    options: SearchOptions,
  ): Promise<SearchBookResponse> {
    const chunks = await hybridSearch(
      bookHash,
      query,
      this.settings,
      options.topK,
      options.spoilerBoundPosition,
      options.sectionIndex,
    );
    return {
      status: 'ok',
      results: chunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        chapterTitle: chunk.chapterTitle || null,
        sectionIndex: chunk.sectionIndex,
        pageNumber: chunk.pageNumber,
        score: chunk.score,
      })),
    };
  }

  searchForSystemPrompt(
    query: string,
    bookHash: string,
    options: SearchOptions,
  ): Promise<ScoredChunk[]> {
    return hybridSearch(
      bookHash,
      query,
      this.settings,
      options.topK,
      options.spoilerBoundPosition,
      options.sectionIndex,
    );
  }
}
