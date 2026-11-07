'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRightIcon, CalendarClockIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import type { BookKnowledge, KnowledgeEvent } from '@/services/ai/knowledge/types';

interface KnowledgeTimelineProps {
  knowledge: BookKnowledge;
  onSelectEntity: (entityId: string) => void;
  onOpenEvent: (eventId: string) => void;
  onJump: (event: KnowledgeEvent) => void;
}

function eventColor(type: string): string {
  switch (type.toLowerCase()) {
    case '战斗':
    case 'battle':
    case 'conflict':
      return '#ef4444';
    case '成长':
    case 'growth':
      return '#3b82f6';
    case '社交':
    case 'social':
      return '#10b981';
    case '旅行':
    case 'travel':
      return '#f59e0b';
    case '物品':
    case 'item':
    case '物品交接':
      return '#eab308';
    case '组织':
    case 'org':
    case '组织变动':
      return '#ec4899';
    case '关系':
    case 'relationship':
    case '关系变化':
      return '#06b6d4';
    default:
      return '#6b7280';
  }
}

export function KnowledgeTimeline({
  knowledge,
  onSelectEntity,
  onOpenEvent,
  onJump,
}: KnowledgeTimelineProps) {
  const _ = useTranslation();
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [importance, setImportance] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of knowledge.events) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
  }, [knowledge.events]);

  const events = useMemo(
    () =>
      knowledge.events.filter(
        (event) =>
          !hiddenTypes.includes(event.type) &&
          (importance === 'all' || event.importance === importance),
      ),
    [hiddenTypes, importance, knowledge.events],
  );

  const entityName = (id: string) =>
    knowledge.entities.find((entity) => entity.id === id)?.name ?? id;

  const grouped = useMemo(() => {
    const map = new Map<number, KnowledgeEvent[]>();
    for (const event of events) {
      const list = map.get(event.chapterIndex) ?? [];
      list.push(event);
      map.set(event.chapterIndex, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [events]);

  if (knowledge.events.length === 0) {
    return (
      <div className='text-base-content/50 flex flex-col items-center gap-1 px-4 py-10 text-center text-xs'>
        <CalendarClockIcon className='size-5' />
        {_('No timeline events yet')}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2 p-2.5' data-knowledge-timeline>
      <div className='flex flex-wrap gap-1'>
        {types.map((type) => {
          const active = !hiddenTypes.includes(type);
          return (
            <button
              key={type}
              type='button'
              aria-pressed={active}
              onClick={() =>
                setHiddenTypes((current) =>
                  current.includes(type)
                    ? current.filter((item) => item !== type)
                    : [...current, type],
                )
              }
              className='border-base-300 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]'
              style={{ opacity: active ? 1 : 0.35 }}
            >
              <span
                className='inline-block size-1.5 rounded-full'
                style={{ backgroundColor: eventColor(type) }}
              />
              {type}
            </button>
          );
        })}
      </div>

      <select
        className='select select-bordered select-xs w-full'
        value={importance}
        onChange={(event) => setImportance(event.target.value as typeof importance)}
        aria-label={_('Importance')}
      >
        <option value='all'>{_('All importance levels')}</option>
        <option value='high'>{_('High')}</option>
        <option value='medium'>{_('Medium')}</option>
        <option value='low'>{_('Low')}</option>
      </select>

      <div className='flex flex-col gap-3'>
        {grouped.map(([chapterIndex, chapterEvents]) => (
          <div key={chapterIndex} className='flex flex-col gap-1.5'>
            <div className='text-base-content/50 text-[10px] font-medium uppercase tracking-wide'>
              {_('Chapter {{index}}', { index: chapterIndex + 1 })} ·{' '}
              {chapterEvents[0]?.chapterTitle}
            </div>
            {chapterEvents.map((event) => (
              <div
                key={event.id}
                className='border-base-300 bg-base-100 rounded-md border p-2 text-xs'
              >
                <div className='flex items-start gap-1.5'>
                  <span
                    className='mt-1 inline-block size-2 shrink-0 rounded-full'
                    style={{ backgroundColor: eventColor(event.type) }}
                  />
                  <div className='min-w-0 flex-1'>
                    <button
                      type='button'
                      onClick={() => onOpenEvent(event.id)}
                      className='text-base-content text-left leading-snug hover:underline'
                    >
                      {event.summary}
                    </button>
                    <div className='text-base-content/50 mt-1 flex flex-wrap items-center gap-1 text-[10px]'>
                      <span>{event.type}</span>
                      <span>·</span>
                      <span>
                        {_(
                          event.importance === 'high'
                            ? 'High'
                            : event.importance === 'low'
                              ? 'Low'
                              : 'Medium',
                        )}
                      </span>
                      {event.location ? (
                        <>
                          <span>·</span>
                          <button
                            type='button'
                            className='link link-hover'
                            onClick={() => onSelectEntity(event.location!)}
                          >
                            {entityName(event.location)}
                          </button>
                        </>
                      ) : null}
                    </div>
                    {event.participants.length > 0 ? (
                      <div className='mt-1 flex flex-wrap gap-1'>
                        {event.participants.map((participant) => (
                          <button
                            key={participant}
                            type='button'
                            onClick={() => onSelectEntity(participant)}
                            className='bg-base-200 text-base-content/75 hover:bg-base-300 rounded-full px-1.5 py-0.5 text-[10px]'
                          >
                            {entityName(participant)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {event.evidence[0] ? (
                      <blockquote className='border-base-300 text-base-content/60 mt-1.5 border-l-2 pl-2 text-[10px] italic'>
                        “{event.evidence[0].quote}”
                      </blockquote>
                    ) : null}
                  </div>
                  <button
                    type='button'
                    className='btn btn-ghost btn-xs shrink-0'
                    title={_('Open in book')}
                    aria-label={_('Open in book')}
                    onClick={() => onJump(event)}
                  >
                    <ArrowUpRightIcon className='size-3' />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {grouped.length === 0 ? (
          <div className='text-base-content/50 py-6 text-center text-xs'>
            {_('No events match these filters')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
