import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIAnalysisWorkspace } from '@/app/reader/components/notebook/AIAnalysisWorkspace';
import type { BookDoc } from '@/libs/document';
import { getAnalysisReportId } from '@/services/ai/analysisService';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AIAnalysisReport } from '@/services/ai/types';
import { useAIAnalysisStore } from '@/store/aiAnalysisStore';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, number | string>) => {
    if (!options) return value;
    return Object.entries(options).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

const bookHash = 'book-hash';
const sectionIndex = 10;
const report: AIAnalysisReport = {
  id: getAnalysisReportId(bookHash, 'chapter', sectionIndex),
  bookHash,
  bookTitle: '灵境行者',
  kind: 'chapter',
  sectionIndex,
  chapterTitle: '第1章 礼物',
  content: '张元清清晨旧疾复发，服药后透露自己患有“大脑过载”的怪病。',
  model: 'ai-novel-reader-v2 / chapter-summary',
  status: 'complete',
  sources: [],
  createdAt: 1,
  updatedAt: 2,
  importedFrom: 'ai-novel-reader-v2',
};

const bookDoc = {
  metadata: {},
  rendition: {},
  dir: '',
  toc: [],
  sections: Array.from({ length: sectionIndex + 1 }, () => ({})),
} as unknown as BookDoc;

const commonProps = {
  kind: 'chapter' as const,
  aiSettings: DEFAULT_AI_SETTINGS,
  backend: null,
  bookDoc,
  bookHash,
  bookTitle: report.bookTitle,
  authorName: '卖报小郎君',
  sectionIndex,
  chapterTitle: report.chapterTitle ?? null,
  currentPage: 0,
  isIndexed: false,
  onOpenSettings: vi.fn(),
};

function renderWorkspace(reports: Record<string, AIAnalysisReport> = {}) {
  useAIAnalysisStore.setState({
    reports,
    loadedBooks: { [bookHash]: true },
    loadingBooks: {},
    loadReports: vi.fn(),
    startAnalysis: vi.fn(),
    cancelAnalysis: vi.fn(),
    deleteReport: vi.fn(),
  });
  return render(<AIAnalysisWorkspace {...commonProps} />);
}

afterEach(cleanup);

describe('AIAnalysisWorkspace', () => {
  beforeEach(() => {
    useAIAnalysisStore.setState(useAIAnalysisStore.getInitialState(), true);
  });

  it('shows a saved imported report while AI generation is disabled', () => {
    renderWorkspace({ [report.id]: report });

    expect(
      screen.getByText('张元清清晨旧疾复发，服药后透露自己患有“大脑过载”的怪病。'),
    ).toBeTruthy();
    expect(screen.getByText(report.model)).toBeTruthy();
    expect(screen.queryByText('Enable AI in Settings')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete analysis' })).toBeTruthy();
  });

  it('keeps the AI settings prompt when no saved report exists', () => {
    renderWorkspace();

    expect(screen.getByText('Enable AI in Settings')).toBeTruthy();
    expect(screen.queryByText('No analysis yet')).toBeNull();
  });
});
