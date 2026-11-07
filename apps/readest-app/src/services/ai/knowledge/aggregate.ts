import { knowledgeNameKey, normalizeKnowledgeName } from './schema';
import type {
  BookKnowledge,
  ChapterKnowledge,
  KnowledgeEntity,
  KnowledgeEntityType,
  KnowledgeEvent,
  KnowledgeMention,
  KnowledgeRelation,
  KnowledgeRelationCategory,
} from './types';

const ENTITY_ORDER: KnowledgeEntityType[] = ['person', 'location', 'org', 'item', 'concept'];
const MAX_DESCRIPTION = 600;
const MAX_EVIDENCE_PER_ENTITY = 4;
const MAX_EVIDENCE_PER_RELATION = 5;

interface EntitySeed {
  type: KnowledgeEntityType;
  name: string;
  aliases: string[];
  description: string;
  category?: string;
  parentName?: string;
  chapterIndex: number;
}

interface EntityGroup {
  type: KnowledgeEntityType;
  seeds: EntitySeed[];
  names: Map<string, { name: string; count: number }>;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[index] !== root) {
      const next = this.parent[index]!;
      this.parent[index] = root;
      index = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function mentionGroups(chapter: ChapterKnowledge) {
  return [
    ['person', chapter.people],
    ['location', chapter.locations],
    ['item', chapter.items],
    ['org', chapter.orgs],
    ['concept', chapter.concepts],
  ] as const;
}

function chooseCanonicalName(group: EntityGroup): string {
  const entries = Array.from(group.names.values());
  entries.sort(
    (a, b) => b.count - a.count || b.name.length - a.name.length || a.name.localeCompare(b.name),
  );
  return entries[0]?.name ?? group.seeds[0]?.name ?? 'unknown';
}

function uniqueAliases(group: EntityGroup, canonical: string): string[] {
  const canonicalKey = knowledgeNameKey(canonical);
  const aliases = Array.from(group.names.values())
    .filter((entry) => knowledgeNameKey(entry.name) !== canonicalKey)
    .sort((a, b) => b.count - a.count || b.name.length - a.name.length)
    .map((entry) => entry.name);
  return Array.from(new Set(aliases)).slice(0, 20);
}

function buildEntities(chapters: ChapterKnowledge[]): KnowledgeEntity[] {
  const seeds: EntitySeed[] = [];
  for (const chapter of chapters) {
    for (const [type, mentions] of mentionGroups(chapter)) {
      for (const mention of mentions as KnowledgeMention[]) {
        const name = normalizeKnowledgeName(mention.name);
        if (!name) continue;
        seeds.push({
          type,
          name,
          aliases: mention.aliases.map(normalizeKnowledgeName).filter(Boolean),
          description: mention.description.trim(),
          category: mention.category,
          parentName: mention.parent,
          chapterIndex: chapter.chapterIndex,
        });
      }
    }
  }
  if (seeds.length === 0) return [];

  const unionFind = new UnionFind(seeds.length);
  const owner = new Map<string, number>();
  seeds.forEach((seed, index) => {
    const keys = [seed.name, ...seed.aliases].map(
      (name) => `${seed.type}:${knowledgeNameKey(name)}`,
    );
    for (const key of keys) {
      const previous = owner.get(key);
      if (previous === undefined) {
        owner.set(key, index);
      } else {
        unionFind.union(previous, index);
      }
    }
  });

  const grouped = new Map<number, EntityGroup>();
  seeds.forEach((seed, index) => {
    const root = unionFind.find(index);
    let group = grouped.get(root);
    if (!group) {
      group = { type: seed.type, seeds: [], names: new Map() };
      grouped.set(root, group);
    }
    group.seeds.push(seed);
    for (const name of [seed.name, ...seed.aliases]) {
      const key = knowledgeNameKey(name);
      const existing = group.names.get(key);
      if (existing) existing.count += name === seed.name ? 1 : 0;
      else group.names.set(key, { name, count: name === seed.name ? 1 : 0 });
    }
  });

  return Array.from(grouped.values()).map((group) => {
    const canonical = chooseCanonicalName(group);
    const chaptersForEntity = Array.from(
      new Set(group.seeds.map((seed) => seed.chapterIndex)),
    ).sort((a, b) => a - b);
    const description = group.seeds
      .map((seed) => seed.description)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];
    const category = group.seeds.map((seed) => seed.category).find(Boolean);
    const parentName = group.seeds.map((seed) => seed.parentName).find(Boolean);
    return {
      id: `${group.type}:${canonical}`,
      type: group.type,
      name: canonical,
      aliases: uniqueAliases(group, canonical),
      description: description ? description.slice(0, MAX_DESCRIPTION) : '',
      category,
      parent: parentName,
      firstChapter: chaptersForEntity[0] ?? 0,
      chapters: chaptersForEntity,
      evidence: [],
    } satisfies KnowledgeEntity;
  });
}

