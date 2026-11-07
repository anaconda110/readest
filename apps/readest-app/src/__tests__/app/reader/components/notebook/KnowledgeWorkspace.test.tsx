import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookDoc } from '@/libs/document';

const mocks = vi.hoisted(() => ({
  state: {
    knowledge: {},
    chapters: {},
    loadedBooks: { book: true },
    loadingBooks: {},
    runs: {},
    loadBook: vi.fn(async () => {}),
    analyze: vi.fn(),
    cancel: vi.fn(),
    deleteChapter: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
  },
}));

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, number | string>) => {
    if (!options) return value;
    return Object.entries(options).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

import { KnowledgeWorkspace } from '@/app/reader/components/notebook/KnowledgeWorkspace';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

afterEach(cleanup);

const bookDoc = {
  sections: [{ id: 'one', cfi: 'epubcfi(/6/2)' }],
  toc: [],
} as unknown as BookDoc;

describe('KnowledgeWorkspace', () => {
  it('renders the six knowledge views and analyzes the current chapter', () => {
    render(
      <KnowledgeWorkspace
        aiSettings={{ ...DEFAULT_AI_SETTINGS, enabled: true }}
        bookDoc={bookDoc}
        bookHash='book'
        bookTitle='测试书'
        authorName='作者'
        sectionIndex={0}
        chapterTitle='第一章'
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Reading knowledge' })).toBeTruthy();
    for (const label of ['Overview', 'People', 'Graph', 'Timeline', 'Places', 'Encyclopedia']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Analyze this chapter' }));
    expect(mocks.state.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ bookHash: 'book', chapterIndices: [0] }),
    );
  });

  it('shows empty states for views without data', () => {
    render(
      <KnowledgeWorkspace
        aiSettings={{ ...DEFAULT_AI_SETTINGS, enabled: true }}
        bookDoc={bookDoc}
        bookHash='book'
        bookTitle='测试书'
        authorName='作者'
        sectionIndex={0}
        chapterTitle='第一章'
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByText('Analyze a chapter to discover people')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByText('No timeline events yet')).toBeTruthy();
  });
});
