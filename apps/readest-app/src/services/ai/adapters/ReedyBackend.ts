import type { Tool } from 'ai';
import type { BookDoc } from '@/libs/document';
import type { AppService } from '@/types/system';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { BookIndexer } from '@/services/reedy/retrieval/BookIndexer';
import { BookRetriever } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel as ReedyEmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import { buildLookupTool, createTurnState } from '@/services/reedy/tools/lookupPassage';
import {
  NoopReedyMetrics,
  ReedyMetrics,
  type ReedyMetricsWriter,
} from '@/services/reedy/instrumentation';
import type { DatabaseService } from '@/types/database';
import type { AISettings, EmbeddingProgress } from '../types';
import { createLocalEmbeddingModel } from '../rag/LocalEmbeddingModel';
import {
  type BackendIndexOptions,
  type IndexStats,
  type RetrievalBackend,
  type SearchBookResponse,
} from './retrievalBackend';
import type { ReedySourceStore } from './reedySourceStore';

const REEDY_DB_KEY = 'reedy';
const REEDY_DB_FILE = 'reedy.db';
const DEFAULT_TOP_K = 5;

/**
 * Reedy retrieval backend. Lazy-opens reedy.db on first use, uses the local
 * RAG embedding model (independent from the chat provider), and exposes a
 * Vercel `lookupPassage` tool the adapter passes through to `streamText`.
 *
 * Only constructed when {@link selectBackend} returns `kind === 'reedy'`,
 * which requires both `aiSettings.reedy.enabled` and `isTauri()`.
 */
export class ReedyBackend implements RetrievalBackend {
  readonly kind = 'reedy' as const;

  private readonly dbReady: Promise<DatabaseService>;
  private readonly reedyReady: Promise<{
    reedy: ReedyDb;
    indexer: BookIndexer;
    retriever: BookRetriever;
  }>;
  private readonly model: ReedyEmbeddingModel;
  /**
   * Metrics writer — lazy because we don't want construction to block on
   * the DB open. Until the DB is ready, events go to a NoopWriter (events
   * during the first ~50ms of app startup are not load-bearing for the
   * 4-week measurement plan).
   */
  private metrics: ReedyMetricsWriter = new NoopReedyMetrics();
  private readonly sessionId: string;

  constructor(
    private readonly appService: AppService,
    settings: AISettings,
    private readonly appVersion: string = '0.0.0-dev',
  ) {
    this.model = createLocalEmbeddingModel(
      settings.ragEngine,
      settings.ragFallback ?? true,
      settings.ragCacheLimitMB,
    );
    this.sessionId = randomSessionId();
    this.dbReady = this.appService.openDatabase(REEDY_DB_KEY, REEDY_DB_FILE, 'Data', {
      experimental: ['index_method'],
    });
    this.reedyReady = this.dbReady.then((svc) => {
      this.metrics = new ReedyMetrics(svc, this.appVersion, this.sessionId);
      const reedy = new ReedyDb(svc);
      return { reedy, indexer: new BookIndexer(reedy), retriever: new BookRetriever(reedy) };
    });
  }

  /** Surface the metrics writer so the AI panel can call exportBundle(). */
  getMetrics(): ReedyMetricsWriter {
    return this.metrics;
  }

  async isIndexed(bookHash: string): Promise<boolean> {
    const { reedy } = await this.reedyReady;
    const meta = await reedy.getBookMeta(bookHash);
    return meta?.indexingStatus === 'indexed' && meta.chunkCount > 0;
  }

  async getIndexStats(bookHash: string): Promise<IndexStats | null> {
    const { reedy } = await this.reedyReady;
    const meta = await reedy.getBookMeta(bookHash);
    if (!meta) return null;
    return {
      indexed: meta.indexingStatus === 'indexed' && meta.chunkCount > 0,
      status: meta.indexingStatus,
      chunkCount: meta.chunkCount,
      embeddingModel: meta.embeddingModel,
      embeddingDim: meta.embeddingDim,
      error: meta.error,
    };
  }

