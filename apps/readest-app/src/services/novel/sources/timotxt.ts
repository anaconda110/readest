/**
 * timotxt.com renders prose with a custom font whose glyph order is scrambled:
 * the HTML carries codepoints in the U+AD17–U+B59A block and the font maps
 * them back to real characters. A random subset of each response is encoded
 * this way, so the page is unreadable unless the entity/codepoint is decoded
 * before the HTML is parsed (the parser would turn `&#x…;` into the scrambled
 * codepoint first).
 *
 * The mapping below is fixed per site build. It was derived from the shipped
 * font and validated against a full book; the two entries marked at the end
 * were corrected from sentence context.
 */

const TIMOTXT_HOST = /(^|\.)timotxt\.com$/i;

const CODES = [
  44311, 44379, 44380, 44445, 44535, 44536, 44537, 44615, 44618, 44677, 44678, 44695, 44696, 44699,
  44721, 44722, 44723, 44724, 44725, 44726, 44759, 44760, 44761, 44762, 44763, 44764, 44769, 44771,
  44773, 44774, 44775, 44777, 44806, 44807, 44810, 44811, 44812, 44813, 44814, 44816, 44887, 44908,
  44909, 44910, 44913, 44937, 44938, 44966, 44968, 44969, 44971, 44972, 44973, 44974, 44991, 44992,
  44993, 44994, 45015, 45019, 45026, 45028, 45030, 45031, 45032, 45033, 45035, 45037, 45038, 45039,
  45040, 45045, 45047, 45048, 45049, 45051, 45072, 45073, 45076, 45078, 45079, 45080, 45081, 45086,
  45087, 45095, 45098, 45099, 45100, 45290, 45291, 45292, 45293, 45384, 45385, 45386, 45388, 45389,
  45408, 45409, 45410, 45412, 45414, 45415, 45416, 45418, 45439, 45440, 45442, 45445, 45446, 45447,
  45450, 45451, 45452, 45462, 45464, 45465, 45466, 45467, 45565, 45566, 45569, 45570, 45571, 45572,
  45585, 45586, 45587, 45589, 45696, 45697, 45698, 45700, 45701, 45705, 45708, 45747, 45749, 45951,
  45952, 45955, 46039, 46433, 46434, 46435, 46436, 46488, 46490,
];

const CHARS =
  '二十丁七八人入九了刀力又三干土工才寸丈大上小口山巾千亡之已弓己也乞川么久勺丸凡及叉夫天元扎五支犬尤匹巨牙屯互切止少日中手午升仁片化仇仍斤爪反介父今凶乏氏欠丹勾六文方火心尺巴以允予幻玉末未打巧正功扔甘世古本可丙左石右布平的是在不有和我由只要他叫用四失生到代作地出就分乎令成句外冬包主市年它百同能而下子';

const MAP = new Map<number, string>();
for (let i = 0; i < CODES.length; i++) {
  MAP.set(CODES[i]!, CHARS[i]!);
}
MAP.set(0xb203, '生');
MAP.set(0xb380, '市');

const OBFUSCATED = /&#x([0-9a-f]+);|&#(\d+);|[\uad17-\ub59a]/gi;

export function isTimotxtUrl(url: string): boolean {
  try {
    return TIMOTXT_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function decodeTimotxtHtml(html: string): string {
  return html.replace(OBFUSCATED, (raw, hex: string | undefined, dec: string | undefined) => {
    const codepoint = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : raw.codePointAt(0)!;
    return MAP.get(codepoint) ?? raw;
  });
}

/** `https://www.timotxt.com/<bookId>/` — the page carrying the real cover and
 *  novel metadata, and the stable identity for an imported book. */
export function canonicalTimotxtUrl(url: string): string | null {
  if (!isTimotxtUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const bookId = parsed.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1];
    return bookId ? `https://www.timotxt.com/${bookId}/` : null;
  } catch {
    return null;
  }
}

/** The chapter list lives at `/<bookId>/dir`, so a pasted chapter URL still
 *  imports without asking the user to find the directory page. */
export function timotxtTocUrl(url: string): string | null {
  const bookUrl = canonicalTimotxtUrl(url);
  return bookUrl ? `${bookUrl}dir` : null;
}
