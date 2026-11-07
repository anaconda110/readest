import { describe, expect, it } from 'vitest';

import { aggregateKnowledge, classifyRelationType } from '@/services/ai/knowledge/aggregate';
import type { ChapterKnowledge, KnowledgeMention } from '@/services/ai/knowledge/types';

function mention(name: string, overrides: Partial<KnowledgeMention> = {}): KnowledgeMention {
  return { name, aliases: [], description: '', ...overrides };
}

function chapter(
  chapterIndex: number,
  overrides: Partial<ChapterKnowledge> = {},
): ChapterKnowledge {
  return {
    bookHash: 'book',
    chapterIndex,
    chapterTitle: `Section ${chapterIndex + 1}`,
    model: 'test',
    truncated: false,
    createdAt: 0,
    updatedAt: 0,
    people: [],
    locations: [],
    items: [],
    orgs: [],
    concepts: [],
    relations: [],
    events: [],
    ...overrides,
  };
}

describe('classifyRelationType', () => {
  it.each([
    ['父子', 'family'],
    ['夫妻', 'intimate'],
    ['师父', 'hierarchical'],
    ['结拜兄弟', 'social'],
    ['敌对', 'hostile'],
    ['未定义关系', 'other'],
  ] as const)('classifies %s as %s', (type, category) => {
    expect(classifyRelationType(type)).toBe(category);
  });
});

describe('aggregateKnowledge', () => {
  it('merges aliases across chapters and keeps chapter coverage', () => {
    const knowledge = aggregateKnowledge(
      [
        chapter(0, {
          people: [mention('孙悟空', { aliases: ['美猴王'] }), mention('唐僧')],
        }),
        chapter(1, { people: [mention('美猴王'), mention('唐僧')] }),
        chapter(2, { people: [mention('孙悟空'), mention('唐僧')] }),
      ],
      '西游记',
    );

    const people = knowledge.entities.filter((entity) => entity.type === 'person');
    expect(people).toHaveLength(2);
    const monkey = people.find((entity) => entity.name === '孙悟空');
    expect(monkey).toBeDefined();
    expect(monkey?.aliases).toContain('美猴王');
    expect(monkey?.chapters).toEqual([0, 1, 2]);
    expect(knowledge.stats.people).toBe(2);
  });

  it('deduplicates symmetric relations and accumulates weight and evidence', () => {
    const knowledge = aggregateKnowledge(
      [
        chapter(0, {
          people: [mention('甲'), mention('乙')],
          relations: [{ source: '甲', target: '乙', type: '朋友', evidence: '两人结为好友' }],
        }),
        chapter(1, {
          people: [mention('甲'), mention('乙')],
          relations: [{ source: '乙', target: '甲', type: '朋友', evidence: '他们一直互相照应' }],
        }),
      ],
      '测试',
    );

    expect(knowledge.relations).toHaveLength(1);
    expect(knowledge.relations[0]).toMatchObject({
      type: '朋友',
      category: 'social',
      weight: 2,
      chapters: [0, 1],
    });
    expect(knowledge.relations[0]?.evidence).toHaveLength(2);
  });

  it('creates a stub person when a relation endpoint was not extracted', () => {
    const knowledge = aggregateKnowledge(
      [
        chapter(0, {
          people: [mention('甲')],
          relations: [{ source: '甲', target: '神秘人', type: '敌对', evidence: '甲与神秘人交手' }],
        }),
      ],
      '测试',
    );

    expect(knowledge.entities.some((entity) => entity.name === '神秘人')).toBe(true);
    expect(knowledge.relations).toHaveLength(1);
  });

  it('resolves a location parent and attaches relation evidence to entities', () => {
    const knowledge = aggregateKnowledge(
      [
        chapter(0, {
          people: [mention('甲'), mention('乙')],
          locations: [mention('花果山', { parent: '东胜神洲' }), mention('东胜神洲')],
          relations: [{ source: '甲', target: '乙', type: '师徒', evidence: '甲收乙为徒' }],
        }),
      ],
      '测试',
    );

    const mountain = knowledge.entities.find((entity) => entity.name === '花果山');
    const continent = knowledge.entities.find((entity) => entity.name === '东胜神洲');
    expect(mountain?.parent).toBe(continent?.id);
    const person = knowledge.entities.find((entity) => entity.name === '甲');
    expect(person?.evidence[0]?.quote).toContain('甲收乙为徒');
  });

  it('orders events by chapter and resolves participants', () => {
    const knowledge = aggregateKnowledge(
      [
        chapter(1, {
          people: [mention('甲')],
          events: [
            {
              summary: '后发生',
              type: '战斗',
              importance: 'high',
              participants: ['甲'],
              location: undefined,
              evidence: '后发生',
            },
          ],
        }),
        chapter(0, {
          people: [mention('甲')],
          events: [
            {
              summary: '先发生',
              type: '社交',
              importance: 'low',
              participants: ['甲'],
              location: undefined,
              evidence: '先发生',
            },
          ],
        }),
      ],
      '测试',
    );

    expect(knowledge.events.map((event) => event.summary)).toEqual(['先发生', '后发生']);
    expect(knowledge.events[0]?.participants).toEqual(['person:甲']);
    expect(knowledge.stats.events).toBe(2);
  });
});
