'use client';

import {
  AlertTriangleIcon,
  BookOpenIcon,
  Clock3Icon,
  Loader2Icon,
  PlayIcon,
  RotateCwIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import i18n from '@/i18n/i18n';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookDoc } from '@/libs/document';
import type { RetrievalBackend } from '@/services/ai/adapters';
import { getAnalysisReportId } from '@/services/ai/analysisService';
import type {
  AIAnalysisKind,
  AIAnalysisReport,
  AIAnalysisSource,
  AISettings,
  EmbeddingProgress,
} from '@/services/ai/types';
import { useAIAnalysisStore } from '@/store/aiAnalysisStore';

import { AIAnalysisDisabledState, AIAnalysisIndexState } from './AIAnalysisPanel';

export interface AIAnalysisWorkspaceProps {
  kind: AIAnalysisKind;
  aiSettings?: AISettings;
  backend: RetrievalBackend | null;
  bookDoc: BookDoc | null;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  sectionIndex: number;
  chapterTitle: string | null;
  currentPage: number;
  isIndexed: boolean;
  isLoadingIndex?: boolean;
  isIndexing?: boolean;
  indexProgress?: EmbeddingProgress | null;
  indexError?: string | null;
  onIndex?: () => void | Promise<void>;
  onOpenSettings?: () => void;
  onSourceClick?: (source: AIAnalysisSource) => void;
}

function formatReportTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language || 'en');
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function reportLabel(report: AIAnalysisReport, _: ReturnType<typeof useTranslation>): string {
  const scope =
    report.kind === 'chapter'
      ? report.chapterTitle || _('Section {{index}}', { index: (report.sectionIndex ?? 0) + 1 })
      : _('Whole book');
  return `${scope} · ${formatReportTime(report.updatedAt)}`;
}

