import { beforeEach, describe, expect, test, vi } from 'vitest';

import dataset from '@/data/aiNovelReaderV2/lingjing-xingzhe-chapters.json';
import type { TOCItem } from '@/libs/document';
import { getAnalysisReportId } from '@/services/ai/analysisService';
import {
  flattenTocForImport,
  importAiNovelReaderV2Reports,
  type AiNovelReaderV2ImportContext,
} from '@/services/ai/import/aiNovelReaderV2';
import type { AIAnalysisReport } from '@/services/ai/types';

const { saveAnalysisReportsIfAbsentMock } = vi.hoisted(() => ({
  saveAnalysisReportsIfAbsentMock: vi.fn(),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: { saveAnalysisReportsIfAbsent: saveAnalysisReportsIfAbsentMock },
}));

const toc: TOCItem[] = Object.entries(dataset.tocSignature).map(([id, label]) => ({
  id: Number(id),
  label,
  href: `chapter-${id}.xhtml`,
  index: 0,
}));

const context: AiNovelReaderV2ImportContext = {
  bookHash: dataset.bookHash,
  bookTitle: dataset.bookTitle,
  authorName: dataset.authorName,
  toc,
};

function report(
  id: string,
  content: string,
  overrides: Partial<AIAnalysisReport> = {},
): AIAnalysisReport {
  return {
    id,
    bookHash: dataset.bookHash,
    bookTitle: dataset.bookTitle,
    kind: 'chapter',
    sectionIndex: 10,
    chapterTitle: '用户已有报告',
    content,
    model: 'user-model',
    status: 'complete',
    sources: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('ai-novel-reader-v2 summary import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveAnalysisReportsIfAbsentMock.mockResolvedValue([]);
  });

  test('maps all exported summaries into durable chapter reports', async () => {
    saveAnalysisReportsIfAbsentMock.mockImplementation(
      async (reports: AIAnalysisReport[]) => reports,
    );

    const inserted = await importAiNovelReaderV2Reports(context);

    expect(inserted).toBe(1023);
    expect(saveAnalysisReportsIfAbsentMock).toHaveBeenCalledTimes(1);
    expect(saveAnalysisReportsIfAbsentMock).toHaveBeenCalledWith(expect.any(Array), {
      replaceFailed: true,
    });
    const reports = saveAnalysisReportsIfAbsentMock.mock.calls[0]![0] as AIAnalysisReport[];
    expect(reports).toHaveLength(1023);
    expect(new Set(reports.map((item) => item.sectionIndex)).size).toBe(1023);
    expect(reports.find((item) => item.sectionIndex === 737)).toBeDefined();
    expect(reports.find((item) => item.sectionIndex === 738)).toBeDefined();
    expect(reports.find((item) => item.sectionIndex === 494)).toBeUndefined();
    expect(reports.find((item) => item.sectionIndex === 687)).toBeUndefined();
    expect(reports.find((item) => item.sectionIndex === 727)).toBeUndefined();
    expect(reports.find((item) => item.sectionIndex === 728)).toBeUndefined();

    const first = reports.find((item) => item.sectionIndex === 10);
    expect(first).toEqual(
      expect.objectContaining({
        id: getAnalysisReportId(dataset.bookHash, 'chapter', 10),
        bookHash: dataset.bookHash,
        bookTitle: dataset.bookTitle,
        kind: 'chapter',
        chapterTitle: dataset.tocSignature['10'],
        content: expect.any(String),
        model: 'ai-novel-reader-v2 / chapter-summary',
        status: 'complete',
        sources: [],
        importedFrom: 'ai-novel-reader-v2',
        sourceChapterIds: expect.any(Array),
        sourceSummaryIds: expect.any(Array),
      }),
    );
    expect(first?.content.length).toBeGreaterThan(0);
  });

  test('preserves merged source order and timestamp bounds', async () => {
    saveAnalysisReportsIfAbsentMock.mockImplementation(
      async (reports: AIAnalysisReport[]) => reports,
    );
    await importAiNovelReaderV2Reports(context);

    const reports = saveAnalysisReportsIfAbsentMock.mock.calls[0]![0] as AIAnalysisReport[];
    const merged = dataset.reports.find((item) => item.sectionIndex === 238);
    const imported = reports.find((item) => item.sectionIndex === 238);

    expect(merged?.sourceSummaryIds).toHaveLength(2);
    expect(imported?.content).toContain('\n\n---\n\n');
    expect(imported?.createdAt).toBe(merged?.createdAt);
    expect(imported?.updatedAt).toBe(merged?.updatedAt);
    expect(imported?.sourceSummaryIds).toEqual(merged?.sourceSummaryIds);
  });

  test('is idempotent and never overwrites an existing user report', async () => {
    const existing = report(
      getAnalysisReportId(dataset.bookHash, 'chapter', 10),
      '用户已经生成的报告',
    );
    const stored = new Map<string, AIAnalysisReport>([[existing.id, existing]]);
    const saveIfAbsent = async (reports: AIAnalysisReport[]) => {
      const inserted: AIAnalysisReport[] = [];
      for (const item of reports) {
        if (stored.has(item.id)) continue;
        stored.set(item.id, item);
        inserted.push(item);
      }
      return inserted;
    };
    saveAnalysisReportsIfAbsentMock.mockImplementation(saveIfAbsent);

    const firstInserted = await importAiNovelReaderV2Reports(context);
    const secondInserted = await importAiNovelReaderV2Reports(context);

    expect(firstInserted).toBe(1022);
    expect(secondInserted).toBe(0);
    expect(stored.get(existing.id)).toEqual(existing);
  });

  test('requests replacement of failed empty placeholders', async () => {
    const id = getAnalysisReportId(dataset.bookHash, 'chapter', 10);
    const failed = report(id, '', { status: 'error', error: 'Provider unavailable' });
    const stored = new Map<string, AIAnalysisReport>([[id, failed]]);
    saveAnalysisReportsIfAbsentMock.mockImplementation(
      async (reports: AIAnalysisReport[], options?: { replaceFailed?: boolean }) => {
        const inserted: AIAnalysisReport[] = [];
        for (const item of reports) {
          const existing = stored.get(item.id);
          const canReplace =
            options?.replaceFailed && existing?.status === 'error' && !existing.content;
          if (existing && !canReplace) continue;
          stored.set(item.id, item);
          inserted.push(item);
        }
        return inserted;
      },
    );

    await expect(importAiNovelReaderV2Reports(context)).resolves.toBe(1023);
    expect(stored.get(id)).toEqual(
      expect.objectContaining({
        status: 'complete',
        importedFrom: 'ai-novel-reader-v2',
        content: expect.stringContaining('张元清清晨旧疾复发'),
      }),
    );
  });

  test('does not import for a mismatched book identity or TOC', async () => {
    const mismatches: AiNovelReaderV2ImportContext[] = [
      { ...context, bookHash: 'another-book' },
      { ...context, bookTitle: '另一本书' },
      { ...context, authorName: '另一位作者' },
      { ...context, toc: toc.slice(0, -1) },
      {
        ...context,
        toc: toc.map((item, index) =>
          index === 500 ? { ...item, label: `${item.label}（不同版本）` } : item,
        ),
      },
    ];

    for (const mismatch of mismatches) {
      await expect(importAiNovelReaderV2Reports(mismatch)).resolves.toBe(0);
    }
    expect(saveAnalysisReportsIfAbsentMock).not.toHaveBeenCalled();
  });

  test('flattens nested TOC entries in document order', () => {
    const nested: TOCItem[] = [
      {
        id: 0,
        label: '第一卷',
        href: '',
        index: 0,
        subitems: [
          { id: 1, label: '第1章', href: '', index: 0 },
          { id: 2, label: '第2章', href: '', index: 0 },
        ],
      },
      { id: 3, label: '第3章', href: '', index: 0 },
    ];

    expect(flattenTocForImport(nested).map((item) => item.id)).toEqual([0, 1, 2, 3]);
  });
});
