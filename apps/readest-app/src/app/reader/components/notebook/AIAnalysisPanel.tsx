'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangleIcon,
  BookOpenIcon,
  BotIcon,
  Loader2Icon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { RetrievalBackend } from '@/services/ai/adapters';
import { getTopKForChunkCount } from '@/services/ai/rag/topK';
import type { AISettings, EmbeddingProgress } from '@/services/ai/types';

export type AIAnalysisTab = 'qa' | 'chapter' | 'book' | 'notes' | 'search';

interface AIAnalysisPanelProps {
  engineName: string;
  qaContent: ReactNode;
  chapterContent?: ReactNode;
  bookContent?: ReactNode;
  notesContent: ReactNode;
  searchContent: ReactNode;
}

const panelId = (tab: AIAnalysisTab) => `ai-analysis-panel-${tab}`;

/** Shared five-tab shell used by both the legacy and Reedy agent paths. */
export function AIAnalysisPanel({
  engineName,
  qaContent,
  chapterContent,
  bookContent,
  notesContent,
  searchContent,
}: AIAnalysisPanelProps) {
  const _ = useTranslation();
  const [activeTab, setActiveTab] = useState<AIAnalysisTab>('qa');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs: {
    id: AIAnalysisTab;
    label: string;
    controls: AIAnalysisTab;
  }[] = [
    { id: 'qa', label: _('Q&A'), controls: 'qa' },
    { id: 'chapter', label: _('Chapter Analysis'), controls: 'chapter' },
    { id: 'book', label: _('Book Analysis'), controls: 'book' },
    { id: 'notes', label: _('Notes'), controls: 'notes' },
    { id: 'search', label: _('Search'), controls: 'search' },
  ];

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === null) return;

      event.preventDefault();
      tabRefs.current[nextIndex]?.focus();
    },
    [tabs.length],
  );

  return (
    <div className='flex h-full min-h-0 w-full flex-col bg-base-100' data-ai-analysis-panel>
      <div className='border-base-300/70 flex shrink-0 items-center justify-end gap-1 border-b px-3 py-1.5 text-[11px]'>
        <span className='text-base-content/40'>{_('Search engine')}:</span>
        <span className='text-success/80 max-w-[70%] truncate font-medium' title={engineName}>
          {engineName}
        </span>
      </div>

      <div
        className='border-base-300/70 bg-base-200/45 grid shrink-0 grid-cols-5 gap-0.5 border-b p-1'
        role='tablist'
        aria-label={_('AI Analysis')}
      >
        {tabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`ai-analysis-tab-${tab.id}`}
              type='button'
              role='tab'
              aria-selected={selected}
              aria-controls={panelId(tab.controls)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              title={tab.label}
              className={clsx(
                'focus-visible:outline-primary min-h-8 min-w-0 truncate rounded-md px-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 sm:text-xs',
                selected
                  ? 'bg-base-100 text-base-content shadow-xs'
                  : 'text-base-content/65 hover:bg-base-100/70 hover:text-base-content',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <div
          id={panelId('qa')}
          className='min-h-0 flex-1 flex-col data-[active=true]:flex'
          role='tabpanel'
          aria-labelledby='ai-analysis-tab-qa'
          data-active={activeTab === 'qa'}
          hidden={activeTab !== 'qa'}
        >
          {qaContent}
        </div>
        <div
          id={panelId('chapter')}
          className='min-h-0 flex-1 flex-col data-[active=true]:flex'
          role='tabpanel'
          aria-labelledby='ai-analysis-tab-chapter'
          data-active={activeTab === 'chapter'}
          hidden={activeTab !== 'chapter'}
        >
          {chapterContent}
        </div>
        <div
          id={panelId('book')}
          className='min-h-0 flex-1 flex-col data-[active=true]:flex'
          role='tabpanel'
          aria-labelledby='ai-analysis-tab-book'
          data-active={activeTab === 'book'}
          hidden={activeTab !== 'book'}
        >
          {bookContent}
        </div>
        <div
          id={panelId('notes')}
          className='min-h-0 flex-1 flex-col data-[active=true]:flex'
          role='tabpanel'
          aria-labelledby='ai-analysis-tab-notes'
          data-active={activeTab === 'notes'}
          hidden={activeTab !== 'notes'}
        >
          {notesContent}
        </div>
        <div
          id={panelId('search')}
          className='min-h-0 flex-1 flex-col data-[active=true]:flex'
          role='tabpanel'
          aria-labelledby='ai-analysis-tab-search'
          data-active={activeTab === 'search'}
          hidden={activeTab !== 'search'}
        >
          {searchContent}
        </div>
      </div>
    </div>
  );
}

interface AIAnalysisIndexStateProps {
  isLoading: boolean;
  isIndexing: boolean;
  progress: EmbeddingProgress | null;
  errorMessage?: string | null;
  onIndex: () => void;
}

export function AIAnalysisIndexState({
  isLoading,
  isIndexing,
  progress,
  errorMessage,
  onIndex,
}: AIAnalysisIndexStateProps) {
  const _ = useTranslation();
  const progressPercent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const progressLabel = (() => {
    switch (progress?.phase) {
      case 'loading-model':
        return _('Loading embedding model...');
      case 'preparing':
        return _('Preparing embedding model...');
      case 'chunking':
        return _('Analyzing chapters...');
      case 'embedding':
        return _('Generating embeddings...');
      case 'indexing':
        return _('Saving index...');
      default:
        return _('Preparing...');
    }
  })();
  const progressCount = progress
    ? progress.phase === 'chunking'
      ? _('{{current}} / {{total}} sections', {
          current: progress.current,
          total: progress.total,
        })
      : progress.phase === 'embedding'
        ? `${progress.current} / ${progress.total} ${_('chunks')}`
        : progress.phase === 'indexing'
          ? _('{{current}} / {{total}} steps', {
              current: progress.current,
              total: progress.total,
            })
          : null
    : null;

  if (isLoading || isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div>
          <p className='text-foreground mb-1 text-sm font-medium'>
            {isLoading ? _('Checking index status...') : _('Indexing book...')}
          </p>
          {!isLoading && (
            <>
              <p className='text-muted-foreground text-xs'>{progressLabel}</p>
              {progressCount && (
                <p className='text-muted-foreground/80 mt-0.5 text-xs'>{progressCount}</p>
              )}
            </>
          )}
        </div>
        {!isLoading && (
          <div className='flex items-center gap-2'>
            <div
              className='bg-muted h-1.5 w-32 overflow-hidden rounded-full'
              role='progressbar'
              aria-label={progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div
                className='bg-primary h-full transition-all duration-300'
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className='text-muted-foreground w-9 text-end font-mono text-[11px]'>
              {progressPercent}%
            </span>
          </div>
        )}
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-warning/10 rounded-full p-3'>
          <AlertTriangleIcon className='text-warning size-6' />
        </div>
        <div>
          <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('Indexing failed')}</h3>
          <p className='text-muted-foreground max-h-24 overflow-y-auto text-xs'>{errorMessage}</p>
        </div>
        <Button onClick={onIndex} size='sm' variant='outline' className='h-8 text-xs'>
          <RotateCwIcon className='mr-1.5 size-3.5' />
          {_('Retry indexing')}
        </Button>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
      <div className='bg-primary/10 rounded-full p-3'>
        <BookOpenIcon className='text-primary size-6' />
      </div>
      <div>
        <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('Index This Book')}</h3>
        <p className='text-muted-foreground text-xs'>
          {_('Enable AI search and chat for this book')}
        </p>
      </div>
      <Button onClick={onIndex} size='sm' className='h-8 text-xs'>
        <BookOpenIcon className='mr-1.5 size-3.5' />
        {_('Start Indexing')}
      </Button>
    </div>
  );
}

interface AIAnalysisDisabledStateProps {
  onOpenSettings?: () => void;
}

/** First-run state shown inside the five-tab shell while AI is disabled. */
export function AIAnalysisDisabledState({ onOpenSettings }: AIAnalysisDisabledStateProps) {
  const _ = useTranslation();

  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
      <div className='bg-primary/10 rounded-full p-3'>
        <BotIcon className='text-primary size-6' />
      </div>
      <div>
        <h3 className='text-foreground mb-0.5 text-sm font-medium'>{_('AI Assistant')}</h3>
        <p className='text-muted-foreground text-xs'>{_('Enable AI in Settings')}</p>
      </div>
      {onOpenSettings && (
        <Button onClick={onOpenSettings} size='sm' className='h-8 text-xs'>
          <SettingsIcon className='mr-1.5 size-3.5' />
          {_('Open AI Settings')}
        </Button>
      )}
    </div>
  );
}

