import { describe, test, expect, vi } from 'vitest';

vi.mock('lunr', () => {
  // mock lunr index for testing
  return {
    default: () => ({
      search: vi.fn(() => []),
    }),
    Index: {
      load: vi.fn(() => ({
        search: vi.fn(() => []),
      })),
    },
  };
});

// mock the global indexedDB
const createMockIDB = () => {
  const stores = new Map<string, Map<string, unknown>>();

  return {
    open: vi.fn(() => ({
      result: {
        createObjectStore: vi.fn(),
        objectStoreNames: { contains: () => false },
        transaction: vi.fn(() => ({
          objectStore: vi.fn((name: string) => ({
            put: vi.fn((value: unknown, key: string) => {
              if (!stores.has(name)) stores.set(name, new Map());
              stores.get(name)!.set(key, value);
              return { onsuccess: null, onerror: null };
            }),
            get: vi.fn((key: string) => {
              const store = stores.get(name);
              const value = store?.get(key);
              return {
                onsuccess: null,
                onerror: null,
                result: value,
              };
            }),
            index: vi.fn(() => ({
              openCursor: vi.fn(() => ({
                onsuccess: null,
                onerror: null,
              })),
            })),
          })),
          oncomplete: null,
          onerror: null,
        })),
      },
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    })),
  };
};

vi.stubGlobal('indexedDB', createMockIDB());

import type { TextChunk } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';

describe('AI Store', () => {
  describe('cosineSimilarity', () => {
    // inline implementation for testing since it's private
    const cosineSimilarity = (a: number[], b: number[]): number => {
      if (a.length !== b.length) return 0;
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
      }
      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      return denominator === 0 ? 0 : dotProduct / denominator;
    };

    test('should return 1 for identical vectors', () => {
      const vec = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1);
    });

    test('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0);
    });

    test('should return -1 for opposite vectors', () => {
      const a = [1, 1, 1];
      const b = [-1, -1, -1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
    });

    test('should handle zero vectors', () => {
      const zero = [0, 0, 0];
      const vec = [1, 2, 3];
      expect(cosineSimilarity(zero, vec)).toBe(0);
    });

    test('should return 0 for different length vectors', () => {
      const a = [1, 2];
      const b = [1, 2, 3];
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe('chunk operations', () => {
    const testChunk: TextChunk = {
      id: 'test-hash-0-0',
      bookHash: 'test-hash',
      sectionIndex: 0,
      chapterTitle: 'Test Chapter',
      pageNumber: 1,
      text: 'This is test content for the chunk.',
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    };

    test('should create valid chunk structure', () => {
      expect(testChunk.id).toBe('test-hash-0-0');
      expect(testChunk.bookHash).toBe('test-hash');
      expect(testChunk.embedding).toHaveLength(5);
    });

    test('should handle chunk without embedding', () => {
      const chunkNoEmbed: TextChunk = {
        id: 'test-hash-0-1',
        bookHash: 'test-hash',
        sectionIndex: 0,
        chapterTitle: 'Test Chapter',
        pageNumber: 1,
        text: 'Chunk without embedding.',
      };
      expect(chunkNoEmbed.embedding).toBeUndefined();
    });
  });

  describe('chapter-scoped retrieval', () => {
    const chunks: TextChunk[] = [
      {
        id: 'chunk-0',
        bookHash: 'book-1',
        sectionIndex: 0,
        chapterTitle: 'Chapter 1',
        pageNumber: 1,
        text: 'A stronger result from another chapter.',
        embedding: [1, 0],
      },
      {
        id: 'chunk-1',
        bookHash: 'book-1',
        sectionIndex: 1,
        chapterTitle: 'Chapter 2',
        pageNumber: 2,
        text: 'The only result from the current chapter.',
        embedding: [0.5, 0.5],
      },
    ];

    test('filters by section before applying the vector-search top-K cap', async () => {
      const getChunks = vi.spyOn(aiStore, 'getChunks').mockResolvedValue(chunks);
      try {
        const results = await aiStore.vectorSearch('book-1', [1, 0], 1, undefined, 1);
        expect(results.map((result) => result.id)).toEqual(['chunk-1']);
      } finally {
        getChunks.mockRestore();
      }
    });

    test('forwards the section scope to both hybrid retrieval branches', async () => {
      const vectorSearch = vi.spyOn(aiStore, 'vectorSearch').mockResolvedValue([]);
      const bm25Search = vi.spyOn(aiStore, 'bm25Search').mockResolvedValue([]);
      try {
        await aiStore.hybridSearch('book-1', [1, 0], 'query', 3, 10, 2);
        expect(vectorSearch).toHaveBeenCalledWith('book-1', [1, 0], 6, 10, 2);
        expect(bm25Search).toHaveBeenCalledWith('book-1', 'query', 6, 10, 2);
      } finally {
        vectorSearch.mockRestore();
        bm25Search.mockRestore();
      }
    });
  });
});
