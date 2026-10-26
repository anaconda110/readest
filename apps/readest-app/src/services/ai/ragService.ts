import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getAIProvider } from './providers';
import { aiLogger } from './logger';
import type { AISettings, TextChunk, ScoredChunk, EmbeddingProgress, BookIndexMeta } from './types';

interface SectionItem {
  id: string;
  size: number;
  linear: string;
  createDocument: () => Promise<Document>;
}

interface TOCItem {
  id: number;
  label: string;
  href?: string;
}

const OLLAMA_EMBEDDING_BATCH_SIZE = 4;
const OTHER_PROVIDER_EMBEDDING_BATCH_SIZE = 16;

function getEmbeddingBatchSize(settings: AISettings): number {
  // Local embedding models are usually memory-bound. Keep the batch small so
  // a book-sized index does not fail as one oversized Ollama request.
  return settings.provider === 'ollama'
    ? OLLAMA_EMBEDDING_BATCH_SIZE
    : OTHER_PROVIDER_EMBEDDING_BATCH_SIZE;
}

export interface BookDocType {
  sections?: SectionItem[];
  toc?: TOCItem[];
  metadata?: { title?: string | { [key: string]: string }; author?: string | { name?: string } };
}

export async function isBookIndexed(bookHash: string): Promise<boolean> {
  const indexed = await aiStore.isIndexed(bookHash);
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
}

function extractTitle(metadata?: BookDocType['metadata']): string {
  if (!metadata?.title) return 'Unknown Book';
  if (typeof metadata.title === 'string') return metadata.title;
  return (
    metadata.title['en'] ||
    metadata.title['default'] ||
    Object.values(metadata.title)[0] ||
    'Unknown Book'
  );
}

function extractAuthor(metadata?: BookDocType['metadata']): string {
  if (!metadata?.author) return 'Unknown Author';
  if (typeof metadata.author === 'string') return metadata.author;
  return metadata.author.name || 'Unknown Author';
}

