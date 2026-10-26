import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AIAnalysisDisabledState,
  AIAnalysisIndexState,
  AIAnalysisPanel,
  AIAnalysisSearch,
} from '@/app/reader/components/notebook/AIAnalysisPanel';
import type { RetrievalBackend } from '@/services/ai/adapters';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string, options?: Record<string, number | string>) => {
    if (!options) return value;
    return Object.entries(options).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
      value,
    );
  },
}));

afterEach(cleanup);

function fakeBackend(overrides: Partial<RetrievalBackend> = {}): RetrievalBackend {
  return {
    kind: 'legacy-idb',
    isIndexed: vi.fn(async () => true),
    indexBook: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
    searchBook: vi.fn(async () => ({ status: 'ok' as const, results: [] })),
    ...overrides,
  };
}

describe('AIAnalysisPanel', () => {
  it('always shows the five tabs and the configured embedding engine', () => {
    render(
      <AIAnalysisPanel
        engineName='custom-embedding-model'
        qaContent={<div>Q&A content</div>}
        notesContent={<div>Notes content</div>}
        searchContent={<div>Search content</div>}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'AI Analysis' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Q&A' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Chapter Analysis' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Book Analysis' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Search' })).toBeTruthy();
    expect(screen.getByText('custom-embedding-model')).toBeTruthy();
    expect(screen.getByRole('tabpanel', { name: 'Q&A' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-controls')).toBe(
      'ai-analysis-panel-notes',
    );
    expect(
      screen.getByRole('tab', { name: 'Chapter Analysis' }).getAttribute('aria-controls'),
    ).toBe('ai-analysis-panel-qa');
  });

  it('switches tabs and routes analysis actions through the Q&A content', () => {
    const onAnalyzeChapter = vi.fn();
    const onAnalyzeBook = vi.fn();
    render(
      <AIAnalysisPanel
        engineName='embed'
        qaContent={<div>Q&A content</div>}
        notesContent={<div>Notes content</div>}
        searchContent={<div>Search content</div>}
        onAnalyzeChapter={onAnalyzeChapter}
        onAnalyzeBook={onAnalyzeBook}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Chapter Analysis' }));
    expect(onAnalyzeChapter).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'Q&A' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Book Analysis' }));
    expect(onAnalyzeBook).toHaveBeenCalledTimes(1);
  });

  it('moves focus between tabs with arrow keys without triggering analysis actions', () => {
    const onAnalyzeChapter = vi.fn();
    render(
      <AIAnalysisPanel
        engineName='embed'
        qaContent={<div>Q&A content</div>}
        notesContent={<div>Notes content</div>}
        searchContent={<div>Search content</div>}
        onAnalyzeChapter={onAnalyzeChapter}
      />,
    );

    const qaTab = screen.getByRole('tab', { name: 'Q&A' });
    const chapterTab = screen.getByRole('tab', { name: 'Chapter Analysis' });
    qaTab.focus();
    fireEvent.keyDown(qaTab, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(chapterTab);
    expect(onAnalyzeChapter).not.toHaveBeenCalled();
  });

  it('keeps the five-tab shell usable while AI is disabled', () => {
    const onOpenSettings = vi.fn();
    render(
      <AIAnalysisPanel
        engineName='nomic-embed-text'
        qaContent={<AIAnalysisDisabledState onOpenSettings={onOpenSettings} />}
        notesContent={<div>Notes content</div>}
        searchContent={<div>Search content</div>}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'AI Analysis' })).toBeTruthy();
    expect(screen.getByText('Enable AI in Settings')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open AI Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Notes content')).toBeTruthy();
  });
});

describe('AIAnalysisIndexState', () => {
  it('shows chapter progress while a book is being prepared for indexing', () => {
    render(
      <AIAnalysisIndexState
        isLoading={false}
        isIndexing={true}
        progress={{ phase: 'chunking', current: 2, total: 10 }}
        onIndex={vi.fn()}
      />,
    );

    expect(screen.getByText('Analyzing chapters...')).toBeTruthy();
    expect(screen.getByText('2 / 10 sections')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
  });
});

describe('AIAnalysisSearch', () => {
  it('uses the shared indexed state after indexing completes in another tab', async () => {
    const backend = fakeBackend({ isIndexed: vi.fn(async () => false) });
    const props = {
      backend,
      bookHash: 'book-1',
      currentPage: 0,
      spoilerProtection: false,
      onResultClick: vi.fn(),
    };

    const { rerender } = render(<AIAnalysisSearch {...props} indexedOverride={false} />);
    expect(await screen.findByText('Index this book to enable semantic search')).toBeTruthy();

    rerender(<AIAnalysisSearch {...props} indexedOverride={true} />);

    await waitFor(() =>
      expect(screen.queryByText('Index this book to enable semantic search')).toBeNull(),
    );
    expect(
      screen.getByRole('searchbox', { name: 'Search this book' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('shows the indexing prompt when the book is not indexed', async () => {
    const backend = fakeBackend({ isIndexed: vi.fn(async () => false) });
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={10}
        spoilerProtection={false}
        onResultClick={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(await screen.findByText('Index this book to enable semantic search')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Indexing' })).toBeTruthy();
  });

  it('shows indexing progress and rechecks the index after starting from search', async () => {
    let finishIndexing: (() => void) | undefined;
    const onIndex = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishIndexing = resolve;
        }),
    );
    const isIndexed = vi
      .fn<RetrievalBackend['isIndexed']>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const backend = fakeBackend({ isIndexed });

    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
        onIndex={onIndex}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start Indexing' }));

    expect(await screen.findByText('Indexing book...')).toBeTruthy();
    expect(
      screen.getByRole('searchbox', { name: 'Search this book' }).hasAttribute('disabled'),
    ).toBe(true);

    finishIndexing?.();

    await waitFor(() => expect(isIndexed).toHaveBeenCalledTimes(2));
    expect(onIndex).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('searchbox', { name: 'Search this book' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('shows the indexing error instead of the indexing prompt when indexing fails', async () => {
    const backend = fakeBackend({ isIndexed: vi.fn(async () => false) });
    const onIndex = vi.fn(async () => {
      throw new Error('index failed');
    });
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
        onIndex={onIndex}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start Indexing' }));

    expect(
      await screen.findByText('Search failed. Check your AI settings and try again.'),
    ).toBeTruthy();
    expect(screen.queryByText('Index this book to enable semantic search')).toBeNull();
  });

  it('searches the book, renders results, and opens the selected passage', async () => {
    const onResultClick = vi.fn();
    const backend = fakeBackend({
      searchBook: vi.fn(async () => ({
        status: 'ok' as const,
        results: [
          {
            id: 'chunk-1',
            text: 'A matching passage',
            chapterTitle: 'Chapter 3',
            sectionIndex: 2,
            score: 0.91,
            cfi: 'epubcfi(/6/4!/2/2)',
          },
        ],
      })),
    });

    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={10}
        spoilerProtection={true}
        onResultClick={onResultClick}
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Search this book' });
    fireEvent.change(input, { target: { value: 'matching' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('A matching passage')).toBeTruthy();
    expect(backend.searchBook).toHaveBeenCalledWith('matching', 'book-1', {
      topK: 8,
      spoilerBoundPosition: 10,
    });

    fireEvent.click(screen.getByRole('button', { name: /A matching passage/ }));
    expect(onResultClick).toHaveBeenCalledWith('epubcfi(/6/4!/2/2)', undefined);
  });

  it('shows a no-results state after a successful empty search', async () => {
    const backend = fakeBackend();
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
      />,
    );

    await waitFor(() => expect(backend.isIndexed).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this book' }), {
      target: { value: 'nothing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No matching passages')).toBeTruthy();
  });

  it('keeps text-match results visible when vector search is degraded', async () => {
    const backend = fakeBackend({
      searchBook: vi.fn(async () => ({
        status: 'degraded' as const,
        reason: 'embedding timeout',
        results: [
          {
            id: 'chunk-1',
            text: 'Text-only match',
            chapterTitle: 'Chapter 1',
            sectionIndex: 0,
            score: 0.5,
          },
        ],
      })),
    });
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this book' }), {
      target: { value: 'match' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByText(
        'Vector search is temporarily unavailable. Showing text-match results.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Text-only match')).toBeTruthy();
  });

  it('explains an empty index instead of reporting no results', async () => {
    const backend = fakeBackend({
      searchBook: vi.fn(async () => ({ status: 'empty_index' as const, results: [] })),
    });
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this book' }), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByText('This book has no extractable text, so search cannot find passages.'),
    ).toBeTruthy();
    expect(screen.queryByText('No matching passages')).toBeNull();
  });

  it('offers a re-index action when the active embedding model is stale', async () => {
    const onIndex = vi.fn(async () => {});
    const backend = fakeBackend({
      searchBook: vi.fn(async () => ({
        status: 'stale_index' as const,
        results: [],
        reason: 'model changed',
      })),
    });
    render(
      <AIAnalysisSearch
        backend={backend}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
        onIndex={onIndex}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this book' }), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByText(
        'The index uses a different embedding model. Re-index this book to search.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-index Book' }));
    await waitFor(() => expect(onIndex).toHaveBeenCalledTimes(1));
  });

  it('explains when no retrieval backend is available', () => {
    render(
      <AIAnalysisSearch
        backend={null}
        bookHash='book-1'
        currentPage={0}
        spoilerProtection={false}
        onResultClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Search is unavailable. Check your AI settings.')).toBeTruthy();
    expect(
      screen.getByRole('searchbox', { name: 'Search this book' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
