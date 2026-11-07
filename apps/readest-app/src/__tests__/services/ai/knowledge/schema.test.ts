import { describe, expect, it } from 'vitest';

import { parseKnowledgeExtraction, sliceJsonObject } from '@/services/ai/knowledge/schema';

describe('sliceJsonObject', () => {
  it('extracts a fenced object and ignores surrounding prose', () => {
    const raw = 'Here is the result:\n```json\n{"people":[{"name":"孙悟空"}]}\n```\nDone.';
    expect(sliceJsonObject(raw)).toBe('{"people":[{"name":"孙悟空"}]}');
  });

  it('keeps braces inside strings balanced', () => {
    const raw = '{"people":[{"name":"a}b","description":"uses { and }"}]}';
    expect(sliceJsonObject(raw)).toBe(raw);
  });

  it('returns null when there is no object', () => {
    expect(sliceJsonObject('no json here')).toBeNull();
  });
});

describe('parseKnowledgeExtraction', () => {
  it('normalizes common weak-model output', () => {
    const raw = JSON.stringify({
      people: [
        { name: ' 孙悟空 ', aliases: null, description: '石猴', category: null },
        { name: '孙悟空', aliases: ['美猴王'], description: '齐天大圣' },
      ],
      locations: [{ name: '花果山', parent: '东胜神洲', aliases: [] }],
      items: [{ name: null }],
      orgs: [],
      concepts: [{ name: '七十二变', category: '功法', definition: '变化之术' }],
      relations: [
        { source: '孙悟空', target: '唐僧', type: '师徒', evidence: '拜其为师' },
        { source: '孙悟空', target: '孙悟空', type: '自我', evidence: '不应保留' },
        { source: '孙悟空', target: '唐僧', type: '师徒', evidence: '重复' },
      ],
      events: [
        {
          summary: ' 拜师 ',
          type: '成长',
          importance: '高',
          participants: ['孙悟空', '唐僧'],
          location: '花果山',
          evidence: '三拜九叩',
        },
      ],
    });

    const parsed = parseKnowledgeExtraction(raw);
    expect(parsed.people).toHaveLength(1);
    expect(parsed.people[0]).toMatchObject({
      name: '孙悟空',
      aliases: ['美猴王'],
      description: '齐天大圣',
    });
    expect(parsed.locations[0]).toMatchObject({ name: '花果山', parent: '东胜神洲' });
    expect(parsed.items).toHaveLength(0);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      summary: '拜师',
      importance: 'high',
      participants: ['孙悟空', '唐僧'],
    });
  });

  it('rejects responses without JSON', () => {
    expect(() => parseKnowledgeExtraction('I cannot help with that.')).toThrow(/JSON object/);
  });

  it('accepts AI Reader V2 style containers and key names', () => {
    const raw = JSON.stringify({
      chapter_fact: {
        characters: [{ name: '林黛玉', aliases: ['黛玉'] }],
        new_concepts: [{ name: '还泪', definition: '前世之约' }],
      },
    });
    const parsed = parseKnowledgeExtraction(raw);
    expect(parsed.people[0]?.name).toBe('林黛玉');
    expect(parsed.concepts[0]?.name).toBe('还泪');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseKnowledgeExtraction('{"people": [}')).toThrow(/invalid JSON/i);
  });
});
