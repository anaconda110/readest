import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexBook, type BookDocType } from '@/services/ai/ragService';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { EmbeddingProgress } from '@/services/ai/types';

const aiStoreMock = vi.hoisted(() => ({
  isIndexed: vi.fn(),
  saveChunks: vi.fn(),
  saveBM25Index: vi.fn(),
  saveMeta: vi.fn(),
}));

const providerMock = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  getEmbeddingModel: vi.fn(() => ({ modelId: 'fake-embedding-model' })),
}));

const embedManyMock = vi.hoisted(() => vi.fn());
const embedMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/storage/aiStore', () => ({ aiStore: aiStoreMock }));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: vi.fn(() => providerMock),
}));
vi.mock('ai', () => ({
  embed: embedMock,
  embedMany: embedManyMock,
}));

const OLLAMA_SETTINGS = {
  ...DEFAULT_AI_SETTINGS,
  provider: 'ollama' as const,
  enabled: true,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaEmbeddingModel: 'nomic-embed-text',
};

function makeSection(id: string, textLength: number) {
  const text = 'A'.repeat(textLength);
  return {
    id,
    size: text.length,
    linear: 'yes',
    async createDocument() {
      return new DOMParser().parseFromString(
        `<!DOCTYPE html><html><body><p>${text}</p></body></html>`,
        'text/html',
      );
    },
  };
}

function makeBook(sectionCount = 3, textLength = 1200): BookDocType {
  return {
    metadata: { title: 'Test Book', author: 'Test Author' },
    sections: Array.from({ length: sectionCount }, (_, index) =>
      makeSection(`section-${index}`, textLength),
    ),
    toc: [{ id: 0, label: 'Chapter 1' }],
  };
}

function returnEmbeddings(dimensions: number | ((call: number) => number) = 3) {
  let call = 0;
  embedManyMock.mockImplementation(async ({ values }: { values: string[] }) => {
    call += 1;
    const dimension = typeof dimensions === 'function' ? dimensions(call) : dimensions;
    return { embeddings: values.map(() => Array.from({ length: dimension }, () => 1)) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  aiStoreMock.isIndexed.mockResolvedValue(false);
  aiStoreMock.saveChunks.mockResolvedValue(undefined);
  aiStoreMock.saveBM25Index.mockResolvedValue(undefined);
  aiStoreMock.saveMeta.mockResolvedValue(undefined);
  providerMock.isAvailable.mockResolvedValue(true);
  returnEmbeddings();
});

describe('legacy RAG indexing', () => {
  it('embeds large books in bounded batches and reports progress after each batch', async () => {
    const progress: EmbeddingProgress[] = [];

    await indexBook(makeBook(), 'book-batched', OLLAMA_SETTINGS, (event) => progress.push(event));

    expect(embedManyMock).toHaveBeenCalledTimes(3);
    const batchSizes = embedManyMock.mock.calls.map(
      (call) => (call[0] as { values: string[] }).values.length,
    );
    expect(batchSizes).toEqual([4, 4, 1]);

    const embeddingProgress = progress
      .filter((event) => event.phase === 'embedding')
      .map((event) => event.current);
    expect(embeddingProgress).toEqual([0, 4, 8, 9]);

    const savedChunks = aiStoreMock.saveChunks.mock.calls[0]![0];
    expect(savedChunks).toHaveLength(9);
    expect(
      savedChunks.every((chunk: { embedding?: number[] }) => chunk.embedding?.length === 3),
    ).toBe(true);
    expect(aiStoreMock.saveBM25Index).toHaveBeenCalledOnce();
    expect(aiStoreMock.saveMeta).toHaveBeenCalledOnce();
  });

  it('reports chunking progress for every section', async () => {
    const progress: EmbeddingProgress[] = [];

    await indexBook(makeBook(), 'book-chunk-progress', OLLAMA_SETTINGS, (event) =>
      progress.push(event),
    );

    const chunkingProgress = progress
      .filter((event) => event.phase === 'chunking')
      .map((event) => event.current);
    expect(chunkingProgress).toEqual([0, 1, 2, 3]);
  });

  it('fails fast with an actionable error when Ollama is unreachable', async () => {
    providerMock.isAvailable.mockResolvedValue(false);

    await expect(indexBook(makeBook(), 'book-offline', OLLAMA_SETTINGS)).rejects.toThrow(
      /Ollama is not reachable at http:\/\/127\.0\.0\.1:11434/,
    );
    expect(embedManyMock).not.toHaveBeenCalled();
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
  });

  it('rejects an incomplete embedding response instead of saving a partial index', async () => {
    embedManyMock.mockResolvedValue({ embeddings: [[1, 2, 3]] });

    await expect(indexBook(makeBook(), 'book-short-response', OLLAMA_SETTINGS)).rejects.toThrow(
      /returned 1 vectors for 4 chunks/,
    );
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
    expect(aiStoreMock.saveMeta).not.toHaveBeenCalled();
  });

  it('rejects inconsistent embedding dimensions across batches', async () => {
    returnEmbeddings((call) => (call === 1 ? 3 : 4));

    await expect(indexBook(makeBook(), 'book-bad-dim', OLLAMA_SETTINGS)).rejects.toThrow(
      /Embedding dimension changed from 3 to 4/,
    );
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
  });
});