const INTIMATE_TERMS = [
  '夫妻',
  '恋人',
  '情侣',
  '情人',
  '伴侣',
  '爱慕',
  '求亲',
  '逼婚',
  '未婚夫',
  '未婚妻',
  '前夫',
  '前妻',
];
const SOCIAL_TERMS = [
  '结拜',
  '师兄弟',
  '师姐妹',
  '同门',
  '朋友',
  '好友',
  '同事',
  '同学',
  '邻居',
  '盟友',
  '伙伴',
  '同伴',
  '合作',
  '同僚',
];
const HIERARCHICAL_TERMS = [
  '师徒',
  '师父',
  '师傅',
  '徒弟',
  '主仆',
  '君臣',
  '上下级',
  '上司',
  '下属',
  '师生',
  '领导',
  '老板',
  '主人',
  '仆人',
  '属下',
];
const HOSTILE_TERMS = ['敌对', '仇', '敌人', '对手', '竞争', '对立', '宿敌'];
const FAMILY_TERMS = [
  '父子',
  '父女',
  '母子',
  '母女',
  '兄弟',
  '兄妹',
  '姐弟',
  '姐妹',
  '叔侄',
  '祖孙',
  '亲属',
  '亲戚',
  '父子关系',
  '养父',
  '养母',
  '继父',
  '继母',
];

export function classifyRelationType(type: string): KnowledgeRelationCategory {
  const value = type.toLowerCase();
  const has = (terms: string[]) => terms.some((term) => value.includes(term.toLowerCase()));
  if (has(INTIMATE_TERMS)) return 'intimate';
  if (has(SOCIAL_TERMS)) return 'social';
  if (has(HIERARCHICAL_TERMS)) return 'hierarchical';
  if (has(HOSTILE_TERMS)) return 'hostile';
  if (has(FAMILY_TERMS)) return 'family';
  if (/父|母|兄|弟|姐|妹|叔|侄|祖|孙|舅|姨|姑/.test(value)) return 'family';
  return 'other';
}

const SYMMETRIC_TERMS = [
  '夫妻',
  '恋人',
  '情侣',
  '朋友',
  '好友',
  '同门',
  '同事',
  '同学',
  '邻居',
  '结拜',
  '师兄弟',
  '师姐妹',
  '盟友',
  '敌对',
  '对手',
  '竞争',
  '伙伴',
  '同伴',
];

function isSymmetric(type: string): boolean {
  return SYMMETRIC_TERMS.some((term) => type.includes(term));
}

function buildNameIndex(entities: KnowledgeEntity[]) {
  const byType = new Map<string, string>();
  const anyType = new Map<string, string>();
  for (const entity of entities) {
    for (const name of [entity.name, ...entity.aliases]) {
      const key = knowledgeNameKey(name);
      if (!byType.has(`${entity.type}:${key}`)) byType.set(`${entity.type}:${key}`, entity.id);
      if (!anyType.has(key)) anyType.set(key, entity.id);
    }
  }
  return { byType, anyType };
}

