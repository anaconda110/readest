'use client';

import React, { useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import type {
  BookKnowledge,
  KnowledgeEntity,
  KnowledgeEntityType,
} from '@/services/ai/knowledge/types';

export const ENTITY_COLORS: Record<KnowledgeEntityType, string> = {
  person: '#3b82f6',
  location: '#10b981',
  item: '#f59e0b',
  org: '#8b5cf6',
  concept: '#6b7280',
};

export function entityTypeLabel(type: KnowledgeEntityType): string {
  switch (type) {
    case 'person':
      return 'People';
    case 'location':
      return 'Places';
    case 'item':
      return 'Items';
    case 'org':
      return 'Organizations';
    default:
      return 'Concepts';
  }
}

interface KnowledgeEntityListProps {
  knowledge: BookKnowledge;
  types: KnowledgeEntityType[];
  onSelectEntity: (entityId: string) => void;
  emptyLabel: string;
  showTypeFilter?: boolean;
}

export function KnowledgeEntityList({
  knowledge,
  types,
  onSelectEntity,
  emptyLabel,
  showTypeFilter = false,
}: KnowledgeEntityListProps) {
  const _ = useTranslation();
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<KnowledgeEntityType | 'all'>('all');

  const entities = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return knowledge.entities
      .filter((entity) => types.includes(entity.type))
      .filter((entity) => activeType === 'all' || entity.type === activeType)
      .filter((entity) => {
        if (!normalized) return true;
        return [entity.name, ...entity.aliases, entity.description]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalized);
      })
      .sort(
        (a, b) =>
          b.chapters.length - a.chapters.length ||
          a.firstChapter - b.firstChapter ||
          a.name.localeCompare(b.name),
      );
  }, [activeType, knowledge.entities, query, types]);

  return (
    <div className='flex flex-col gap-2 p-2.5' data-knowledge-entity-list>
      <div className='relative'>
        <SearchIcon className='text-base-content/40 pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2' />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={_('Search the knowledge base')}
          aria-label={_('Search the knowledge base')}
          className='h-8 pl-7 text-xs'
        />
      </div>

      {showTypeFilter && types.length > 1 ? (
        <div className='flex flex-wrap gap-1'>
          <TypeChip active={activeType === 'all'} onClick={() => setActiveType('all')}>
            {_('All')}
          </TypeChip>
          {types.map((type) => (
            <TypeChip
              key={type}
              active={activeType === type}
              color={ENTITY_COLORS[type]}
              onClick={() => setActiveType(type)}
            >
              {_(entityTypeLabel(type))}
            </TypeChip>
          ))}
        </div>
      ) : null}

      <div className='flex flex-col gap-1'>
        {entities.map((entity) => (
          <EntityRow key={entity.id} entity={entity} onClick={() => onSelectEntity(entity.id)} />
        ))}
        {entities.length === 0 ? (
          <div className='text-base-content/50 py-8 text-center text-xs'>
            {query ? _('No matches') : emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypeChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className='border-base-300 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]'
      style={{ opacity: active ? 1 : 0.4 }}
    >
      {color ? (
        <span className='inline-block size-1.5 rounded-full' style={{ backgroundColor: color }} />
      ) : null}
      {children}
    </button>
  );
}

function EntityRow({ entity, onClick }: { entity: KnowledgeEntity; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='border-base-300 bg-base-100 hover:bg-base-200/70 flex w-full items-start gap-2 rounded-md border p-2 text-left'
    >
      <span
        className='mt-1 inline-block size-2 shrink-0 rounded-full'
        style={{ backgroundColor: ENTITY_COLORS[entity.type] }}
      />
      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline gap-1.5'>
          <span className='text-base-content truncate text-xs font-medium'>{entity.name}</span>
          {entity.aliases.length > 0 ? (
            <span className='text-base-content/45 truncate text-[10px]'>
              {entity.aliases.slice(0, 2).join(' / ')}
            </span>
          ) : null}
        </span>
        {entity.description ? (
          <span className='text-base-content/60 mt-0.5 line-clamp-2 block text-[10px] leading-snug'>
            {entity.description}
          </span>
        ) : null}
      </span>
      <span className='text-base-content/40 shrink-0 text-[10px]'>{entity.chapters.length}</span>
    </button>
  );
}
