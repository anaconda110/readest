'use client';

import { ArrowLeftIcon, ExternalLinkIcon, MapPinIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import type { BookKnowledge, KnowledgeEntity } from '@/services/ai/knowledge/types';

import { ENTITY_COLORS, entityTypeLabel } from './KnowledgeEntityList';

interface KnowledgeEntityDetailProps {
  knowledge: BookKnowledge;
  entity: KnowledgeEntity;
  onBack: () => void;
  onSelectEntity: (entityId: string) => void;
  onJump: (chapterIndex: number, chapterTitle: string, quote: string) => void;
}

export function KnowledgeEntityDetail({
  knowledge,
  entity,
  onBack,
  onSelectEntity,
  onJump,
}: KnowledgeEntityDetailProps) {
  const _ = useTranslation();
  const entityById = new Map(knowledge.entities.map((item) => [item.id, item]));
  const relations = knowledge.relations
    .filter((relation) => relation.source === entity.id || relation.target === entity.id)
    .sort((a, b) => b.weight - a.weight);
  const events = knowledge.events.filter((event) => event.participants.includes(entity.id));
  const parent = entity.parent ? entityById.get(entity.parent) : undefined;

  return (
    <div className='flex flex-col gap-3 p-2.5' data-knowledge-entity-detail>
      <button
        type='button'
        onClick={onBack}
        className='text-base-content/60 hover:text-base-content inline-flex items-center gap-1 self-start text-[11px]'
      >
        <ArrowLeftIcon className='size-3' />
        {_('Back')}
      </button>

      <div>
        <div className='flex items-center gap-1.5'>
          <span
            className='inline-block size-2 rounded-full'
            style={{ backgroundColor: ENTITY_COLORS[entity.type] }}
          />
          <h3 className='text-base-content truncate text-sm font-semibold'>{entity.name}</h3>
          <span className='bg-base-200 text-base-content/60 rounded-full px-1.5 py-0.5 text-[10px]'>
            {_(entityTypeLabel(entity.type))}
          </span>
        </div>
        {entity.aliases.length > 0 ? (
          <p className='text-base-content/50 mt-1 text-[10px]'>
            {_('Also known as')}: {entity.aliases.join(' / ')}
          </p>
        ) : null}
        {entity.category ? (
          <p className='text-base-content/50 mt-0.5 text-[10px]'>{entity.category}</p>
        ) : null}
        {entity.description ? (
          <p className='text-base-content/75 mt-2 text-xs leading-relaxed'>{entity.description}</p>
        ) : null}
        {parent ? (
          <button
            type='button'
            onClick={() => onSelectEntity(parent.id)}
            className='text-base-content/60 hover:text-base-content mt-2 inline-flex items-center gap-1 text-[10px]'
          >
            <MapPinIcon className='size-3' />
            {_('Located in')} {parent.name}
          </button>
        ) : null}
      </div>

      <div className='text-base-content/50 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]'>
        <span>{_('{{count}} chapters', { count: entity.chapters.length })}</span>
        <span>{_('First appears in chapter {{index}}', { index: entity.firstChapter + 1 })}</span>
        <span>{_('{{count}} relations', { count: relations.length })}</span>
      </div>

      {relations.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='text-base-content/60 text-[10px] font-semibold uppercase tracking-wide'>
            {_('Relationships')}
          </h4>
          {relations.map((relation) => {
            const otherId = relation.source === entity.id ? relation.target : relation.source;
            const other = entityById.get(otherId);
            return (
              <div
                key={relation.id}
                className='border-base-300 bg-base-100 flex items-center gap-1.5 rounded-md border px-2 py-1.5'
              >
                <span className='text-base-content/70 shrink-0 text-[10px]'>{relation.type}</span>
                <button
                  type='button'
                  onClick={() => onSelectEntity(otherId)}
                  className='text-primary min-w-0 flex-1 truncate text-left text-xs hover:underline'
                >
                  {other?.name ?? otherId}
                </button>
                <span className='text-base-content/40 shrink-0 text-[10px]'>
                  ×{relation.weight}
                </span>
              </div>
            );
          })}
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='text-base-content/60 text-[10px] font-semibold uppercase tracking-wide'>
            {_('Key events')}
          </h4>
          {events.slice(0, 8).map((event) => (
            <div
              key={event.id}
              className='border-base-300 bg-base-100 rounded-md border px-2 py-1.5'
            >
              <p className='text-base-content/75 text-[11px] leading-snug'>{event.summary}</p>
              <p className='text-base-content/40 mt-0.5 text-[10px]'>
                {_('Chapter {{index}}', { index: event.chapterIndex + 1 })}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      {entity.evidence.length > 0 ? (
        <section className='flex flex-col gap-1'>
          <h4 className='text-base-content/60 text-[10px] font-semibold uppercase tracking-wide'>
            {_('Textual evidence')}
          </h4>
          {entity.evidence.map((evidence) => (
            <div key={`${evidence.chapterIndex}-${evidence.quote}`} className='group'>
              <blockquote className='border-base-300 text-base-content/65 border-l-2 pl-2 text-[10px] italic leading-snug'>
                “{evidence.quote}”
              </blockquote>
              <button
                type='button'
                onClick={() => onJump(evidence.chapterIndex, evidence.chapterTitle, evidence.quote)}
                className='text-primary mt-0.5 inline-flex items-center gap-1 text-[10px] hover:underline'
              >
                <ExternalLinkIcon className='size-3' />
                {_('Chapter {{index}}', { index: evidence.chapterIndex + 1 })}
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