function resolveEntityId(
  name: string,
  index: ReturnType<typeof buildNameIndex>,
  preferredType?: KnowledgeEntityType,
): string | undefined {
  const key = knowledgeNameKey(name);
  if (preferredType) {
    const preferred = index.byType.get(`${preferredType}:${key}`);
    if (preferred) return preferred;
  }
  return index.anyType.get(key);
}

function buildRelations(
  chapters: ChapterKnowledge[],
  index: ReturnType<typeof buildNameIndex>,
  entityEvidence: Map<string, KnowledgeEntity['evidence']>,
): KnowledgeRelation[] {
  const byKey = new Map<string, KnowledgeRelation>();
  for (const chapter of chapters) {
    for (const fact of chapter.relations) {
      const source = resolveEntityId(fact.source, index, 'person');
      const target = resolveEntityId(fact.target, index, 'person');
      if (!source || !target || source === target) continue;
      const type = normalizeKnowledgeName(fact.type) || 'other';
      const [first, second] =
        isSymmetric(type) && source > target ? [target, source] : [source, target];
      const key = `${first}\u0000${second}\u0000${knowledgeNameKey(type)}`;
      let relation = byKey.get(key);
      if (!relation) {
        relation = {
          id: `relation:${first}->${second}:${type}`,
          source: first,
          target: second,
          type,
          category: classifyRelationType(type),
          weight: 0,
          chapters: [],
          evidence: [],
        };
        byKey.set(key, relation);
      }
      if (!relation.chapters.includes(chapter.chapterIndex)) {
        relation.chapters.push(chapter.chapterIndex);
        relation.weight += 1;
      }
      const quote = fact.evidence.trim();
      if (
        quote &&
        relation.evidence.length < MAX_EVIDENCE_PER_RELATION &&
        !relation.evidence.some(
          (item) => item.quote === quote && item.chapterIndex === chapter.chapterIndex,
        )
      ) {
        const evidence = {
          chapterIndex: chapter.chapterIndex,
          chapterTitle: chapter.chapterTitle,
          quote,
        };
        relation.evidence.push(evidence);
        for (const entityId of [first, second]) {
          const bucket = entityEvidence.get(entityId) ?? [];
          if (bucket.length < MAX_EVIDENCE_PER_ENTITY) bucket.push(evidence);
          entityEvidence.set(entityId, bucket);
        }
      }
    }
  }
  return Array.from(byKey.values())
    .map((relation) => ({
      ...relation,
      chapters: [...relation.chapters].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type));
}

function buildEvents(
  chapters: ChapterKnowledge[],
  index: ReturnType<typeof buildNameIndex>,
  entityEvidence: Map<string, KnowledgeEntity['evidence']>,
): KnowledgeEvent[] {
  const events: KnowledgeEvent[] = [];
  for (const chapter of chapters) {
    chapter.events.forEach((fact, eventIndex) => {
      const evidence = fact.evidence.trim()
        ? [
            {
              chapterIndex: chapter.chapterIndex,
              chapterTitle: chapter.chapterTitle,
              quote: fact.evidence.trim(),
            },
          ]
        : [];
      const participants = Array.from(
        new Set(
          fact.participants
            .map((participant) => resolveEntityId(participant, index))
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (evidence[0]) {
        for (const entityId of participants) {
          const bucket = entityEvidence.get(entityId) ?? [];
          if (bucket.length < MAX_EVIDENCE_PER_ENTITY) bucket.push(evidence[0]);
          entityEvidence.set(entityId, bucket);
        }
      }
      events.push({
        id: `event:${chapter.chapterIndex}:${eventIndex}`,
        chapterIndex: chapter.chapterIndex,
        chapterTitle: chapter.chapterTitle,
        summary: fact.summary,
        type: fact.type || 'other',
        importance: fact.importance,
        participants,
        location: fact.location ? resolveEntityId(fact.location, index, 'location') : undefined,
        evidence,
      });
    });
  }
  const importanceRank = { high: 0, medium: 1, low: 2 };
  return events.sort(
    (a, b) =>
      a.chapterIndex - b.chapterIndex ||
      importanceRank[a.importance] - importanceRank[b.importance] ||
      a.id.localeCompare(b.id),
  );
}

function sortEntities(entities: KnowledgeEntity[]): KnowledgeEntity[] {
  return entities.sort(
    (a, b) =>
      ENTITY_ORDER.indexOf(a.type) - ENTITY_ORDER.indexOf(b.type) ||
      b.chapters.length - a.chapters.length ||
      a.firstChapter - b.firstChapter ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Relations sometimes mention a person the model forgot to add to `people`.
 * Keep that endpoint as a stub so the relation is not silently dropped.
 */
function addReferencedPeople(
  chapters: ChapterKnowledge[],
  entities: KnowledgeEntity[],
): KnowledgeEntity[] {
  const known = new Set<string>();
  for (const entity of entities) {
    if (entity.type !== 'person') continue;
    for (const name of [entity.name, ...entity.aliases]) known.add(knowledgeNameKey(name));
  }

  const missing = new Map<string, { name: string; chapters: Set<number> }>();
  for (const chapter of chapters) {
    for (const fact of chapter.relations) {
      for (const name of [fact.source, fact.target]) {
        const key = knowledgeNameKey(name);
        if (!key || known.has(key)) continue;
        const existing = missing.get(key);
        if (existing) existing.chapters.add(chapter.chapterIndex);
        else
          missing.set(key, {
            name: normalizeKnowledgeName(name),
            chapters: new Set([chapter.chapterIndex]),
          });
      }
    }
  }

  return Array.from(missing.values()).map((entry) => ({
    id: `person:${entry.name}`,
    type: 'person',
    name: entry.name,
    aliases: [],
    description: '',
    firstChapter: Math.min(...entry.chapters),
    chapters: Array.from(entry.chapters).sort((a, b) => a - b),
    evidence: [],
  }));
}

/**
 * Folds per-chapter facts into one book-level knowledge base. The function is
 * pure and deterministic so it can be used both after every chapter and when
 * loading persisted data.
 */
export function aggregateKnowledge(
  chapters: ChapterKnowledge[],
  bookTitle: string,
  bookHash = chapters[0]?.bookHash ?? '',
): BookKnowledge {
  const ordered = [...chapters].sort((a, b) => a.chapterIndex - b.chapterIndex);
  const extracted = buildEntities(ordered);
  const entities = sortEntities([...extracted, ...addReferencedPeople(ordered, extracted)]);
  const index = buildNameIndex(entities);

  const locationIndex = new Map<string, string>();
  for (const entity of entities) {
    if (entity.type !== 'location') continue;
    for (const name of [entity.name, ...entity.aliases]) {
      locationIndex.set(knowledgeNameKey(name), entity.id);
    }
  }
  for (const entity of entities) {
    if (entity.type === 'location' && entity.parent) {
      entity.parent = locationIndex.get(knowledgeNameKey(entity.parent));
    }
  }

  const entityEvidence = new Map<string, KnowledgeEntity['evidence']>();
  const relations = buildRelations(ordered, index, entityEvidence);
  const events = buildEvents(ordered, index, entityEvidence);
  for (const entity of entities) entity.evidence = entityEvidence.get(entity.id) ?? [];

  const chapterIndices = Array.from(new Set(ordered.map((chapter) => chapter.chapterIndex))).sort(
    (a, b) => a - b,
  );

  return {
    bookHash,
    bookTitle,
    updatedAt: Date.now(),
    analyzedChapters: chapterIndices,
    entities,
    relations,
    events,
    stats: {
      people: entities.filter((entity) => entity.type === 'person').length,
      locations: entities.filter((entity) => entity.type === 'location').length,
      items: entities.filter((entity) => entity.type === 'item').length,
      orgs: entities.filter((entity) => entity.type === 'org').length,
      concepts: entities.filter((entity) => entity.type === 'concept').length,
      relations: relations.length,
      events: events.length,
    },
  };
}