/** Durable, independent chapter/book analysis workspace. */
export function AIAnalysisWorkspace({
  kind,
  aiSettings,
  backend,
  bookDoc,
  bookHash,
  bookTitle,
  authorName,
  sectionIndex,
  chapterTitle,
  currentPage,
  isIndexed,
  isLoadingIndex = false,
  isIndexing = false,
  indexProgress = null,
  indexError,
  onIndex,
  onOpenSettings,
  onSourceClick,
}: AIAnalysisWorkspaceProps) {
  const _ = useTranslation();
  const reports = useAIAnalysisStore((state) => state.reports);
  const loadedBooks = useAIAnalysisStore((state) => state.loadedBooks);
  const loadingBooks = useAIAnalysisStore((state) => state.loadingBooks);
  const loadReports = useAIAnalysisStore((state) => state.loadReports);
  const startAnalysis = useAIAnalysisStore((state) => state.startAnalysis);
  const cancelAnalysis = useAIAnalysisStore((state) => state.cancelAnalysis);
  const deleteReport = useAIAnalysisStore((state) => state.deleteReport);

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [isIndexingLocally, setIsIndexingLocally] = useState(false);
  const [localIndexError, setLocalIndexError] = useState<string | null>(null);

  const currentReportId = getAnalysisReportId(
    bookHash,
    kind,
    kind === 'chapter' ? sectionIndex : undefined,
  );

  useEffect(() => {
    if (!bookHash || !bookDoc) return;
    void loadReports(bookHash, {
      bookTitle,
      authorName,
      toc: bookDoc.toc ?? [],
    });
  }, [authorName, bookDoc, bookHash, bookTitle, loadReports]);

  useEffect(() => {
    setSelectedReportId(currentReportId);
  }, [currentReportId]);

  const currentReport = reports[currentReportId];
  const selectedReport = selectedReportId ? reports[selectedReportId] : undefined;
  const displayedReport = selectedReport ?? currentReport;
  const aiEnabled = aiSettings?.enabled === true;
  const reportsReady = loadedBooks[bookHash] === true;
  const loadingSavedReports =
    !displayedReport && bookDoc !== null && (loadingBooks[bookHash] === true || !reportsReady);
  const savedReports = useMemo(
    () =>
      Object.values(reports)
        .filter((report) => report.bookHash === bookHash && report.kind === kind)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [bookHash, kind, reports],
  );

  const isRunning = displayedReport?.status === 'queued' || displayedReport?.status === 'running';
  const indexBusy = isIndexing || isIndexingLocally;
  const effectiveIndexError = indexError || localIndexError;

  const handleIndex = useCallback(async () => {
    if (!onIndex || indexBusy) return;
    setLocalIndexError(null);
    setIsIndexingLocally(true);
    try {
      await onIndex();
    } catch (error) {
      setLocalIndexError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsIndexingLocally(false);
    }
  }, [indexBusy, onIndex]);

  const handleGenerate = useCallback(() => {
    if (!aiSettings?.enabled || !bookDoc) return;
    if (kind === 'book' && !backend) return;
    if (kind === 'book' && !isIndexed) return;

    const reportId = startAnalysis({
      kind,
      settings: aiSettings,
      backend: backend ?? undefined,
      bookDoc,
      bookHash,
      bookTitle,
      authorName,
      sectionIndex,
      chapterTitle,
      currentPage,
      language: i18n.resolvedLanguage || i18n.language || 'en',
    });
    setSelectedReportId(reportId);
  }, [
    aiSettings,
    authorName,
    backend,
    bookDoc,
    bookHash,
    bookTitle,
    chapterTitle,
    currentPage,
    isIndexed,
    kind,
    sectionIndex,
    startAnalysis,
  ]);

  const handleDelete = useCallback(() => {
    if (!displayedReport) return;
    void deleteReport(displayedReport.id);
    setSelectedReportId(currentReportId);
  }, [currentReportId, deleteReport, displayedReport]);

  if (loadingSavedReports) {
    return (
      <WorkspaceMessage
        icon={<Loader2Icon className='size-6 animate-spin' />}
        title={_('Loading saved analyses...')}
      />
    );
  }

  if (!displayedReport && !aiEnabled) {
    return <AIAnalysisDisabledState onOpenSettings={onOpenSettings} />;
  }

  if (!displayedReport && !bookDoc) {
    return (
      <WorkspaceMessage
        icon={<BookOpenIcon className='size-7' />}
        title={_('Analysis unavailable')}
        description={_(
          'Open the book and wait for it to finish loading before generating analysis.',
        )}
      />
    );
  }

  if (!displayedReport && kind === 'chapter' && !bookDoc?.sections[sectionIndex]) {
    return (
      <WorkspaceMessage
        icon={<BookOpenIcon className='size-7' />}
        title={_('Chapter unavailable')}
        description={_('Navigate to a chapter in the book, then try again.')}
      />
    );
  }

  if (!displayedReport && kind === 'book' && !backend) {
    return (
      <WorkspaceMessage
        icon={<AlertTriangleIcon className='size-7' />}
        title={_('Analysis unavailable')}
        description={_(
          'Whole-book analysis needs the book index. Check AI settings and try again.',
        )}
      />
    );
  }

  if (!displayedReport && kind === 'book' && !isIndexed) {
    if (isLoadingIndex || indexBusy || effectiveIndexError) {
      return (
        <AIAnalysisIndexState
          isLoading={isLoadingIndex}
          isIndexing={indexBusy}
          progress={indexProgress}
          errorMessage={effectiveIndexError}
          onIndex={() => void handleIndex()}
        />
      );
    }
    return (
      <AIAnalysisIndexState
        isLoading={false}
        isIndexing={false}
        progress={indexProgress}
        onIndex={() => void handleIndex()}
      />
    );
  }

  const scopeTitle =
    kind === 'chapter'
      ? chapterTitle || _('Section {{index}}', { index: sectionIndex + 1 })
      : _('Whole book');
  const generateLabel = displayedReport ? _('Regenerate') : _('Generate analysis');

  return (
    <div className='flex h-full min-h-0 flex-col' data-ai-analysis-workspace={kind}>
      <div className='border-base-300/70 shrink-0 border-b px-3 py-2.5'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='mb-0.5 flex items-center gap-1.5'>
              <SparklesIcon className='text-primary size-3.5 shrink-0' />
              <h2 className='text-base-content truncate text-sm font-semibold'>{scopeTitle}</h2>
            </div>
            <p className='text-base-content/50 truncate text-[11px]' title={bookTitle}>
              {bookTitle}
            </p>
          </div>

          <div className='flex shrink-0 items-center gap-1'>
            {aiEnabled && isRunning ? (
              <Button
                size='sm'
                variant='outline'
                className='h-8 px-2.5 text-xs'
                onClick={() => displayedReport && cancelAnalysis(displayedReport.id)}
              >
                <XIcon className='size-3.5' />
                {_('Cancel')}
              </Button>
            ) : aiEnabled ? (
              <Button
                size='sm'
                className='h-8 px-2.5 text-xs'
                disabled={!bookDoc || (kind === 'book' && !isIndexed)}
                onClick={handleGenerate}
              >
                {displayedReport ? (
                  <RotateCwIcon className='size-3.5' />
                ) : (
                  <PlayIcon className='size-3.5' />
                )}
                {generateLabel}
              </Button>
            ) : null}
            {displayedReport && !isRunning && (
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label={_('Delete analysis')}
                title={_('Delete analysis')}
                onClick={handleDelete}
              >
                <Trash2Icon className='size-3.5' />
              </Button>
            )}
          </div>
        </div>

        {savedReports.length > 1 && (
          <label className='mt-2 flex items-center gap-2 text-[11px]'>
            <span className='text-base-content/50 shrink-0'>{_('Saved analyses')}</span>
            <select
              className='border-base-300 bg-base-100 text-base-content min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] outline-none'
              value={selectedReportId || currentReportId}
              onChange={(event) => setSelectedReportId(event.target.value)}
            >
              {savedReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {reportLabel(report, _)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-3'>
        {loadingBooks[bookHash] && !displayedReport ? (
          <WorkspaceMessage
            icon={<Loader2Icon className='size-6 animate-spin' />}
            title={_('Loading saved analyses...')}
          />
        ) : !displayedReport ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-4 text-center'>
            <div className='bg-primary/10 rounded-full p-3'>
              <SparklesIcon className='text-primary size-6' />
            </div>
            <div>
              <h3 className='text-base-content mb-1 text-sm font-medium'>{_('No analysis yet')}</h3>
              <p className='text-base-content/50 text-xs'>
                {kind === 'chapter'
                  ? _('Generate an evidence-based analysis of this chapter.')
                  : _('Generate an evidence-based overview from indexed passages across the book.')}
              </p>
            </div>
            <Button size='sm' className='h-8 text-xs' onClick={handleGenerate}>
              <SparklesIcon className='size-3.5' />
              {_('Generate analysis')}
            </Button>
          </div>
        ) : displayedReport.status === 'queued' || displayedReport.status === 'running' ? (
          <AnalysisRunningState report={displayedReport} />
        ) : displayedReport.status === 'error' || displayedReport.status === 'cancelled' ? (
          <AnalysisFailureState
            report={displayedReport}
            onRetry={handleGenerate}
            onDelete={handleDelete}
            canRetry={aiEnabled}
          />
        ) : (
          <AnalysisReportView report={displayedReport} onSourceClick={onSourceClick} />
        )}
      </div>
    </div>
  );
}

function WorkspaceMessage({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className='text-base-content/50 flex h-full flex-col items-center justify-center gap-2 px-5 text-center'>
      {icon}
      <h3 className='text-base-content text-sm font-medium'>{title}</h3>
      {description && <p className='max-w-sm text-xs leading-5'>{description}</p>}
    </div>
  );
}

function AnalysisRunningState({ report }: { report: AIAnalysisReport }) {
  const _ = useTranslation();
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-5 text-center'>
      <Loader2Icon className='text-primary size-7 animate-spin' />
      <div>
        <h3 className='text-base-content text-sm font-medium'>
          {report.status === 'queued' ? _('Analysis queued') : _('Analyzing...')}
        </h3>
        <p className='text-base-content/50 mt-1 text-xs'>
          {report.kind === 'chapter'
            ? _('Reading the current chapter and preparing an evidence-grounded report.')
            : _('Searching the book index and preparing an evidence-grounded report.')}
        </p>
        <p className='text-base-content/40 mt-2 font-mono text-[10px]'>{report.model}</p>
      </div>
    </div>
  );
}

function AnalysisFailureState({
  report,
  onRetry,
  onDelete,
  canRetry,
}: {
  report: AIAnalysisReport;
  onRetry: () => void;
  onDelete: () => void;
  canRetry: boolean;
}) {
  const _ = useTranslation();
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-5 text-center'>
      <div className='bg-warning/10 rounded-full p-3'>
        <AlertTriangleIcon className='text-warning size-6' />
      </div>
      <div>
        <h3 className='text-base-content text-sm font-medium'>
          {report.status === 'cancelled' ? _('Analysis cancelled') : _('Analysis failed')}
        </h3>
        <p className='text-base-content/55 mt-1 max-h-32 overflow-y-auto text-xs leading-5'>
          {report.error || _('Unknown error')}
        </p>
      </div>
      <div className='flex items-center gap-2'>
        {canRetry && (
          <Button size='sm' variant='outline' className='h-8 text-xs' onClick={onRetry}>
            <RotateCwIcon className='size-3.5' />
            {_('Retry')}
          </Button>
        )}
        <Button size='sm' variant='ghost' className='h-8 text-xs' onClick={onDelete}>
          <Trash2Icon className='size-3.5' />
          {_('Delete analysis')}
        </Button>
      </div>
    </div>
  );
}

function AnalysisReportView({
  report,
  onSourceClick,
}: {
  report: AIAnalysisReport;
  onSourceClick?: (source: AIAnalysisSource) => void;
}) {
  const _ = useTranslation();
  return (
    <article className='flex flex-col gap-4' data-ai-analysis-report>
      <div className='text-base-content/45 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
        <span className='inline-flex items-center gap-1'>
          <Clock3Icon className='size-3' />
          {formatReportTime(report.updatedAt)}
        </span>
        <span className='font-mono'>{report.model}</span>
        {report.sources.length > 0 && (
          <span>{_('{{count}} sources', { count: report.sources.length })}</span>
        )}
      </div>

      {report.coverage && (
        <div className='border-primary/20 bg-primary/5 text-base-content/65 rounded-lg border px-3 py-2 text-xs leading-5'>
          <div className='text-base-content mb-0.5 font-medium'>{_('Evidence limits')}</div>
          {report.coverage}
        </div>
      )}

      <div className='prose prose-sm dark:prose-invert text-base-content max-w-none break-words'>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
      </div>

      {report.sources.length > 0 && (
        <section className='border-base-300/70 border-t pt-3'>
          <h3 className='text-base-content mb-2 text-xs font-semibold'>
            {_('Sources')} ({report.sources.length})
          </h3>
          <ul className='space-y-1.5'>
            {report.sources.map((source, index) => {
              const content = (
                <>
                  <div className='text-base-content/55 mb-1 flex items-center justify-between gap-2 text-[11px]'>
                    <span className='truncate'>
                      [S{index + 1}]{' '}
                      {source.chapterTitle ||
                        _('Section {{index}}', { index: source.sectionIndex + 1 })}
                    </span>
                    {source.pageNumber !== undefined && (
                      <span className='shrink-0'>
                        {_('Page {{page}}', { page: source.pageNumber })}
                      </span>
                    )}
                  </div>
                  <p className='text-base-content/70 line-clamp-3 text-xs leading-5'>
                    {source.text}
                  </p>
                </>
              );

              return (
                <li key={`${source.id}-${index}`}>
                  {source.cfi && onSourceClick ? (
                    <button
                      type='button'
                      onClick={() => onSourceClick(source)}
                      className='border-base-300 bg-base-100 hover:border-primary/40 hover:bg-base-200/60 w-full rounded-lg border p-2.5 text-left transition-colors'
                    >
                      {content}
                    </button>
                  ) : (
                    <div className='border-base-300 bg-base-100 rounded-lg border p-2.5'>
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
