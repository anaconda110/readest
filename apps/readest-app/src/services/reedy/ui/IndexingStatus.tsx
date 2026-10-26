'use client';

import { BookOpenIcon, Loader2Icon, RotateCw, AlertTriangle } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';

export type IndexingPhase = 'idle' | 'indexing' | 'indexed' | 'failed' | 'empty';

export type IndexingProgressPhase =
  | 'loading-model'
  | 'preparing'
  | 'chunking'
  | 'embedding'
  | 'indexing';

export interface IndexingProgress {
  phase: IndexingProgressPhase;
  current: number;
  total: number;
  percent: number;
}

export function createIndexingProgress(event: Omit<IndexingProgress, 'percent'>): IndexingProgress {
  const ratio = event.total > 0 ? event.current / event.total : 0;
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return { ...event, percent };
}

export interface IndexingStatusProps {
  status: IndexingPhase;
  /** Phase-specific indexing progress, omitted before the first update. */
  progress?: IndexingProgress;
  /** Error text shown when status='failed'. */
  errorMessage?: string;
  onIndex?: () => void;
  onReindex?: () => void;
  onCancel?: () => void;
}

/**
 * Top-of-thread status bar (Phase 4.2.h). Surfaces the book's indexing
 * lifecycle and offers the corresponding action button.
 */
export function IndexingStatus({
  status,
  progress,
  errorMessage,
  onIndex,
  onReindex,
  onCancel,
}: IndexingStatusProps) {
  const _ = useTranslation();

  if (status === 'idle') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-primary/10 rounded-full p-3'>
          <BookOpenIcon className='text-primary size-6' />
        </div>
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>{_('Index This Book')}</h3>
          <p className='text-base-content/60 text-xs'>
            {_('Enable AI search and chat for this book')}
          </p>
        </div>
        <button className='btn btn-primary btn-sm h-8 text-xs' onClick={onIndex}>
          <BookOpenIcon className='me-1.5 size-3.5' />
          {_('Start Indexing')}
        </button>
      </div>
    );
  }

  if (status === 'indexing') {
    const pct = progress?.percent ?? 0;
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

    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div>
          <p className='text-base-content mb-1 text-sm font-medium'>{_('Indexing book...')}</p>
          <p className='text-base-content/70 text-xs'>{progressLabel}</p>
          {progressCount && <p className='text-base-content/55 mt-0.5 text-xs'>{progressCount}</p>}
        </div>
        <div className='flex items-center gap-2'>
          <div
            className='bg-base-200 h-1.5 w-32 overflow-hidden rounded-full'
            role='progressbar'
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className='bg-primary h-full transition-all duration-300'
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className='text-base-content/55 w-9 text-end font-mono text-[11px]'>{pct}%</span>
        </div>
        {onCancel && (
          <button className='btn btn-ghost btn-xs text-xs' onClick={onCancel}>
            {_('Cancel')}
          </button>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-warning/10 rounded-full p-3'>
          <AlertTriangle className='text-warning size-6' />
        </div>
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>{_('Indexing failed')}</h3>
          <p className='text-base-content/60 text-xs'>{errorMessage || _('Unknown error')}</p>
        </div>
        <button className='btn btn-outline btn-sm h-8 text-xs' onClick={onReindex}>
          <RotateCw className='me-1.5 size-3.5' />
          {_('Retry indexing')}
        </button>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <BookOpenIcon className='text-base-content/40 size-6' />
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>
            {_('No extractable text')}
          </h3>
          <p className='text-base-content/60 text-xs'>
            {_(
              'This book contains no extractable text (likely an image-only PDF or scanned book), so AI cannot answer questions about its content.',
            )}
          </p>
        </div>
      </div>
    );
  }

  // status === 'indexed' — nothing visible; the thread renders.
  return null;
}
