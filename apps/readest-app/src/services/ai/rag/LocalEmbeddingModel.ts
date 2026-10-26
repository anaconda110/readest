import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import {
  DEFAULT_RAG_ENGINE,
  RAG_ENGINES,
  TFIDF_DIM,
  TFIDF_ENGINE_ID,
  getRagEngineInfo,
  isSemanticRagEngine,
} from './engines';
import { DEFAULT_RAG_CACHE_LIMIT_MB, normalizeRagCacheLimitMB } from './settings';

export interface EmbeddingPrepareProgress {
  current: number;
  total: number;
  phase?: string;
}

export interface EmbeddingPrepareOptions {
  signal?: AbortSignal;
  onProgress?: (event: EmbeddingPrepareProgress) => void;
}

export interface RagEngineRuntimeStatus {
  engineId: string;
  loaded: boolean;
  cached: boolean;
  fileCount: number;
  bytes: number;
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface RagCachePruneResult {
  bytesBefore: number;
  bytesAfter: number;
  deletedFiles: number;
  overBudget: boolean;
}

interface FeatureExtractorOutput {
  data: ArrayLike<number>;
}

interface FeatureExtractor {
  (
    text: string,
    options?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
  ): Promise<FeatureExtractorOutput>;
  dispose?: () => unknown;
}

interface TransformersProgress {
  status?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

type PipelineLoader = (
  task: 'feature-extraction',
  model: string,
  options?: { progress_callback?: (event: TransformersProgress) => void },
) => Promise<FeatureExtractor>;

const TRANSFORMERS_CACHE = 'transformers-cache';
const MAX_LOADED_MODELS = 2;
const extractorCache = new Map<string, FeatureExtractor>();
const extractorLoads = new Map<string, Promise<FeatureExtractor>>();
const fallbackInfo = new Map<string, string>();

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('embedding preparation aborted');
}

async function loadFeatureExtractor(
  engineId: string,
  options: EmbeddingPrepareOptions,
): Promise<FeatureExtractor> {
  const cached = extractorCache.get(engineId);
  if (cached) return cached;
  const loading = extractorLoads.get(engineId);
  if (loading) return loading;

  const loadingPromise = (async () => {
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: 'loading-model', current: 0, total: 1 });
    const transformers = await import('@xenova/transformers');
    const { env } = transformers;
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = typeof caches !== 'undefined' && typeof caches.open === 'function';
    env.remoteHost = 'https://huggingface.co/';

    const pipeline = transformers.pipeline as unknown as PipelineLoader;
    const extractor = await pipeline('feature-extraction', getRagEngineInfo(engineId).modelKey, {
      progress_callback: (event) => {
        if (event.status === 'progress' && event.total && event.total > 0) {
          options.onProgress?.({
            phase: 'loading-model',
            current: Math.min(event.total, event.loaded ?? 0),
            total: event.total,
          });
        } else if (event.status === 'done' || event.status === 'ready') {
          options.onProgress?.({ phase: 'loading-model', current: 1, total: 1 });
        }
      },
    });
    throwIfAborted(options.signal);
    extractorCache.set(engineId, extractor);
    while (extractorCache.size > MAX_LOADED_MODELS) {
      const evictedId = extractorCache.keys().next().value as string | undefined;
      if (!evictedId) break;
      const evicted = extractorCache.get(evictedId);
      extractorCache.delete(evictedId);
      void Promise.resolve(evicted?.dispose?.()).catch(() => {});
    }
    return extractor;
  })();

  extractorLoads.set(engineId, loadingPromise);
  try {
    return await loadingPromise;
  } finally {
    extractorLoads.delete(engineId);
  }
}

function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tokenizeForTfidf(text: string): string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const tokens: string[] = [];
  const chunks = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [];

  for (const chunk of chunks) {
    if (/^\p{Script=Han}+$/u.test(chunk)) {
      if (chunk.length === 1) tokens.push(chunk);
      for (let index = 0; index < chunk.length - 1; index++) {
        tokens.push(chunk.slice(index, index + 2));
      }
    } else if (chunk.length > 1) {
      tokens.push(chunk);
      for (let index = 0; index < chunk.length - 1; index++) {
        tokens.push(chunk.slice(index, index + 2));
      }
    } else {
      tokens.push(chunk);
    }
  }
  return tokens;
}

