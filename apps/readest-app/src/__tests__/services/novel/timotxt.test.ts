import { describe, expect, it } from 'vitest';
import {
  canonicalTimotxtUrl,
  decodeTimotxtHtml,
  timotxtTocUrl,
} from '@/services/novel/sources/timotxt';
import { parseChapterList, parseWorkMetadata } from '@/services/novel/chapterList';
import { extractChapterHtml, fetchNovelToc } from '@/services/novel/novelImport';

describe('timotxt decoding', () => {
  it('maps obfuscated entities and raw codepoints back to characters', () => {
    expect(decodeTimotxtHtml('&#xae4a;&#xad5b;')).toBe('了十');
    expect(decodeTimotxtHtml('\uad5b')).toBe('十');
    expect(decodeTimotxtHtml('&#xb203;&#xb380;')).toBe('生市');
  });

  it('leaves ordinary text and unrelated numeric entities alone', () => {
    expect(decodeTimotxtHtml('&#x4e00; 正常')).toBe('&#x4e00; 正常');
    expect(decodeTimotxtHtml('A &amp; B')).toBe('A &amp; B');
  });
});

describe('timotxt URLs', () => {
  it('derives the canonical book URL from a chapter page', () => {
    expect(canonicalTimotxtUrl('https://www.timotxt.com/0201598585/86.html')).toBe(
      'https://www.timotxt.com/0201598585/',
    );
    expect(canonicalTimotxtUrl('https://timotxt.com/0201598585/dir')).toBe(
      'https://www.timotxt.com/0201598585/',
    );
    expect(canonicalTimotxtUrl('https://example.com/86.html')).toBeNull();
  });

  it('derives the chapter-list URL from a chapter or book page', () => {
    expect(timotxtTocUrl('https://www.timotxt.com/0201598585/86.html')).toBe(
      'https://www.timotxt.com/0201598585/dir',
    );
    expect(timotxtTocUrl('https://www.timotxt.com/0201598585/')).toBe(
      'https://www.timotxt.com/0201598585/dir',
    );
    expect(timotxtTocUrl('https://www.timotxt.com/0201598585/dir')).toBe(
      'https://www.timotxt.com/0201598585/dir',
    );
  });
});

describe('timotxt pages', () => {
  const tocPage = `<!DOCTYPE html><html><head>
<title>孽徒帶崽歸來，師尊寵瘋了！章節列表 - 提莫書屋</title>
</head><body>
<section><h1 class="title is-2">孽徒帶崽歸來，師尊寵瘋了！ 章節列表</h1>
<h2 class="title is-4">作者 / 人世間l</h2></section>
<div class="chaplist"><ul>
${Array.from({ length: 6 }, (_, i) => {
  const n = 6 - i;
  return `<li><a href="/0201598585/${n}.html">第${n}章</a></li>`;
}).join('\n')}
</ul></div></body></html>`;

  it('reads the traditional chapter-list title and byline', () => {
    const toc = parseChapterList(tocPage, 'https://www.timotxt.com/0201598585/dir');
    expect(toc).not.toBeNull();
    expect(toc!.title).toBe('孽徒帶崽歸來，師尊寵瘋了！');
    expect(toc!.author).toBe('人世間l');
    expect(toc!.chapters.map((chapter) => chapter.title)).toEqual([
      '第1章',
      '第2章',
      '第3章',
      '第4章',
      '第5章',
      '第6章',
    ]);
  });

  it('strips the traditional chapter-list suffix from the title tag', () => {
    const meta = parseWorkMetadata(
      '<html><head><title>一本書 章節列表 - 提莫書屋</title></head><body></body></html>',
      'https://www.timotxt.com/0201598585/dir',
    );
    expect(meta.title).toBe('一本書');
  });

  it('accepts name= OpenGraph novel metadata and covers', () => {
    const meta = parseWorkMetadata(
      `<html><head>
        <meta name="og:novel:book_name" content="孽徒帶崽歸來，師尊寵瘋了！"/>
        <meta name="og:novel:author" content="人世間l"/>
        <meta name="og:image" content="/thumb/cover.jpg"/>
      </head><body></body></html>`,
      'https://www.timotxt.com/0201598585/',
    );
    expect(meta.title).toBe('孽徒帶崽歸來，師尊寵瘋了！');
    expect(meta.author).toBe('人世間l');
    expect(meta.coverUrl).toBe('https://www.timotxt.com/thumb/cover.jpg');
  });

  it('starts from a pasted chapter URL by fetching the directory then the book page', async () => {
    const seen: string[] = [];
    const fetchPage = async (url: string) => {
      seen.push(url);
      if (url.endsWith('/dir')) return { html: tocPage, finalUrl: url };
      if (url === 'https://www.timotxt.com/0201598585/') {
        return {
          html: `<html><head>
            <meta name="og:novel:book_name" content="孽徒帶崽歸來，師尊寵瘋了！"/>
            <meta name="og:novel:author" content="人世間l"/>
            <meta name="og:image" content="https://i1.timotxt.com/cover.jpg"/>
          </head><body></body></html>`,
          finalUrl: url,
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const toc = await fetchNovelToc('https://www.timotxt.com/0201598585/86.html', { fetchPage });
    expect(seen).toEqual([
      'https://www.timotxt.com/0201598585/dir',
      'https://www.timotxt.com/0201598585/',
    ]);
    expect(toc.title).toBe('孽徒帶崽歸來，師尊寵瘋了！');
    expect(toc.author).toBe('人世間l');
    expect(toc.coverUrl).toBe('https://i1.timotxt.com/cover.jpg');
    expect(toc.chapters[0]?.id).toBe('1');
  });

  it('decodes and extracts chapter prose without the ad block', () => {
    const page = `<html><body><div class="chapter-content">
      <h1>第86章</h1>
      <div class="content">
        <div class="gadBlock"><ins class="clickforceads"></ins></div>
        <p>她想&#xb185;是納蘭明月，站在&#xad5b;界河對岸。</p>
        <p>她&#xb19a;走&#xb185;路還很長，&#xae47;&#xaf6d;十&#xb213;都在前方。</p>
        <p>她不知道那裡有什麼，但她想去看看，於是沿著山路繼續朝東南方向走去。</p>
        <p>青陽宗的演武場上，幾個弟子圍成一圈，正對著地上蜷縮的人影拳打腳踢。</p>
      </div>
    </div></body></html>`;
    const html = extractChapterHtml(page, '第86章', 'https://www.timotxt.com/0201598585/86.html');
    expect(html).toContain('她想的是納蘭明月，站在十界河對岸。');
    expect(html).toContain('她要走的路還很長，九天十地都在前方。');
    expect(html).not.toContain('gadBlock');
    expect(html).not.toContain('clickforceads');
  });
});
