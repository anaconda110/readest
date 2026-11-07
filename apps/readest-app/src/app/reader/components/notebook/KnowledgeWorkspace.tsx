'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  BrainCircuitIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import i18n from '@/i18n/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookDoc } from '@/libs/document';
import type { AIAnalysisSource, AISettings } from '@/services/ai/types';
import {
  toAnalysisSource,
  type BookKnowledge,
  type KnowledgeEntityType,
  type KnowledgeEvent,
} from '@/services/ai/knowledge/types';
import { useKnowledgeStore } from '@/store/knowledgeStore';

import { AIAnalysisDisabledState } from './AIAnalysisPanel';
import { KnowledgeEntityDetail } from './knowledge/KnowledgeEntityDetail';
import { KnowledgeEntityList, ENTITY_COLORS } from './knowledge/KnowledgeEntityList';
import { KnowledgeGraph } from './knowledge/KnowledgeGraph';
import { KnowledgeLocations } from './knowledge/KnowledgeLocations';
import { KnowledgeTimeline } from './knowledge/KnowledgeTimeline';

const PEOPLE_TYPES: KnowledgeEntityType[] = ['person'];
const ENCYCLOPEDIA_TYPES: KnowledgeEntityType[] = ['concept', 'item', 'org'];

type KnowledgeTab = 'overview' | 'people' | 'graph' | 'timeline' | 'places' | 'encyclopedia';

export interface KnowledgeWorkspaceProps {
  aiSettings?: AISettings;
  bookDoc: BookDoc | null;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  sectionIndex: number;
  chapterTitle: string | null;
  onSourceClick?: (source: AIAnalysisSource) => void;
  onOpenSettings?: () => void;
}

