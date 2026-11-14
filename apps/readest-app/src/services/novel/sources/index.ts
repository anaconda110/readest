import { canonicalTimotxtUrl, decodeTimotxtHtml, isTimotxtUrl, timotxtTocUrl } from './timotxt';

/** Decode a page's body before any HTML parsing. Unknown sources are untouched. */
export function decodeNovelHtml(html: string, url: string): string {
  return isTimotxtUrl(url) ? decodeTimotxtHtml(html) : html;
}

/** The source's canonical work URL, used as the EPUB identity. */
export function canonicalNovelUrl(url: string): string | null {
  return canonicalTimotxtUrl(url);
}

/** Where the chapter list for a book page or chapter URL can be fetched. */
export function novelTocUrl(url: string): string | null {
  return timotxtTocUrl(url);
}
