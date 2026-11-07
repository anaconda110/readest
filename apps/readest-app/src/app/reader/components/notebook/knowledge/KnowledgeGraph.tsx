'use client';

import { useMemo, useState } from 'react';
import { NetworkIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import {
  buildPeopleGraph,
  findShortestPath,
  layoutGraph,
  relationCategoryColor,
} from '@/services/ai/knowledge/graph';
import type { BookKnowledge, KnowledgeRelationCategory } from '@/services/ai/knowledge/types';

const CATEGORY_ORDER: KnowledgeRelationCategory[] = [
  'family',
  'intimate',
  'hierarchical',
  'social',
  'hostile',
  'other',
];

const GRAPH_WIDTH = 360;
const GRAPH_HEIGHT = 300;

interface KnowledgeGraphProps {
  knowledge: BookKnowledge;
  onSelectEntity: (entityId: string) => void;
}

export function KnowledgeGraph({ knowledge, onSelectEntity }: KnowledgeGraphProps) {
  const _ = useTranslation();
  const [hiddenCategories, setHiddenCategories] = useState<KnowledgeRelationCategory[]>([]);
  const [minWeight, setMinWeight] = useState(1);
  const [minChapters, setMinChapters] = useState(1);
  const [pathStart, setPathStart] = useState('');
  const [pathEnd, setPathEnd] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);

  const maxWeight = useMemo(
    () => knowledge.relations.reduce((max, relation) => Math.max(max, relation.weight), 1),
    [knowledge.relations],
  );
  const graph = useMemo(
    () =>
      buildPeopleGraph(knowledge, {
        hiddenCategories,
        minWeight: Math.min(minWeight, maxWeight),
        minChapters,
      }),
    [hiddenCategories, knowledge, maxWeight, minChapters, minWeight],
  );
  const positions = useMemo(() => layoutGraph(graph, GRAPH_WIDTH, GRAPH_HEIGHT), [graph]);
  const path = useMemo(
    () =>
      pathStart && pathEnd ? findShortestPath(graph.nodes, graph.edges, pathStart, pathEnd) : [],
    [graph.edges, graph.nodes, pathEnd, pathStart],
  );
  const pathNodes = new Set(path);
  const pathEdges = new Set<string>();
  for (let index = 0; index < path.length - 1; index += 1) {
    pathEdges.add(`${path[index]}\u0000${path[index + 1]}`);
    pathEdges.add(`${path[index + 1]}\u0000${path[index]}`);
  }

  const categoryLabel = (category: KnowledgeRelationCategory) => {
    switch (category) {
      case 'family':
        return _('Family');
      case 'intimate':
        return _('Intimate');
      case 'hierarchical':
        return _('Hierarchy');
      case 'social':
        return _('Social');
      case 'hostile':
        return _('Hostile');
      default:
        return _('Other');
    }
  };

  const toggleCategory = (category: KnowledgeRelationCategory) => {
    setHiddenCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  if (knowledge.relations.length === 0) {
    return <GraphEmpty title={_('No relationships yet')} />;
  }

  return (
    <div className='flex flex-col gap-2 p-2.5' data-knowledge-graph>
      <div className='flex flex-wrap gap-1'>
        {CATEGORY_ORDER.map((category) => {
          const active = !hiddenCategories.includes(category);
          return (
            <button
              key={category}
              type='button'
              aria-pressed={active}
              onClick={() => toggleCategory(category)}
              className='border-base-300 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-opacity'
              style={{ opacity: active ? 1 : 0.35 }}
            >
              <span
                className='inline-block size-1.5 rounded-full'
                style={{ backgroundColor: relationCategoryColor(category) }}
              />
              {categoryLabel(category)}
            </button>
          );
        })}
      </div>

      <div className='text-base-content/60 grid grid-cols-2 gap-2 text-[10px]'>
        <label className='flex flex-col gap-0.5'>
          <span>
            {_('Min relation weight: {{value}}', { value: Math.min(minWeight, maxWeight) })}
          </span>
          <input
            type='range'
            min={1}
            max={Math.max(1, maxWeight)}
            value={Math.min(minWeight, maxWeight)}
            onChange={(event) => setMinWeight(Number(event.target.value))}
            aria-label={_('Minimum relation weight')}
          />
        </label>
        <label className='flex flex-col gap-0.5'>
          <span>{_('Min chapters: {{value}}', { value: minChapters })}</span>
          <input
            type='range'
            min={1}
            max={Math.max(1, ...graph.nodes.map((node) => node.chapters), 1)}
            value={minChapters}
            onChange={(event) => setMinChapters(Number(event.target.value))}
            aria-label={_('Minimum chapters')}
          />
        </label>
      </div>

      {graph.nodes.length === 0 ? (
        <GraphEmpty title={_('No relationships match these filters')} />
      ) : (
        <svg
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          className='border-base-300 bg-base-200/30 h-auto w-full rounded-md border'
          role='img'
          aria-label={_('Character relationship graph')}
        >
          {graph.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return null;
            const highlighted = pathEdges.has(`${edge.source}\u0000${edge.target}`);
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={highlighted ? '#f97316' : relationCategoryColor(edge.category)}
                strokeWidth={highlighted ? 2.4 : Math.min(2, 0.6 + edge.weight * 0.35)}
                strokeOpacity={
                  highlighted ? 1 : hovered === edge.source || hovered === edge.target ? 0.85 : 0.35
                }
              />
            );
          })}
          {graph.nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const radius = 4 + Math.min(6, node.chapters * 0.6);
            const active = hovered === node.id || pathNodes.has(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
                role='button'
                tabIndex={0}
                aria-label={node.label}
                onClick={() => onSelectEntity(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectEntity(node.id);
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                className='cursor-pointer'
              >
                <circle
                  r={radius}
                  fill={active ? '#f97316' : '#3b82f6'}
                  fillOpacity={active ? 1 : 0.8}
                  stroke='#fff'
                  strokeWidth={1}
                />
                <text
                  y={radius + 9}
                  textAnchor='middle'
                  className='text-base-content text-[8px]'
                  style={{ pointerEvents: 'none', fill: 'currentColor' }}
                >
                  {node.label.length > 8 ? `${node.label.slice(0, 8)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      <div className='text-base-content/60 flex items-center gap-2 text-[10px]'>
        <NetworkIcon className='size-3' />
        <span>
          {_('{{nodes}} people · {{edges}} relations', {
            nodes: graph.nodes.length,
            edges: graph.edges.length,
          })}
        </span>
      </div>

      {graph.nodes.length >= 2 ? (
        <div className='flex flex-col gap-1'>
          <div className='text-base-content/60 text-[10px]'>
            {_('Find a path between two people')}
          </div>
          <div className='flex gap-1'>
            <select
              className='select select-bordered select-xs min-w-0 flex-1'
              value={pathStart}
              onChange={(event) => setPathStart(event.target.value)}
              aria-label={_('Path start')}
            >
              <option value=''>{_('Start')}</option>
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
            <select
              className='select select-bordered select-xs min-w-0 flex-1'
              value={pathEnd}
              onChange={(event) => setPathEnd(event.target.value)}
              aria-label={_('Path end')}
            >
              <option value=''>{_('End')}</option>
              {graph.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </select>
          </div>
          {pathStart && pathEnd ? (
            <div className='text-[10px]' aria-live='polite'>
              {path.length > 0
                ? path
                    .map((id) => graph.nodes.find((node) => node.id === id)?.label ?? id)
                    .join(' → ')
                : _('No path found')}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GraphEmpty({ title }: { title: string }) {
  return (
    <div className='text-base-content/50 flex flex-col items-center gap-1 px-4 py-10 text-center text-xs'>
      <NetworkIcon className='size-5' />
      {title}
    </div>
  );
}