interface AIAnalysisSearchProps {
  backend: RetrievalBackend | null;
  aiSettings: AISettings;
  bookHash: string;
  currentPage: number;
  spoilerProtection: boolean;
  onResultClick: (cfi?: string, pageNumber?: number) => void;
  onIndex?: () => void | Promise<void>;
  isIndexing?: boolean;
  indexProgress?: EmbeddingProgress | null;
  /** Indexing errors are owned by the parent so they survive tab switches. */
  indexError?: string | null;
  /** Shared parent state so an index completed in another tab enables search immediately. */
  indexedOverride?: boolean | null;
}

/** Semantic/keyword search over the same retrieval index used by Q&A. */
export function AIAnalysisSearch({
  backend,
  aiSettings,
  bookHash,
  currentPage,
  spoilerProtection,
  onResultClick,
  onIndex,
  isIndexing = false,
  indexProgress = null,
  indexError,
  indexedOverride,
}: AIAnalysisSearchProps) {
  const _ = useTranslation();
  const [query, setQuery] = useState('');
  const [indexed, setIndexed] = useState<boolean | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [response, setResponse] = useState<Awaited<
    ReturnType<RetrievalBackend['searchBook']>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indexCheckError, setIndexCheckError] = useState(false);
  const [isIndexingLocally, setIsIndexingLocally] = useState(false);
  const isIndexingSearch = isIndexing || isIndexingLocally;

  useEffect(() => {
    if (indexedOverride === true) {
      setIndexed(true);
      setIndexCheckError(false);
    } else if (indexedOverride === false) {
      setIndexed(false);
    }
  }, [indexedOverride]);

  useEffect(() => {
    let alive = true;
    if (!backend || !bookHash) {
      setIndexed(false);
      return;
    }
    void backend
      .isIndexed(bookHash)
      .then((value) => {
        if (alive) {
          setIndexed(value);
          setIndexCheckError(false);
        }
      })
      .catch(() => {
        if (alive) {
          setIndexed(false);
          setIndexCheckError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [backend, bookHash]);

  const handleIndex = useCallback(async () => {
    if (!onIndex || !backend) return;
    setError(null);
    setIsIndexingLocally(true);
    try {
      await onIndex();
      setIndexed(await backend.isIndexed(bookHash));
      setIndexCheckError(false);
    } catch (err) {
      setError(_('Search failed. Check your AI settings and try again.'));
      console.error('[AI] indexing from search failed', err);
    } finally {
      setIsIndexingLocally(false);
    }
  }, [_, backend, bookHash, onIndex]);

  const handleSearch = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = query.trim();
      if (!trimmed || !backend) return;

      setIsSearching(true);
      setHasSearched(true);
      setError(null);
      try {
        const stats = await backend.getIndexStats?.(bookHash);
        const result = await backend.searchBook(trimmed, bookHash, {
          topK: getTopKForChunkCount(stats?.chunkCount ?? 0, aiSettings),
          spoilerBoundPosition: spoilerProtection ? currentPage : undefined,
        });
        setResponse(result);
        if (result.status === 'not_indexed') setIndexed(false);
        if (result.status === 'ok') setIndexed(true);
      } catch (err) {
        setResponse(null);
        setError(_('Search failed. Check your AI settings and try again.'));
        console.error('[AI] search failed', err);
      } finally {
        setIsSearching(false);
      }
    },
    [_, aiSettings, backend, bookHash, currentPage, query, spoilerProtection],
  );

  const showIndexPrompt = !!backend && (indexed === false || response?.status === 'not_indexed');
  const results =
    response?.status === 'ok' || response?.status === 'degraded' ? response.results : [];
  const showNoResults =
    response?.status === 'ok' || response?.status === 'degraded' ? results.length === 0 : false;

  return (
    <div className='flex h-full min-h-0 flex-col px-3 py-2'>
      <form onSubmit={(event) => void handleSearch(event)} className='flex shrink-0 gap-2'>
        <label htmlFor='ai-analysis-search-input' className='sr-only'>
          {_('Search this book')}
        </label>
        <input
          id='ai-analysis-search-input'
          type='search'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={_('Enter a keyword or semantic query...')}
          className='border-base-300 bg-base-100 focus:border-primary h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-hidden'
          autoComplete='off'
          disabled={isIndexingSearch || !backend}
        />
        <button
          type='submit'
          aria-label={_('Search')}
          title={_('Search')}
          disabled={!query.trim() || isSearching || isIndexingSearch || !backend}
          className='bg-primary text-primary-content hover:bg-primary/90 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40'
        >
          {isSearching ? (
            <Loader2Icon className='size-4 animate-spin' />
          ) : (
            <SearchIcon className='size-4' />
          )}
        </button>
      </form>

      <div className='mt-2 flex shrink-0 items-center justify-between gap-2 text-[11px]'>
        <span className='text-base-content/45'>{_('Search this book')}</span>
        {indexed === null && (
          <span className='text-base-content/35'>{_('Checking index status...')}</span>
        )}
      </div>

      <div className='mt-1 min-h-0 flex-1 overflow-y-auto' aria-live='polite'>
        {!backend ? (
          <SearchNotice text={_('Search is unavailable. Check your AI settings.')} />
        ) : indexCheckError ? (
          <SearchNotice text={_('Could not check the book index. Try again.')} />
        ) : indexError ? (
          <div
            role='alert'
            className='flex h-full flex-col items-center justify-center gap-3 px-4 text-center'
          >
            <AlertTriangleIcon className='text-warning size-7' />
            <div>
              <p className='text-base-content text-sm font-medium'>{_('Indexing failed')}</p>
              <p className='text-base-content/55 mt-1 max-h-24 overflow-y-auto text-xs'>
                {indexError}
              </p>
            </div>
            {onIndex && (
              <Button onClick={() => void handleIndex()} size='sm' className='h-8 text-xs'>
                <RotateCwIcon className='mr-1.5 size-3.5' />
                {_('Retry indexing')}
              </Button>
            )}
          </div>
        ) : isIndexingSearch ? (
          <AIAnalysisIndexState
            isLoading={false}
            isIndexing
            progress={indexProgress}
            onIndex={() => void handleIndex()}
          />
        ) : error ? (
          <SearchNotice text={error} />
        ) : showIndexPrompt ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-4 text-center'>
            <BookOpenIcon className='text-base-content/30 size-7' />
            <p className='text-base-content/55 text-sm'>
              {_('Index this book to enable semantic search')}
            </p>
            {onIndex && (
              <Button onClick={() => void handleIndex()} size='sm' className='h-8 text-xs'>
                {_('Start Indexing')}
              </Button>
            )}
          </div>
        ) : !hasSearched ? (
          <SearchNotice text={_('Enter a query to search semantically')} />
        ) : isSearching ? (
          <SearchNotice icon='loading' text={_('Searching...')} />
        ) : response?.status === 'empty_index' ? (
          <SearchNotice
            text={_('This book has no extractable text, so search cannot find passages.')}
          />
        ) : response?.status === 'stale_index' ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-4 text-center'>
            <BookOpenIcon className='text-warning/60 size-7' />
            <p className='text-base-content/55 text-sm'>
              {_('The index uses a different embedding model. Re-index this book to search.')}
            </p>
            {onIndex && (
              <Button onClick={() => void handleIndex()} size='sm' className='h-8 text-xs'>
                {_('Re-index Book')}
              </Button>
            )}
          </div>
        ) : showNoResults ? (
          <div className='flex h-full flex-col gap-2'>
            {response?.status === 'degraded' && (
              <div className='border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs'>
                {_('Vector search is temporarily unavailable. Showing text-match results.')}
              </div>
            )}
            <SearchNotice text={_('No matching passages')} />
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {response?.status === 'degraded' && (
              <div className='border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs'>
                {_('Vector search is temporarily unavailable. Showing text-match results.')}
              </div>
            )}
            <ul className='space-y-2 pb-2'>
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type='button'
                    onClick={() => onResultClick(result.cfi, result.pageNumber)}
                    className='border-base-300 bg-base-100 hover:border-primary/40 hover:bg-base-200/60 w-full rounded-lg border p-2.5 text-left transition-colors'
                  >
                    <div className='text-base-content/55 mb-1 flex items-center justify-between gap-2 text-[11px]'>
                      <span className='truncate'>
                        {result.chapterTitle ||
                          _('Section {{index}}', { index: result.sectionIndex + 1 })}
                      </span>
                      <span className='shrink-0 font-mono'>{result.score.toFixed(2)}</span>
                    </div>
                    <p className='text-base-content line-clamp-3 text-xs leading-5'>
                      {result.text}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchNotice({ text, icon }: { text: string; icon?: 'loading' }) {
  return (
    <div className='text-base-content/45 flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-sm'>
      {icon === 'loading' && <Loader2Icon className='size-5 animate-spin' />}
      <p>{text}</p>
    </div>
  );
}
