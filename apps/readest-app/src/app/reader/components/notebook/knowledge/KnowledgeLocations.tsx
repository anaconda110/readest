'use client';

import { useMemo } from 'react';
import { MapIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import type { BookKnowledge, KnowledgeEntity } from '@/services/ai/knowledge/types';

import { ENTITY_COLORS } from './KnowledgeEntityList';

interface KnowledgeLocationsProps {
  knowledge: BookKnowledge;
  onSelectEntity: (entityId: string) => void;
}

export function KnowledgeLocations({ knowledge, onSelectEntity }: KnowledgeLocationsProps) {
  const _ = useTranslation();
  const locations = useMemo(
    () =>
      knowledge.entities
        .filter((entity) => entity.type === 'location')
        .sort(
          (a, b) =>
            b.chapters.length - a.chapters.length ||
            a.firstChapter - b.firstChapter ||
            a.name.localeCompare(b.name),
        ),
    [knowledge.entities],
  );
  const byId = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const children = useMemo(() => {
    const map = new Map<string, KnowledgeEntity[]>();
    for (const location of locations) {
      const parentId = location.parent && byId.has(location.parent) ? location.parent : '';
      const list = map.get(parentId) ?? [];
      list.push(location);
      map.set(parentId, list);
    }
    return map;
  }, [byId, locations]);

  if (locations.length === 0) {
    return (
      <div className='text-base-content/50 flex flex-col items-center gap-1 px-4 py-10 text-center text-xs'>
        <MapIcon className='size-5' />
        {_('No places yet')}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-1 p-2.5' data-knowledge-locations>
      {(children.get('')?.length ? children.get('')! : locations).map((location) => (
        <LocationNode
          key={location.id}
          location={location}
          childrenByParent={children}
          onSelectEntity={onSelectEntity}
          depth={0}
          visited={new Set()}
        />
      ))}
    </div>
  );
}

function LocationNode({
  location,
  childrenByParent,
  onSelectEntity,
  depth,
  visited,
}: {
  location: KnowledgeEntity;
  childrenByParent: Map<string, KnowledgeEntity[]>;
  onSelectEntity: (entityId: string) => void;
  depth: number;
  visited: Set<string>;
}) {
  const _ = useTranslation();
  if (visited.has(location.id) || depth > 6) return null;
  const nextVisited = new Set(visited).add(location.id);
  const nested = childrenByParent.get(location.id) ?? [];
  return (
    <div>
      <button
        type='button'
        onClick={() => onSelectEntity(location.id)}
        className='hover:bg-base-200/70 flex w-full items-start gap-1.5 rounded-md px-1 py-1 text-left'
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span
          className='mt-1 inline-block size-1.5 shrink-0 rounded-full'
          style={{ backgroundColor: ENTITY_COLORS.location }}
        />
        <span className='min-w-0 flex-1'>
          <span className='text-base-content block truncate text-xs'>{location.name}</span>
          <span className='text-base-content/45 block truncate text-[10px]'>
            {location.category ? `${location.category} · ` : ''}
            {_('{{count}} chapters', { count: location.chapters.length })}
          </span>
        </span>
      </button>
      {nested.map((child) => (
        <LocationNode
          key={child.id}
          location={child}
          childrenByParent={childrenByParent}
          onSelectEntity={onSelectEntity}
          depth={depth + 1}
          visited={nextVisited}
        />
      ))}
    </div>
  );
}
