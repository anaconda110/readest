import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import type { RetrievalBackend } from '@/services/ai/adapters';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'analysis-model' }),
}));

import {
  generateAnalysis,
  getAnalysisReportId,
  truncateAnalysisText,
  type AnalysisRunContext,
} from '@/services/ai/analysisService';

const settings: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  provider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',
  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
};

function createBookDoc(text: string): BookDoc {
  return {
    sections: [
      {
        cfi: '/body/DocFragment[1]/body/div[1]',
        createDocument: vi.fn(async () => {
          const doc = document.implementation.createHTMLDocument('Chapter');
          doc.body.textContent = text;
          return doc;
        }),
      },
    ],
  } as unknown as BookDoc;
}

function createContext(overrides: Partial<AnalysisRunContext> = {}): AnalysisRunContext {
  return {
    kind: 'chapter',
    settings,
    bookDoc: createBookDoc('The chapter text.'),
    bookHash: 'book-hash',
    bookTitle: 'Test Book',
    authorName: 'Test Author',
    sectionIndex: 0,
    chapterTitle: 'Chapter One',
    currentPage: 42,
    language: 'en',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function createBackend(overrides: Partial<RetrievalBackend> = {}): RetrievalBackend {
  return {
    kind: 'legacy-idb',
    isIndexed: vi.fn(async () => true),
    getIndexStats: vi.fn(async () => ({
      indexed: true,
      status: 'indexed' as const,
      chunkCount: 100,
      embeddingModel: 'test-embedding',
      embeddingDim: 3,
    })),
    indexBook: vi.fn(async () => undefined),
    clearBook: vi.fn(async () => undefined),
    searchBook: vi.fn(async () => ({ status: 'ok', results: [] })),
    ...overrides,
  } as RetrievalBackend;
}

describe('analysisService', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({ text: '## Analysis\n\nGrounded result [S1].' });
  });

  test('builds stable report ids by analysis scope', () => {
    expect(getAnalysisReportId('book', 'chapter', 3)).toBe('book:chapter:3');
    expect(getAnalysisReportId('book', 'book', 3)).toBe('book:book:all');
  });

  test('keeps both ends of an overlong chapter', () => {
    const text = `${'A'.repeat(30_000)}${'B'.repeat(30_000)}`;
    const truncated = truncateAnalysisText(text, 1_000);

    expect(truncated).toContain('[... middle of chapter omitted for length ...]');
    expect(truncated.startsWith('A')).toBe(true);
    expect(truncated.endsWith('B')).toBe(true);
    expect(truncated.length).toBeLessThan(text.length);
  });

  test('runs chapter analysis from the chapter document without a search index', async () => {
    const bookDoc = createBookDoc('Elizabeth arrives at Netherfield and confronts Darcy.');

    const result = await generateAnalysis(createContext({ bookDoc }));

    expect(result.content).toContain('Grounded result');
    expect(result.sources).toEqual([
      expect.objectContaining({
        id: '0-chapter',
        chapterTitle: 'Chapter One',
        sectionIndex: 0,
      }),
    ]);
    expect(result.coverage).toContain('complete current chapter');
    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(generateTextMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        prompt: expect.stringContaining('Elizabeth arrives at Netherfield'),
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  test('blocks whole-book analysis when the index is missing', async () => {
    const backend = createBackend({ isIndexed: vi.fn(async () => false) });

    await expect(generateAnalysis(createContext({ kind: 'book', backend }))).rejects.toThrow(
      'Index this book before running a whole-book analysis.',
    );
    expect(backend.searchBook).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  test('retrieves grounded whole-book evidence across focused searches', async () => {
    const searchBook = vi.fn(
      async (_query: string, _bookHash: string, options: { topK: number }) => ({
        status: 'ok' as const,
        results: [
          {
            id: `source-${options.topK}-${_query}`,
            text: `Evidence for ${_query}`,
            chapterTitle: 'Chapter One',
            sectionIndex: 0,
            score: 1,
            cfi: '/body/DocFragment[1]/body/div[1]',
          },
        ],
      }),
    );
    const backend = createBackend({ searchBook });

    const result = await generateAnalysis(
      createContext({ kind: 'book', backend, language: 'zh-CN' }),
    );

    expect(searchBook).toHaveBeenCalledTimes(5);
    expect(searchBook.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ topK: 3, spoilerBoundPosition: 42 }),
    );
    expect(result.sources).toHaveLength(5);
    expect(result.coverage).toContain('5 passages');
    expect(generateTextMock.mock.calls[0]![0].prompt).toContain('<SOURCE id="S1"');
  });
});