export function KnowledgeWorkspace({
  aiSettings,
  bookDoc,
  bookHash,
  bookTitle,
  authorName,
  sectionIndex,
  chapterTitle,
  onSourceClick,
  onOpenSettings,
}: KnowledgeWorkspaceProps) {
  const _ = useTranslation();
  const knowledge = useKnowledgeStore((state) => state.knowledge[bookHash]);
  const chapterMap = useKnowledgeStore((state) => state.chapters[bookHash]);
  const run = useKnowledgeStore((state) => state.runs[bookHash]);
  const loaded = useKnowledgeStore((state) => state.loadedBooks[bookHash]);
  const loading = useKnowledgeStore((state) => state.loadingBooks[bookHash]);
  const loadBook = useKnowledgeStore((state) => state.loadBook);
  const analyze = useKnowledgeStore((state) => state.analyze);
  const cancel = useKnowledgeStore((state) => state.cancel);
  const clearBook = useKnowledgeStore((state) => state.clearBook);

  const [activeTab, setActiveTab] = useState<KnowledgeTab>('overview');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!bookHash) return;
    void loadBook(bookHash, bookTitle);
  }, [bookHash, bookTitle, loadBook]);

  useEffect(() => {
    if (run?.status !== 'running') setConfirmAll(false);
  }, [run?.status]);

  const totalChapters = bookDoc?.sections.length ?? 0;
  const analyzed = knowledge?.analyzedChapters ?? [];
  const analyzedSet = useMemo(() => new Set(analyzed), [analyzed]);
  const remaining = useMemo(
    () =>
      Array.from({ length: totalChapters }, (_, index) => index).filter(
        (index) => !analyzedSet.has(index),
      ),
    [analyzedSet, totalChapters],
  );
  const entityById = useMemo(
    () => new Map((knowledge?.entities ?? []).map((entity) => [entity.id, entity])),
    [knowledge?.entities],
  );

  const isRunning = run?.status === 'running';
  const currentChapterReady = Boolean(bookDoc?.sections[sectionIndex]);
  const aiEnabled = aiSettings?.enabled === true;

  const startAnalysis = useCallback(
    (indices: number[]) => {
      if (!aiSettings?.enabled || !bookDoc || indices.length === 0) return;
      analyze({
        bookHash,
        bookTitle,
        authorName,
        bookDoc,
        chapterIndices: indices,
        settings: aiSettings,
        language: i18n.resolvedLanguage || i18n.language || 'en',
      });
    },
    [aiSettings, analyze, authorName, bookDoc, bookHash, bookTitle],
  );

  const jumpTo = useCallback(
    (chapterIndex: number, title: string, quote: string) => {
      if (!onSourceClick) return;
      onSourceClick(
        toAnalysisSource(
          chapterIndex,
          title,
          quote,
          chapterMap?.[chapterIndex]?.cfi ?? bookDoc?.sections[chapterIndex]?.cfi,
        ),
      );
    },
    [bookDoc, chapterMap, onSourceClick],
  );

  const selectedEntity = selectedEntityId ? entityById.get(selectedEntityId) : undefined;
  const selectedEvent = selectedEventId
    ? knowledge?.events.find((event) => event.id === selectedEventId)
    : undefined;

  if (loading || (!loaded && bookHash)) {
    return (
      <WorkspaceMessage
        icon={<Loader2Icon className='size-5 animate-spin' />}
        title={_('Loading knowledge base...')}
      />
    );
  }

  if (!aiEnabled) {
    return <AIAnalysisDisabledState onOpenSettings={onOpenSettings} />;
  }

  if (!bookDoc) {
    return (
      <WorkspaceMessage
        icon={<BookOpenIcon className='size-6' />}
        title={_('Knowledge base unavailable')}
        description={_('Open the book and wait for it to finish loading before analyzing it.')}
      />
    );
  }

  if (selectedEntity) {
    return (
      <KnowledgeEntityDetail
        knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
        entity={selectedEntity}
        onBack={() => setSelectedEntityId(null)}
        onSelectEntity={setSelectedEntityId}
        onJump={jumpTo}
      />
    );
  }

  if (selectedEvent) {
    return (
      <EventDetail
        event={selectedEvent}
        knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
        onBack={() => setSelectedEventId(null)}
        onSelectEntity={setSelectedEntityId}
        onJump={jumpTo}
      />
    );
  }

  const tabs: { id: KnowledgeTab; label: string }[] = [
    { id: 'overview', label: _('Overview') },
    { id: 'people', label: _('People') },
    { id: 'graph', label: _('Graph') },
    { id: 'timeline', label: _('Timeline') },
    { id: 'places', label: _('Places') },
    { id: 'encyclopedia', label: _('Encyclopedia') },
  ];

  const progressPercent = run?.total ? Math.round((run.completed / run.total) * 100) : 0;

  return (
    <div className='flex h-full min-h-0 flex-col' data-knowledge-workspace>
      <div className='border-base-300/70 shrink-0 border-b px-3 py-2.5'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <div className='flex items-center gap-1.5'>
              <BrainCircuitIcon className='text-primary size-3.5 shrink-0' />
              <h2 className='text-base-content truncate text-sm font-semibold'>
                {_('Reading knowledge')}
              </h2>
            </div>
            <p className='text-base-content/50 truncate text-[11px]' title={bookTitle}>
              {bookTitle}
            </p>
          </div>
          <div className='text-base-content/50 shrink-0 text-[10px]'>
            {_('{{done}} / {{total}} chapters', { done: analyzed.length, total: totalChapters })}
          </div>
        </div>
        {isRunning ? (
          <div className='mt-2 flex items-center gap-2'>
            <progress
              className='progress progress-primary h-1.5 flex-1'
              value={run?.completed ?? 0}
              max={run?.total ?? 1}
            />
            <span className='text-base-content/50 text-[10px]'>{progressPercent}%</span>
            <Button
              size='sm'
              variant='outline'
              className='h-6 px-2 text-[10px]'
              onClick={() => cancel(bookHash)}
            >
              <XIcon className='size-3' />
              {_('Cancel')}
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className='border-base-300/70 flex shrink-0 gap-0.5 overflow-x-auto border-b p-1'
        role='tablist'
        aria-label={_('Reading knowledge')}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'min-h-7 shrink-0 rounded-md px-2 text-[11px] transition-colors',
              activeTab === tab.id
                ? 'bg-base-100 text-base-content shadow-xs'
                : 'text-base-content/60 hover:bg-base-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {activeTab === 'overview' ? (
          <Overview
            knowledge={knowledge}
            run={run}
            analyzedCount={analyzed.length}
            totalChapters={totalChapters}
            remainingCount={remaining.length}
            isRunning={isRunning}
            currentChapterReady={currentChapterReady}
            chapterTitle={chapterTitle}
            sectionIndex={sectionIndex}
            confirmAll={confirmAll}
            confirmClear={confirmClear}
            onAnalyzeCurrent={() => startAnalysis([sectionIndex])}
            onAnalyzeAll={() => {
              if (!confirmAll && totalChapters > 20) {
                setConfirmAll(true);
                return;
              }
              setConfirmAll(false);
              startAnalysis(Array.from({ length: totalChapters }, (_, index) => index));
            }}
            onAnalyzeRemaining={() => startAnalysis(remaining)}
            onCancel={() => cancel(bookHash)}
            onClear={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setConfirmClear(false);
              void clearBook(bookHash);
            }}
            onSelectEntity={setSelectedEntityId}
            onSelectEvent={setSelectedEventId}
          />
        ) : null}

        {activeTab === 'people' ? (
          <KnowledgeEntityList
            knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
            types={PEOPLE_TYPES}
            onSelectEntity={setSelectedEntityId}
            emptyLabel={_('Analyze a chapter to discover people')}
          />
        ) : null}

        {activeTab === 'graph' ? (
          <KnowledgeGraph
            knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
            onSelectEntity={setSelectedEntityId}
          />
        ) : null}

        {activeTab === 'timeline' ? (
          <KnowledgeTimeline
            knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
            onSelectEntity={setSelectedEntityId}
            onOpenEvent={setSelectedEventId}
            onJump={(event) =>
              jumpTo(
                event.chapterIndex,
                event.chapterTitle,
                event.evidence[0]?.quote ?? event.summary,
              )
            }
          />
        ) : null}

        {activeTab === 'places' ? (
          <KnowledgeLocations
            knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
            onSelectEntity={setSelectedEntityId}
          />
        ) : null}

        {activeTab === 'encyclopedia' ? (
          <KnowledgeEntityList
            knowledge={knowledge ?? emptyKnowledge(bookHash, bookTitle)}
            types={ENCYCLOPEDIA_TYPES}
            onSelectEntity={setSelectedEntityId}
            emptyLabel={_('Analyze a chapter to discover concepts and items')}
            showTypeFilter
          />
        ) : null}
      </div>
    </div>
  );
}