  async indexBook(
    bookDoc: BookDoc,
    bookHash: string,
    options?: BackendIndexOptions,
  ): Promise<void> {
    const { indexer, reedy } = await this.reedyReady;
    this.metrics.log('book_indexing_started', { bookHash });
    try {
      await indexer.indexBook(bookDoc, bookHash, this.model, {
        onProgress: options?.onProgress
          ? (event): void => {
              const phaseMap: Record<typeof event.phase, EmbeddingProgress['phase']> = {
                'loading-model': 'loading-model',
                preparing: 'preparing',
                chunking: 'chunking',
                embedding: 'embedding',
                indexing: 'indexing',
              };
              options.onProgress?.({
                current: event.current,
                total: event.total,
                phase: phaseMap[event.phase],
              });
            }
          : undefined,
        signal: options?.signal,
      });
      const meta = await reedy.getBookMeta(bookHash);
      this.metrics.log('book_indexed', {
        bookHash,
        payload: { chunk_count: meta?.chunkCount ?? 0 },
      });
    } catch (err) {
      this.metrics.log('book_indexing_failed', {
        bookHash,
        payload: { reason: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  async clearBook(bookHash: string): Promise<void> {
    const { reedy } = await this.reedyReady;
    await reedy.dropBookData(bookHash);
  }

  async searchBook(
    query: string,
    bookHash: string,
    options: { topK: number; spoilerBoundPosition?: number },
  ): Promise<SearchBookResponse> {
    const { retriever } = await this.reedyReady;
    const result = await retriever.search({
      bookHash,
      query,
      k: options.topK,
      spoilerBoundPosition: options.spoilerBoundPosition,
      activeEmbeddingModel: this.model,
    });
    return {
      status: result.status,
      reason: result.reason,
      results: result.passages.map((passage) => ({
        id: passage.id,
        text: passage.text,
        chapterTitle: passage.chapterTitle,
        sectionIndex: passage.sectionIndex,
        score: passage.score,
        cfi: passage.cfi,
      })),
    };
  }

  buildLookupTool(args: {
    bookHash: string;
    turnId: string;
    sourceStore: ReedySourceStore;
    sectionIndex?: number;
    spoilerBoundPosition?: number;
  }): Tool {
    const { bookHash, turnId, sourceStore, sectionIndex, spoilerBoundPosition } = args;
    // Wrap the retriever so each lookupPassage call also appends its result
    // to the sourceStore — the Sources dropdown reads from the same store.
    const lazyRetriever: BookRetriever = {
      search: async (searchArgs) => {
        const { retriever } = await this.reedyReady;
        const res = await retriever.search(searchArgs);
        if (res.passages.length > 0) {
          sourceStore.append(turnId, res.passages);
        }
        return res;
      },
    } as BookRetriever;

    return buildLookupTool({
      bookHash,
      retriever: lazyRetriever,
      activeEmbeddingModel: this.model,
      turnState: createTurnState(),
      sectionIndex,
      spoilerBoundPosition,
      onEvent: (event) => {
        // Map the tool's lifecycle events into the metrics schema. The
        // tool emits short type strings; we widen them to the schema's
        // ReedyEvent union when they line up.
        const reedyEvent = mapToolEventToMetricEvent(event.type);
        if (reedyEvent) {
          this.metrics.log(reedyEvent, { bookHash, turnId, payload: event.payload });
        }
      },
    });
  }
}

function mapToolEventToMetricEvent(
  type: string,
): import('@/services/reedy/instrumentation').ReedyEvent | null {
  switch (type) {
    case 'tool_called':
      return 'tool_called';
    case 'tool_call_cached':
      return 'tool_call_cached';
    case 'tool_returned_empty':
      return 'tool_returned_empty';
    case 'tool_returned_stale':
      return 'tool_returned_stale';
    case 'budget_exceeded':
      return 'budget_exceeded';
    default:
      return null;
  }
}

function randomSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export { DEFAULT_TOP_K };
