import { md5 } from '@/utils/md5';
import type { NovelChapterLink } from './chapterList';
import type { AppService } from '@/types/system';

const SOURCE_DIR = 'novel-sources';
const CACHE_DIR = 'novel-cache';

export interface NovelSourceRecord {
  version: 1;
  canonicalUrl: string;
  tocUrl: string;
  /** The imported title/author, kept stable so a re-import re-keys the same
   *  book instead of creating a new row. */
  title: string;
  author: string;
  coverUrl: string | null;
  /** The exact input used for the EPUB's `dc:identifier` at first import. */
  identityKey: string;
  /** True when every chapter in the TOC was imported; new TOC entries are then
   *  picked up by an update. A partial import only refreshes its selection. */
  selectedAll: boolean;
  fetchedAt: number;
  chapters: NovelChapterLink[];
}

/**
 * The subset of `FileSystem` / `AppService` the store needs. Paths are relative
 * to the `Books` base directory, alongside `library.json` and the hash dirs.
 */
export interface NovelSourceFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string | ArrayBuffer>;
  writeFile(path: string, content: string | ArrayBuffer | File): Promise<void>;
  createDir(path: string, recursive?: boolean): Promise<void>;
}

/** Bind the store to the app's `Books/` root. */
export const novelSourceFsFromAppService = (
  appService: Pick<AppService, 'exists' | 'readFile' | 'writeFile' | 'createDir'>,
): NovelSourceFs => ({
  exists: (path) => appService.exists(path, 'Books'),
  readFile: (path) => appService.readFile(path, 'Books', 'text'),
  writeFile: (path, content) => appService.writeFile(path, 'Books', content),
  createDir: (path, recursive) => appService.createDir(path, 'Books', recursive),
});

const sourceKey = (canonicalUrl: string): string => md5(canonicalUrl);

export const novelSourceFilename = (canonicalUrl: string): string =>
  `${SOURCE_DIR}/${sourceKey(canonicalUrl)}.json`;

export const novelCacheDir = (canonicalUrl: string): string =>
  `${CACHE_DIR}/${sourceKey(canonicalUrl)}`;

/** Chapter ids become file names, so only accept the safe subset. */
const safeChapterId = (id: string): string | null => {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '');
  return safe.length > 0 && safe.length <= 80 ? safe : null;
};

export async function saveNovelSource(fs: NovelSourceFs, record: NovelSourceRecord): Promise<void> {
  await fs.createDir(SOURCE_DIR, true);
  await fs.writeFile(novelSourceFilename(record.canonicalUrl), JSON.stringify(record));
}

export async function loadNovelSource(
  fs: NovelSourceFs,
  canonicalUrl: string,
): Promise<NovelSourceRecord | null> {
  const path = novelSourceFilename(canonicalUrl);
  if (!(await fs.exists(path))) return null;
  try {
    const raw = await fs.readFile(path);
    const parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    if (parsed?.version !== 1 || !Array.isArray(parsed.chapters)) return null;
    return parsed as NovelSourceRecord;
  } catch {
    return null;
  }
}

export async function saveNovelChapterHtml(
  fs: NovelSourceFs,
  canonicalUrl: string,
  chapterId: string,
  html: string,
): Promise<void> {
  const id = safeChapterId(chapterId);
  if (!id) return;
  const dir = novelCacheDir(canonicalUrl);
  await fs.createDir(dir, true);
  await fs.writeFile(`${dir}/${id}.html`, html);
}

export async function loadNovelChapterHtml(
  fs: NovelSourceFs,
  canonicalUrl: string,
  chapterId: string,
): Promise<string | null> {
  const id = safeChapterId(chapterId);
  if (!id) return null;
  const path = `${novelCacheDir(canonicalUrl)}/${id}.html`;
  if (!(await fs.exists(path))) return null;
  try {
    const raw = await fs.readFile(path);
    return typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  } catch {
    return null;
  }
}

/** Load the persisted HTML for every chapter in `chapters`, keyed by the same
 *  key `downloadNovel` uses for `cachedChapterHtml`. */
export async function loadNovelChapterCache(
  fs: NovelSourceFs,
  canonicalUrl: string,
  chapters: NovelChapterLink[],
): Promise<Map<string, string>> {
  const cached = new Map<string, string>();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const chapter = chapters[cursor++];
      if (!chapter) return;
      if (!chapter.id) continue;
      const html = await loadNovelChapterHtml(fs, canonicalUrl, chapter.id);
      if (html !== null) cached.set(chapter.id, html);
    }
  };
  // Bounded: a 2000-chapter book must not fire 2000 IPC calls at once.
  await Promise.all(Array.from({ length: Math.min(16, chapters.length) }, () => worker()));
  return cached;
}
