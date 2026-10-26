import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';
import type { AnalysisRunContext } from '@/services/ai/analysisService';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AIAnalysisReport, AISettings } from '@/services/ai/types';

const { generateAnalysisMock, aiStoreMock } = vi.hoisted(() => ({
  generateAnalysisMock: vi.fn(),
  aiStoreMock: {
    saveAnalysisReport: vi.fn(),
    getAnalysisReports: vi.fn(),
    deleteAnalysisReport: vi.fn(),
  },
}));

vi.mock('@/services/ai/analysisService', () => ({
  generateAnalysis: generateAnalysisMock,
  getAnalysisChatModelName: () => 'mock-analysis-model',
  getAnalysisReportId: (bookHash: string, kind: 'chapter' | 'book', sectionIndex?: number) =>
    `${bookHash}:${kind}:${kind === 'chapter' ? (sectionIndex ?? 'unknown') : 'all'}`,
}));

vi.mock('@/services/ai/storage/aiStore', () => ({ aiStore: aiStoreMock }));

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

const bookDoc = { sections: [] } as unknown as BookDoc;

function context(sectionIndex: number): Omit<AnalysisRunContext, 'signal'> {
  return {
    kind: 'chapter',
    settings,
    bookDoc,
    bookHash: 'book-hash',
    bookTitle: 'Test Book',
    authorName: 'Test Author',
    sectionIndex,
    chapterTitle: `Chapter ${sectionIndex + 1}`,
    currentPage: 1,
    language: 'en',
  };
}

function result(content: string) {
  return {
    content,
    model: 'mock-analysis-model',
    sources: [],
    coverage: 'Complete chapter analyzed.',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function loadStore() {
  vi.resetModules();
  return import('@/store/aiAnalysisStore');
}

describe('aiAnalysisStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAnalysisMock.mockReset();
    aiStoreMock.saveAnalysisReport.mockResolvedValue(undefined);
    aiStoreMock.getAnalysisReports.mockResolvedValue([]);
    aiStoreMock.deleteAnalysisReport.mockResolvedValue(undefined);
  });

  test('runs analyses for the same book in FIFO order', async () => {
    const first = deferred<ReturnType<typeof result>>();
    const second = deferred<ReturnType<typeof result>>();
    generateAnalysisMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { useAIAnalysisStore } = await loadStore();

    const firstId = useAIAnalysisStore.getState().startAnalysis(context(0));
    const secondId = useAIAnalysisStore.getState().startAnalysis(context(1));

    await vi.waitFor(() => expect(generateAnalysisMock).toHaveBeenCalledTimes(1));
    expect(useAIAnalysisStore.getState().reports[secondId]?.status).toBe('queued');

    first.resolve(result('First analysis'));
    await vi.waitFor(() => expect(generateAnalysisMock).toHaveBeenCalledTimes(2));
    expect(useAIAnalysisStore.getState().reports[firstId]?.status).toBe('complete');

    second.resolve(result('Second analysis'));
    await vi.waitFor(() => {
      expect(useAIAnalysisStore.getState().reports[secondId]?.status).toBe('complete');
    });
    expect(useAIAnalysisStore.getState().reports[secondId]?.content).toBe('Second analysis');
  });

  test('cancels a queued analysis without starting it', async () => {
    const first = deferred<ReturnType<typeof result>>();
    generateAnalysisMock.mockReturnValueOnce(first.promise);
    const { useAIAnalysisStore } = await loadStore();

    useAIAnalysisStore.getState().startAnalysis(context(0));
    const queuedId = useAIAnalysisStore.getState().startAnalysis(context(1));
    await vi.waitFor(() => expect(generateAnalysisMock).toHaveBeenCalledTimes(1));

    useAIAnalysisStore.getState().cancelAnalysis(queuedId);
    expect(useAIAnalysisStore.getState().reports[queuedId]?.status).toBe('cancelled');

    first.resolve(result('First analysis'));
    await vi.waitFor(() => {
      expect(useAIAnalysisStore.getState().reports['book-hash:chapter:0']?.status).toBe('complete');
    });
    expect(generateAnalysisMock).toHaveBeenCalledTimes(1);
  });

  test('converts persisted in-flight reports to retryable cancellations on reload', async () => {
    const interrupted: AIAnalysisReport = {
      id: 'book-hash:book:all',
      bookHash: 'book-hash',
      bookTitle: 'Test Book',
      kind: 'book',
      content: '',
      model: 'mock-analysis-model',
      status: 'running',
      sources: [],
      createdAt: 1,
      updatedAt: 2,
    };
    aiStoreMock.getAnalysisReports.mockResolvedValue([interrupted]);
    const { useAIAnalysisStore } = await loadStore();

    await useAIAnalysisStore.getState().loadReports('book-hash');

    expect(useAIAnalysisStore.getState().reports[interrupted.id]).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        error: expect.stringContaining('interrupted'),
      }),
    );
    expect(aiStoreMock.saveAnalysisReport).toHaveBeenCalledWith(
      expect.objectContaining({ id: interrupted.id, status: 'cancelled' }),
    );
  });
});
