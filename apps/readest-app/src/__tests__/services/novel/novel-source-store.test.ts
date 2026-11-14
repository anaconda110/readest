import { describe, expect, it } from 'vitest';
import {
  loadNovelChapterHtml,
  loadNovelSource,
  saveNovelChapterHtml,
  saveNovelSource,
  type NovelSourceFs,
  type NovelSourceRecord,
} from '@/services/novel/novelSourceStore';

class MemoryFs implements NovelSourceFs {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    for (const key of this.files.keys()) {
      if (key === path || key.startsWith(`${path}/`)) return true;
    }
    return false;
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async createDir(): Promise<void> {}
}

const record: NovelSourceRecord = {
  version: 1,
  canonicalUrl: 'https://www.timotxt.com/0201598585/',
  tocUrl: 'https://www.timotxt.com/0201598585/dir',
  title: '孽徒帶崽歸來，師尊寵瘋了！',
  author: '人世間l',
  coverUrl: 'https://i1.timotxt.com/cover.jpg',
  identityKey: 'https://www.timotxt.com/0201598585/',
  selectedAll: true,
  fetchedAt: 1,
  chapters: [
    {
      id: '86',
      title: '第86章',
      url: 'https://www.timotxt.com/0201598585/86.html',
    },
  ],
};

describe('novel source store', () => {
  it('saves and loads a source record by canonical URL', async () => {
    const fs = new MemoryFs();
    await saveNovelSource(fs, record);
    expect(await loadNovelSource(fs, record.canonicalUrl)).toEqual(record);
  });

  it('returns null for an unknown or corrupt record', async () => {
    const fs = new MemoryFs();
    expect(await loadNovelSource(fs, record.canonicalUrl)).toBeNull();
    await saveNovelSource(fs, record);
    const path = [...fs.files.keys()][0]!;
    fs.files.set(path, '{not json');
    expect(await loadNovelSource(fs, record.canonicalUrl)).toBeNull();
  });

  it('saves and loads chapter HTML per source', async () => {
    const fs = new MemoryFs();
    await saveNovelChapterHtml(fs, record.canonicalUrl, '86', '<p>正文</p>');
    expect(await loadNovelChapterHtml(fs, record.canonicalUrl, '86')).toBe('<p>正文</p>');
    expect(await loadNovelChapterHtml(fs, record.canonicalUrl, '87')).toBeNull();
  });

  it('rejects unsafe chapter ids instead of writing outside the cache dir', async () => {
    const fs = new MemoryFs();
    await saveNovelChapterHtml(fs, record.canonicalUrl, '../escape', '<p>x</p>');
    expect([...fs.files.keys()].every((path) => !path.includes('..'))).toBe(true);
  });
});
