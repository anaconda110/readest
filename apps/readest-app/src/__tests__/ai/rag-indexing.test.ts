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

const embeddingModelMock = vi.hoisted(() => ({
  prepare: vi.fn(),
  embed: vi.fn(),
}));
const createLocalEmbeddingModelMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/storage/aiStore', () => ({ aiStore: aiStoreMock }));
vi.mock('@/services/ai/rag/LocalEmbeddingModel', () => ({
  createLocalEmbeddingModel: createLocalEmbeddingModelMock,
}));

const LOCAL_SETTINGS = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
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
  embeddingModelMock.embed.mockImplementation(async (texts: string[]) => {
    call += 1;
    const dimension = typeof dimensions === 'function' ? dimensions(call) : dimensions;
    return texts.map(() => Array.from({ length: dimension }, () => 1));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  aiStoreMock.isIndexed.mockResolvedValue(false);
  aiStoreMock.saveChunks.mockResolvedValue(undefined);
  aiStoreMock.saveBM25Index.mockResolvedValue(undefined);
  aiStoreMock.saveMeta.mockResolvedValue(undefined);
  embeddingModelMock.prepare.mockImplementation(
    async (options?: {
      onProgress?: (event: { phase: string; current: number; total: number }) => void;
    }) => {
      options?.onProgress?.({ phase: 'loading-model', current: 0, total: 1 });
      options?.onProgress?.({ phase: 'preparing', current: 1, total: 1 });
    },
  );
  createLocalEmbeddingModelMock.mockReturnValue({
    id: 'fake-local-embedding',
    dim: 3,
    batchSize: 4,
    prepare: embeddingModelMock.prepare,
    embed: embeddingModelMock.embed,
  });
  returnEmbeddings();
});

describe('legacy RAG indexing', () => {
  it('embeds large books in bounded batches and reports progress after each batch', async () => {
    const progress: EmbeddingProgress[] = [];

    await indexBook(makeBook(), 'book-batched', LOCAL_SETTINGS, (event) => progress.push(event));

    expect(embeddingModelMock.embed).toHaveBeenCalledTimes(3);
    const batchSizes = embeddingModelMock.embed.mock.calls.map(
      (call) => (call[0] as string[]).length,
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
    expect(aiStoreMock.saveMeta.mock.calls[0]![0]).toMatchObject({
      embeddingModel: 'fake-local-embedding',
    });
    expect(aiStoreMock.saveBM25Index).toHaveBeenCalledOnce();
    expect(aiStoreMock.saveMeta).toHaveBeenCalledOnce();
  });

  it('reports chunking progress for every section', async () => {
    const progress: EmbeddingProgress[] = [];

    await indexBook(makeBook(), 'book-chunk-progress', LOCAL_SETTINGS, (event) =>
      progress.push(event),
    );

    const chunkingProgress = progress
      .filter((event) => event.phase === 'chunking')
      .map((event) => event.current);
    expect(chunkingProgress).toEqual([0, 1, 2, 3]);
  });

  it('fails fast when local embedding preparation fails', async () => {
    embeddingModelMock.prepare.mockRejectedValue(new Error('Local embedding model unavailable.'));

    await expect(indexBook(makeBook(), 'book-offline', LOCAL_SETTINGS)).rejects.toThrow(
      /Local embedding model unavailable/,
    );
    expect(embeddingModelMock.embed).not.toHaveBeenCalled();
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
  });

  it('rejects an incomplete embedding response instead of saving a partial index', async () => {
    embeddingModelMock.embed.mockResolvedValue([[1, 2, 3]]);

    await expect(indexBook(makeBook(), 'book-short-response', LOCAL_SETTINGS)).rejects.toThrow(
      /returned 1 vectors for 4 chunks/,
    );
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
    expect(aiStoreMock.saveMeta).not.toHaveBeenCalled();
  });

  it('rejects inconsistent embedding dimensions across batches', async () => {
    returnEmbeddings((call) => (call === 1 ? 3 : 4));

    await expect(indexBook(makeBook(), 'book-bad-dim', LOCAL_SETTINGS)).rejects.toThrow(
      /Embedding dimension changed from 3 to 4/,
    );
    expect(aiStoreMock.saveChunks).not.toHaveBeenCalled();
  });
});