/** Deterministic, dependency-free fallback used when a semantic model cannot load. */
export function embedTfidf(text: string, dim = TFIDF_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  const counts = new Map<number, number>();
  for (const token of tokenizeForTfidf(text)) {
    const bucket = hashToken(token) % dim;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  for (const [bucket, count] of counts) {
    vector[bucket] = 1 + Math.log(count);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export class LocalEmbeddingModel implements EmbeddingModel {
  private engineId: string;
  private vectorDim: number;
  private vectorBatchSize: number;
  private prepared = false;
  private preparePromise: Promise<void> | null = null;
  private fallbackReason: string | null = null;

  constructor(
    engineId: string = DEFAULT_RAG_ENGINE,
    private readonly fallbackEnabled = true,
    private readonly cacheLimitMB = DEFAULT_RAG_CACHE_LIMIT_MB,
  ) {
    const info = getRagEngineInfo(engineId);
    this.engineId = info.id;
    this.vectorDim = info.dim;
    this.vectorBatchSize = info.batchSize;
  }

  get id(): string {
    return this.engineId;
  }

  get dim(): number {
    return this.vectorDim;
  }

  get batchSize(): number {
    return this.vectorBatchSize;
  }

  get usedFallback(): boolean {
    return this.engineId === TFIDF_ENGINE_ID && this.fallbackReason !== null;
  }

  get fallbackError(): string | null {
    return this.fallbackReason;
  }

  async prepare(options: EmbeddingPrepareOptions = {}): Promise<void> {
    if (this.prepared) {
      await this.enforceCacheLimit();
      return;
    }
    if (!this.preparePromise) {
      this.preparePromise = this.loadOrFallback(options).catch((error) => {
        this.preparePromise = null;
        throw error;
      });
    }
    return this.preparePromise;
  }

  async embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]> {
    await this.prepare({ signal: options?.signal });
    throwIfAborted(options?.signal);
    if (!isSemanticRagEngine(this.engineId)) {
      return texts.map((text) => embedTfidf(text));
    }

    const extractor = await loadFeatureExtractor(this.engineId, { signal: options?.signal });
    const embeddings: number[][] = [];
    for (const text of texts) {
      throwIfAborted(options?.signal);
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      throwIfAborted(options?.signal);
      const embedding = Array.from(output.data);
      if (embedding.length === 0)
        throw new Error('Local embedding model returned an empty vector.');
      embeddings.push(embedding);
    }
    return embeddings;
  }

  private async loadOrFallback(options: EmbeddingPrepareOptions): Promise<void> {
    if (!isSemanticRagEngine(this.engineId)) {
      this.prepared = true;
      return;
    }

    const requestedEngine = this.engineId;
    try {
      const extractor = await loadFeatureExtractor(requestedEngine, options);
      options.onProgress?.({ phase: 'preparing', current: 0, total: 1 });
      throwIfAborted(options.signal);
      const sample = await extractor('readest embedding probe', {
        pooling: 'mean',
        normalize: true,
      });
      throwIfAborted(options.signal);
      const sampleDim = sample.data.length;
      if (sampleDim <= 0) throw new Error('Local embedding model returned an empty probe vector.');
      this.vectorDim = sampleDim;
      this.vectorBatchSize = getRagEngineInfo(requestedEngine).batchSize;
      this.prepared = true;
      await this.enforceCacheLimit();
      options.onProgress?.({ phase: 'preparing', current: 1, total: 1 });
    } catch (error) {
      // Abort is caller intent, not a model availability failure. Falling back
      // here would silently pin this model instance to TF-IDF after a timeout.
      if (options.signal?.aborted) throw error;
      if (!this.fallbackEnabled) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[RAG] Semantic model unavailable; using TF-IDF fallback.', {
        engineId: requestedEngine,
        error: message,
      });
      this.engineId = TFIDF_ENGINE_ID;
      this.vectorDim = TFIDF_DIM;
      this.vectorBatchSize = getRagEngineInfo(TFIDF_ENGINE_ID).batchSize;
      this.fallbackReason = message;
      fallbackInfo.set(requestedEngine, message);
      this.prepared = true;
      options.onProgress?.({ phase: 'preparing', current: 1, total: 1 });
    }
  }

  private async enforceCacheLimit(): Promise<void> {
    if (!isSemanticRagEngine(this.engineId)) return;
    const result = await pruneRagModelCache(this.cacheLimitMB, Array.from(extractorCache.keys()));
    if (result.overBudget) {
      console.warn('[RAG] Model cache remains above the configured soft limit.', {
        cacheLimitMB: normalizeRagCacheLimitMB(this.cacheLimitMB),
        bytes: result.bytesAfter,
        activeModels: Array.from(extractorCache.keys()),
      });
    }
  }
}

export function createLocalEmbeddingModel(
  engineId: string = DEFAULT_RAG_ENGINE,
  fallbackEnabled = true,
  cacheLimitMB = DEFAULT_RAG_CACHE_LIMIT_MB,
): LocalEmbeddingModel {
  return new LocalEmbeddingModel(engineId, fallbackEnabled, cacheLimitMB);
}

async function openTransformersCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined' || typeof caches.open !== 'function') return null;
  try {
    return await caches.open(TRANSFORMERS_CACHE);
  } catch {
    return null;
  }
}