function getChapterTitle(toc: TOCItem[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

export async function indexBook(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  const title = extractTitle(bookDoc.metadata);

  if (await aiStore.isIndexed(bookHash)) {
    aiLogger.rag.isIndexed(bookHash, true);
    return;
  }

  aiLogger.rag.indexStart(bookHash, title);
  const sections = bookDoc.sections || [];
  const toc = bookDoc.toc || [];

  // calculate cumulative character sizes like toc.ts does
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  const cumulativeSizes = sizes.map((size) => {
    const current = cumulative;
    cumulative += size;
    return current;
  });

  try {
    const provider = getAIProvider(settings);

    // Fail fast when the local embedding server is down. Without this probe a
    // stalled provider can leave the UI sitting at 0% until the batch timeout.
    if (settings.provider === 'ollama') {
      const available = await provider.isAvailable();
      if (!available) {
        throw new Error(
          `Ollama is not reachable at ${settings.ollamaBaseUrl || 'http://127.0.0.1:11434'}. Start Ollama and try again.`,
        );
      }
    }

    onProgress?.({ current: 0, total: sections.length, phase: 'chunking' });
    aiLogger.rag.indexProgress('chunking', 0, sections.length);
    const allChunks: TextChunk[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      try {
        const doc = await section.createDocument();
        const text = extractTextFromDocument(doc);
        if (text.length < 100) continue;
        const sectionChunks = chunkSection(
          doc,
          i,
          getChapterTitle(toc, i),
          bookHash,
          cumulativeSizes[i] ?? 0,
        );
        aiLogger.chunker.section(i, text.length, sectionChunks.length);
        allChunks.push(...sectionChunks);
      } catch (e) {
        aiLogger.chunker.error(i, (e as Error).message);
      }
      onProgress?.({ current: i + 1, total: sections.length, phase: 'chunking' });
      aiLogger.rag.indexProgress('chunking', i + 1, sections.length);
    }

    aiLogger.chunker.complete(bookHash, allChunks.length);

    if (allChunks.length === 0) {
      throw new Error('No extractable text was found in this book.');
    }

    onProgress?.({ current: 0, total: allChunks.length, phase: 'embedding' });
    const embeddingModelName =
      settings.provider === 'ollama'
        ? settings.ollamaEmbeddingModel
        : settings.provider === 'openrouter'
          ? settings.openrouterEmbeddingModel || 'text-embedding-3-small'
          : settings.aiGatewayEmbeddingModel || 'text-embedding-3-small';
    aiLogger.embedding.start(embeddingModelName, allChunks.length);

    const embeddingModel = provider.getEmbeddingModel();
    const batchSize = getEmbeddingBatchSize(settings);
    let embeddingDimension: number | null = null;
    let embeddedCount = 0;

    for (let offset = 0; offset < allChunks.length; offset += batchSize) {
      const batchChunks = allChunks.slice(offset, offset + batchSize);
      const batchIndex = Math.floor(offset / batchSize) + 1;
      try {
        const { embeddings } = await withRetryAndTimeout(
          () =>
            embedMany({
              model: embeddingModel,
              values: batchChunks.map((chunk) => chunk.text),
            }),
          AI_TIMEOUTS.INDEX_EMBEDDING_BATCH,
          AI_RETRY_CONFIGS.INDEX_EMBEDDING,
        );

        if (embeddings.length !== batchChunks.length) {
          throw new Error(
            `Embedding batch ${batchIndex} returned ${embeddings.length} vectors for ${batchChunks.length} chunks.`,
          );
        }

        for (let i = 0; i < embeddings.length; i++) {
          const embedding = embeddings[i]!;
          if (!Array.isArray(embedding) || embedding.length === 0) {
            throw new Error(`Embedding batch ${batchIndex} returned an empty vector.`);
          }
          if (embeddingDimension === null) {
            embeddingDimension = embedding.length;
          } else if (embedding.length !== embeddingDimension) {
            throw new Error(
              `Embedding dimension changed from ${embeddingDimension} to ${embedding.length} in batch ${batchIndex}.`,
            );
          }
          batchChunks[i]!.embedding = embedding;
        }
      } catch (e) {
        aiLogger.embedding.error(`batch ${batchIndex}`, (e as Error).message);
        throw e;
      }

      embeddedCount += batchChunks.length;
      onProgress?.({ current: embeddedCount, total: allChunks.length, phase: 'embedding' });
      aiLogger.embedding.batch(embeddedCount, allChunks.length);
    }
    aiLogger.embedding.complete(embeddedCount, allChunks.length, embeddingDimension || 0);

    onProgress?.({ current: 0, total: 2, phase: 'indexing' });
    aiLogger.store.saveChunks(bookHash, allChunks.length);
    await aiStore.saveChunks(allChunks);

    onProgress?.({ current: 1, total: 2, phase: 'indexing' });
    aiLogger.store.saveBM25(bookHash);
    await aiStore.saveBM25Index(bookHash, allChunks);

    const meta: BookIndexMeta = {
      bookHash,
      bookTitle: title,
      authorName: extractAuthor(bookDoc.metadata),
      totalSections: sections.length,
      totalChunks: allChunks.length,
      embeddingModel: embeddingModelName,
      lastUpdated: Date.now(),
    };
    aiLogger.store.saveMeta(meta);
    await aiStore.saveMeta(meta);

    onProgress?.({ current: 2, total: 2, phase: 'indexing' });
    aiLogger.rag.indexComplete(bookHash, allChunks.length, Date.now() - startTime);
  } catch (error) {
    aiLogger.rag.indexError(bookHash, (error as Error).message);
    throw error;
  }
}

export async function hybridSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  maxPage?: number,
  sectionIndex?: number,
): Promise<ScoredChunk[]> {
  aiLogger.search.query(query, maxPage);
  const provider = getAIProvider(settings);
  let queryEmbedding: number[] | null = null;

  try {
    // use AI SDK embed with provider's embedding model
    const { embedding } = await withRetryAndTimeout(
      () =>
        embed({
          model: provider.getEmbeddingModel(),
          value: query,
        }),
      AI_TIMEOUTS.EMBEDDING_SINGLE,
      AI_RETRY_CONFIGS.EMBEDDING,
    );
    queryEmbedding = embedding;
  } catch {
    // bm25 only fallback
  }

  const results = await aiStore.hybridSearch(
    bookHash,
    queryEmbedding,
    query,
    topK,
    maxPage,
    sectionIndex,
  );
  aiLogger.search.hybridResults(results.length, [...new Set(results.map((r) => r.searchMethod))]);
  return results;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
}
