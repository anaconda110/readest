import { describe, expect, it } from 'vitest';

import { aggregateKnowledge } from '@/services/ai/knowledge/aggregate';
import { buildPeopleGraph, findShortestPath, layoutGraph } from '@/services/ai/knowledge/graph';
import type { ChapterKnowledge } from '@/services/ai/knowledge/types';

const chapter: ChapterKnowledge = {
  bookHash: 'book',
  chapterIndex: 0,
  chapterTitle: 'One',
  model: 'test',
  truncated: false,
  createdAt: 0,
  updatedAt: 0,
  people: [
    { name: '甲', aliases: [], description: '' },
    { name: '乙', aliases: [], description: '' },
    { name: '丙', aliases: [], description: '' },
  ],
  locations: [],
  items: [],
  orgs: [],
  concepts: [],
  relations: [
    { source: '甲', target: '乙', type: '朋友', evidence: '甲乙为友' },
    { source: '乙', target: '丙', type: '师徒', evidence: '乙收丙为徒' },
    { source: '甲', target: '丙', type: '敌对', evidence: '甲丙为敌' },
  ],
  events: [],
};

const knowledge = aggregateKnowledge([chapter], '测试');

describe('buildPeopleGraph', () => {
  it('builds a connected people graph', () => {
    const graph = buildPeopleGraph(knowledge);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
  });

  it('hides categories and low-weight edges', () => {
    const graph = buildPeopleGraph(knowledge, {
      hiddenCategories: ['hostile'],
    });
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.some((edge) => edge.category === 'hostile')).toBe(false);

    const heavy = buildPeopleGraph(knowledge, { minWeight: 2 });
    expect(heavy.edges).toHaveLength(0);
    expect(heavy.nodes).toHaveLength(0);
  });
});

describe('findShortestPath', () => {
  it('finds the shortest undirected path', () => {
    const graph = buildPeopleGraph(knowledge);
    const path = findShortestPath(graph.nodes, graph.edges, 'person:甲', 'person:丙');
    expect(path[0]).toBe('person:甲');
    expect(path[path.length - 1]).toBe('person:丙');
    expect(path).toHaveLength(2);
  });

  it('returns an empty path for unknown nodes', () => {
    const graph = buildPeopleGraph(knowledge);
    expect(findShortestPath(graph.nodes, graph.edges, 'person:甲', 'person:无')).toEqual([]);
  });
});

describe('layoutGraph', () => {
  it('is deterministic and stays inside the viewport', () => {
    const graph = buildPeopleGraph(knowledge);
    const first = layoutGraph(graph, 360, 300, 30);
    const second = layoutGraph(graph, 360, 300, 30);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(360);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });
});
