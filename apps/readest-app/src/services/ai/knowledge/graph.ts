import type { BookKnowledge, KnowledgeRelationCategory } from './types';

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  chapters: number;
  aliases: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  category: KnowledgeRelationCategory;
  weight: number;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface GraphFilter {
  hiddenCategories?: KnowledgeRelationCategory[];
  minWeight?: number;
  minChapters?: number;
}

export function buildPeopleGraph(
  knowledge: BookKnowledge,
  filter: GraphFilter = {},
): KnowledgeGraphData {
  const hidden = new Set(filter.hiddenCategories ?? []);
  const minWeight = filter.minWeight ?? 1;
  const minChapters = filter.minChapters ?? 1;
  const people = knowledge.entities.filter((entity) => entity.type === 'person');
  const personIds = new Set(people.map((entity) => entity.id));

  const edges = knowledge.relations.filter(
    (relation) =>
      personIds.has(relation.source) &&
      personIds.has(relation.target) &&
      relation.weight >= minWeight &&
      !hidden.has(relation.category),
  );

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const nodes = people
    .filter((entity) => connected.has(entity.id) && entity.chapters.length >= minChapters)
    .map((entity) => ({
      id: entity.id,
      label: entity.name,
      chapters: entity.chapters.length,
      aliases: entity.aliases.length,
    }))
    .sort((a, b) => b.chapters - a.chapters || a.label.localeCompare(b.label));

  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        category: edge.category,
        weight: edge.weight,
      })),
  };
}

/** Undirected BFS shortest path between two graph nodes. */
export function findShortestPath(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  startId: string,
  endId: string,
): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(startId) || !nodeIds.has(endId)) return [];
  if (startId === endId) return [startId];

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const queue = [startId];
  const visited = new Set([startId]);
  const parent = new Map<string, string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);
      if (neighbor === endId) {
        const path = [endId];
        let cursor: string | undefined = endId;
        while (cursor && cursor !== startId) {
          cursor = parent.get(cursor);
          if (cursor) path.unshift(cursor);
        }
        return path;
      }
      queue.push(neighbor);
    }
  }
  return [];
}

export interface GraphPoint {
  x: number;
  y: number;
}

/**
 * Small deterministic Fruchterman-Reingold layout. The panel is narrow, so a
 * handful of iterations is enough to separate clusters without a dependency.
 */
export function layoutGraph(
  graph: KnowledgeGraphData,
  width: number,
  height: number,
  iterations = 120,
): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>();
  const count = graph.nodes.length;
  if (count === 0) return positions;
  if (count === 1) {
    positions.set(graph.nodes[0]!.id, { x: width / 2, y: height / 2 });
    return positions;
  }

  const padding = 18;
  const area = Math.max(1, (width - padding * 2) * (height - padding * 2));
  const idealDistance = Math.sqrt(area / count);
  const radius = Math.min(width, height) * 0.34;

  graph.nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    });
  });

  const ids = graph.nodes.map((node) => node.id);
  const edges = graph.edges
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .filter((edge) => positions.has(edge.source) && positions.has(edge.target));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const displacement = new Map<string, GraphPoint>(ids.map((id) => [id, { x: 0, y: 0 }]));

    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const a = positions.get(ids[left]!)!;
        const b = positions.get(ids[right]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = 0.01;
          dy = 0.01;
          distance = 0.014;
        }
        const force = (idealDistance * idealDistance) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const leftDisplacement = displacement.get(ids[left]!)!;
        const rightDisplacement = displacement.get(ids[right]!)!;
        leftDisplacement.x += fx;
        leftDisplacement.y += fy;
        rightDisplacement.x -= fx;
        rightDisplacement.y -= fy;
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.source)!;
      const b = positions.get(edge.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance * distance) / idealDistance;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      const sourceDisplacement = displacement.get(edge.source)!;
      const targetDisplacement = displacement.get(edge.target)!;
      sourceDisplacement.x -= fx;
      sourceDisplacement.y -= fy;
      targetDisplacement.x += fx;
      targetDisplacement.y += fy;
    }

    const temperature = Math.max(0.5, 12 * (1 - iteration / iterations));
    for (const id of ids) {
      const point = positions.get(id)!;
      const move = displacement.get(id)!;
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const step = Math.min(length, temperature) / length;
      point.x = Math.min(width - padding, Math.max(padding, point.x + move.x * step));
      point.y = Math.min(height - padding, Math.max(padding, point.y + move.y * step));
    }
  }

  return positions;
}

export function relationCategoryColor(category: KnowledgeRelationCategory): string {
  switch (category) {
    case 'family':
      return '#f59e0b';
    case 'intimate':
      return '#ec4899';
    case 'hierarchical':
      return '#8b5cf6';
    case 'social':
      return '#10b981';
    case 'hostile':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}