function Overview({
  knowledge,
  run,
  analyzedCount,
  totalChapters,
  remainingCount,
  isRunning,
  currentChapterReady,
  chapterTitle,
  sectionIndex,
  confirmAll,
  confirmClear,
  onAnalyzeCurrent,
  onAnalyzeAll,
  onAnalyzeRemaining,
  onCancel,
  onClear,
  onSelectEntity,
  onSelectEvent,
}: {
  knowledge?: BookKnowledge;
  run?: { status: string; error?: string; completed: number; total: number };
  analyzedCount: number;
  totalChapters: number;
  remainingCount: number;
  isRunning: boolean;
  currentChapterReady: boolean;
  chapterTitle: string | null;
  sectionIndex: number;
  confirmAll: boolean;
  confirmClear: boolean;
  onAnalyzeCurrent: () => void;
  onAnalyzeAll: () => void;
  onAnalyzeRemaining: () => void;
  onCancel: () => void;
  onClear: () => void;
  onSelectEntity: (entityId: string) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const _ = useTranslation();
  const stats = knowledge?.stats;
  const people = (knowledge?.entities ?? [])
    .filter((entity) => entity.type === 'person')
    .sort((a, b) => b.chapters.length - a.chapters.length)
    .slice(0, 6);
  const recentEvents = [...(knowledge?.events ?? [])].slice(-5).reverse();

  return (
    <div className='flex flex-col gap-3 p-2.5' data-knowledge-overview>
      <div className='grid grid-cols-4 gap-1.5'>
        <Stat label={_('People')} value={stats?.people ?? 0} color={ENTITY_COLORS.person} />
        <Stat label={_('Places')} value={stats?.locations ?? 0} color={ENTITY_COLORS.location} />
        <Stat label={_('Items')} value={stats?.items ?? 0} color={ENTITY_COLORS.item} />
        <Stat label={_('Orgs')} value={stats?.orgs ?? 0} color={ENTITY_COLORS.org} />
        <Stat label={_('Concepts')} value={stats?.concepts ?? 0} color={ENTITY_COLORS.concept} />
        <Stat label={_('Relations')} value={stats?.relations ?? 0} color='#0ea5e9' />
        <Stat label={_('Events')} value={stats?.events ?? 0} color='#f97316' />
        <Stat
          label={_('Coverage')}
          value={totalChapters ? `${Math.round((analyzedCount / totalChapters) * 100)}%` : '0%'}
          color='#22c55e'
        />
      </div>

      {run?.status === 'error' && run.error ? (
        <div className='alert alert-error alert-soft items-start gap-1.5 px-2 py-1.5 text-[11px]'>
          <AlertTriangleIcon className='size-3.5 shrink-0' />
          <span className='min-w-0 break-words'>{run.error}</span>
        </div>
      ) : null}

      <div className='flex flex-col gap-1.5'>
        <div className='flex flex-wrap gap-1.5'>
          <Button
            size='sm'
            className='h-7 px-2 text-[11px]'
            disabled={!currentChapterReady || isRunning}
            onClick={onAnalyzeCurrent}
          >
            <SparklesIcon className='size-3' />
            {_('Analyze this chapter')}
          </Button>
          {remainingCount > 0 ? (
            <Button
              size='sm'
              variant='outline'
              className='h-7 px-2 text-[11px]'
              disabled={isRunning}
              onClick={onAnalyzeAll}
            >
              <PlayIcon className='size-3' />
              {confirmAll
                ? _('Confirm analyzing all {{count}} chapters', { count: totalChapters })
                : _('Analyze the whole book')}
            </Button>
          ) : null}
          {analyzedCount > 0 && remainingCount > 0 && remainingCount < totalChapters ? (
            <Button
              size='sm'
              variant='outline'
              className='h-7 px-2 text-[11px]'
              disabled={isRunning}
              onClick={onAnalyzeRemaining}
            >
              <PlayIcon className='size-3' />
              {_('Analyze {{count}} remaining', { count: remainingCount })}
            </Button>
          ) : null}
          {isRunning ? (
            <Button size='sm' variant='outline' className='h-7 px-2 text-[11px]' onClick={onCancel}>
              <XIcon className='size-3' />
              {_('Cancel')}
            </Button>
          ) : null}
          {analyzedCount > 0 ? (
            <Button
              size='sm'
              variant='ghost'
              className='text-error h-7 px-2 text-[11px]'
              disabled={isRunning}
              onClick={onClear}
            >
              <Trash2Icon className='size-3' />
              {confirmClear ? _('Confirm clearing all knowledge') : _('Clear')}
            </Button>
          ) : null}
        </div>
        <p className='text-base-content/45 text-[10px] leading-snug'>
          {_(
            'Each chapter needs one AI extraction call. Facts stay in this device and every item keeps its evidence quote.',
          )}
        </p>
        {chapterTitle ? (
          <p className='text-base-content/45 truncate text-[10px]' title={chapterTitle}>
            {_('Current chapter')}: {chapterTitle}
          </p>
        ) : (
          <p className='text-base-content/45 text-[10px]'>
            {_('Navigate to chapter {{index}}', { index: sectionIndex + 1 })}
          </p>
        )}
      </div>

      {people.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='text-base-content/60 text-[10px] font-semibold uppercase tracking-wide'>
            {_('Main people')}
          </h4>
          <div className='flex flex-wrap gap-1'>
            {people.map((person) => (
              <button
                key={person.id}
                type='button'
                onClick={() => onSelectEntity(person.id)}
                className='bg-base-200 hover:bg-base-300 rounded-full px-2 py-0.5 text-[11px]'
              >
                {person.name} · {person.chapters.length}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recentEvents.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='text-base-content/60 text-[10px] font-semibold uppercase tracking-wide'>
            {_('Recent events')}
          </h4>
          {recentEvents.map((event) => (
            <button
              key={event.id}
              type='button'
              onClick={() => onSelectEvent(event.id)}
              className='border-base-300 bg-base-100 hover:bg-base-200/70 rounded-md border px-2 py-1.5 text-left'
            >
              <span className='text-base-content/75 line-clamp-2 text-[11px] leading-snug'>
                {event.summary}
              </span>
              <span className='text-base-content/40 mt-0.5 block text-[10px]'>
                {_('Chapter {{index}}', { index: event.chapterIndex + 1 })} · {event.type}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      {analyzedCount === 0 && !isRunning ? (
        <div className='border-base-300 text-base-content/60 rounded-md border border-dashed px-3 py-4 text-center text-[11px] leading-relaxed'>
          {_(
            'Analyze a chapter to build people, relationships, places, items, concepts and a timeline.',
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className='border-base-300 bg-base-100 rounded-md border px-1.5 py-1'>
      <div className='text-base-content/45 truncate text-[9px]'>{label}</div>
      <div className='flex items-center gap-1'>
        <span className='inline-block size-1.5 rounded-full' style={{ backgroundColor: color }} />
        <span className='text-base-content text-xs font-semibold'>{value}</span>
      </div>
    </div>
  );
}

function EventDetail({
  event,
  knowledge,
  onBack,
  onSelectEntity,
  onJump,
}: {
  event: KnowledgeEvent;
  knowledge: BookKnowledge;
  onBack: () => void;
  onSelectEntity: (entityId: string) => void;
  onJump: (chapterIndex: number, chapterTitle: string, quote: string) => void;
}) {
  const _ = useTranslation();
  const entityById = new Map(knowledge.entities.map((entity) => [entity.id, entity]));
  const placeId = event.location;
  return (
    <div className='flex flex-col gap-3 p-2.5' data-knowledge-event-detail>
      <button
        type='button'
        onClick={onBack}
        className='text-base-content/60 hover:text-base-content inline-flex items-center gap-1 self-start text-[11px]'
      >
        <ArrowLeftIcon className='size-3' />
        {_('Back')}
      </button>
      <div>
        <div className='text-base-content/45 text-[10px]'>
          {_('Chapter {{index}}', { index: event.chapterIndex + 1 })} · {event.chapterTitle}
        </div>
        <p className='text-base-content mt-1 text-xs leading-relaxed'>{event.summary}</p>
        <div className='text-base-content/50 mt-1 flex flex-wrap items-center gap-1 text-[10px]'>
          <span>{event.type}</span>
          <span>·</span>
          <span>
            {_(
              event.importance === 'high' ? 'High' : event.importance === 'low' ? 'Low' : 'Medium',
            )}
          </span>
        </div>
      </div>
      {event.participants.length > 0 ? (
        <div className='flex flex-wrap gap-1'>
          {event.participants.map((participant) => (
            <button
              key={participant}
              type='button'
              onClick={() => onSelectEntity(participant)}
              className='bg-base-200 hover:bg-base-300 rounded-full px-2 py-0.5 text-[10px]'
            >
              {entityById.get(participant)?.name ?? participant}
            </button>
          ))}
        </div>
      ) : null}
      {placeId ? (
        <button
          type='button'
          onClick={() => onSelectEntity(placeId)}
          className='text-primary self-start text-[10px] hover:underline'
        >
          {_('Place')}: {entityById.get(placeId)?.name ?? placeId}
        </button>
      ) : null}
      {event.evidence[0] ? (
        <div>
          <blockquote className='border-base-300 text-base-content/65 border-l-2 pl-2 text-[10px] italic leading-snug'>
            “{event.evidence[0].quote}”
          </blockquote>
          <button
            type='button'
            onClick={() => onJump(event.chapterIndex, event.chapterTitle, event.evidence[0]!.quote)}
            className='text-primary mt-1 inline-flex items-center gap-1 text-[10px] hover:underline'
          >
            <ExternalLinkIcon className='size-3' />
            {_('Open in book')}
          </button>
        </div>
      ) : null}
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
    <div className='text-base-content/60 flex h-full flex-col items-center justify-center gap-2 px-5 text-center'>
      {icon}
      <p className='text-base-content text-xs font-medium'>{title}</p>
      {description ? <p className='text-[11px] leading-relaxed'>{description}</p> : null}
    </div>
  );
}

function emptyKnowledge(bookHash: string, bookTitle: string): BookKnowledge {
  return {
    bookHash,
    bookTitle,
    updatedAt: 0,
    analyzedChapters: [],
    entities: [],
    relations: [],
    events: [],
    stats: { people: 0, locations: 0, items: 0, orgs: 0, concepts: 0, relations: 0, events: 0 },
  };
}