function requestMatchesModel(url: string, modelKey: string): boolean {
  const normalized = url.split('?')[0]!.replace(/\/+$/, '');
  return normalized.includes(`/${modelKey}/`) || normalized.endsWith(`/${modelKey}`);
}

async function responseBytes(response: Response | undefined): Promise<number> {
  if (!response) return 0;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;
  try {
    return (await response.clone().blob()).size;
  } catch {
    return 0;
  }
}

export async function getRagModelCacheInfo(engineId: string): Promise<{
  cached: boolean;
  fileCount: number;
  bytes: number;
}> {
  const info = getRagEngineInfo(engineId);
  if (!info.modelKey) return { cached: false, fileCount: 0, bytes: 0 };
  const cache = await openTransformersCache();
  if (!cache) return { cached: false, fileCount: 0, bytes: 0 };

  let fileCount = 0;
  let bytes = 0;
  try {
    const requests = await cache.keys();
    for (const request of requests) {
      if (!requestMatchesModel(request.url, info.modelKey)) continue;
      fileCount++;
      const response = await cache.match(request);
      bytes += await responseBytes(response);
    }
  } catch (error) {
    console.warn('[RAG] Failed to inspect the Transformers.js cache.', error);
  }
  return { cached: fileCount > 0, fileCount, bytes };
}

/**
 * Enforce the configured model-cache budget without breaking active models.
 * Cache API keys are expected in insertion order, so inactive model files are
 * removed oldest-first. Active models are always kept; this is therefore a
 * soft limit when the active models alone exceed the configured budget.
 */
export async function pruneRagModelCache(
  cacheLimitMB = DEFAULT_RAG_CACHE_LIMIT_MB,
  keepEngineIds: string[] = [],
): Promise<RagCachePruneResult> {
  const cache = await openTransformersCache();
  if (!cache) {
    return { bytesBefore: 0, bytesAfter: 0, deletedFiles: 0, overBudget: false };
  }

  const keepModelKeys = new Set(
    keepEngineIds
      .map((engineId) => getRagEngineInfo(engineId).modelKey)
      .filter((modelKey): modelKey is string => Boolean(modelKey)),
  );
  const entries: Array<{ request: Request; modelKey: string; bytes: number }> = [];
  let bytesBefore = 0;

  try {
    for (const request of await cache.keys()) {
      const engine = RAG_ENGINES.find(
        (candidate) => candidate.semantic && requestMatchesModel(request.url, candidate.modelKey),
      );
      if (!engine) continue;
      const bytes = await responseBytes(await cache.match(request));
      entries.push({ request, modelKey: engine.modelKey, bytes });
      bytesBefore += bytes;
    }
  } catch (error) {
    console.warn('[RAG] Failed to inspect the Transformers.js cache for pruning.', error);
    return { bytesBefore: 0, bytesAfter: 0, deletedFiles: 0, overBudget: false };
  }

  const budgetBytes = normalizeRagCacheLimitMB(cacheLimitMB) * 1024 * 1024;
  let bytesAfter = bytesBefore;
  let deletedFiles = 0;
  for (const entry of entries) {
    if (bytesAfter <= budgetBytes) break;
    if (keepModelKeys.has(entry.modelKey)) continue;
    try {
      await cache.delete(entry.request);
      bytesAfter -= entry.bytes;
      deletedFiles++;
    } catch (error) {
      console.warn('[RAG] Failed to prune a cached model file.', error);
    }
  }

  return {
    bytesBefore,
    bytesAfter,
    deletedFiles,
    overBudget: bytesAfter > budgetBytes,
  };
}

export async function getRagEngineRuntimeStatus(engineId: string): Promise<RagEngineRuntimeStatus> {
  const cache = await getRagModelCacheInfo(engineId);
  return {
    engineId,
    loaded: extractorCache.has(engineId),
    ...cache,
    usedFallback: fallbackInfo.has(engineId),
    fallbackReason: fallbackInfo.get(engineId),
  };
}

export async function clearRagModelCache(engineId?: string): Promise<void> {
  const targetIds = engineId ? [engineId] : Array.from(extractorCache.keys());
  for (const targetId of targetIds) {
    const extractor = extractorCache.get(targetId);
    extractorCache.delete(targetId);
    extractorLoads.delete(targetId);
    fallbackInfo.delete(targetId);
    void Promise.resolve(extractor?.dispose?.()).catch(() => {});
  }

  const cache = await openTransformersCache();
  if (!cache) return;
  try {
    const requests = await cache.keys();
    for (const request of requests) {
      if (!engineId || requestMatchesModel(request.url, getRagEngineInfo(engineId).modelKey)) {
        await cache.delete(request);
      }
    }
  } catch (error) {
    console.warn('[RAG] Failed to clear the Transformers.js cache.', error);
  }
}
