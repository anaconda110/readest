#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_NOVEL_ID = '068c5a41-f591-4fa8-b6f0-deb8040374f9';
const INVALID_SUMMARY_IDS = new Set([
  'bde7f51d-d505-4bd3-8b1a-a56b156ee144',
  'fc455084-4699-41ec-95ca-1035df3a6d32',
]);
const SOURCE_NOTE_INDEXES = new Set([286, 615, 673, 828]);
const TARGET = {
  bookHash: 'f15c9d6f422ff89a2aaadfa5fd69eefc',
  bookTitle: '灵境行者',
  authorName: '卖报小郎君',
};

const VOLUMES = [
  {
    name: 'volume-1',
    sourceRange: [2, 285],
    sourceCount: 284,
    mergeGroups: [[230, 231]],
    targetRange: [10, 292],
    targetExclusions: [],
  },
  {
    name: 'volume-2',
    sourceRange: [287, 672],
    sourceCount: 385,
    sourceExclusions: [615],
    mergeGroups: [
      [321, 322],
      [365, 366, 367],
      [368, 369, 370, 371, 372],
      [374, 375, 376],
      [379, 380, 381, 382],
      [383, 384, 385, 386],
      [387, 388, 389, 390],
    ],
    targetRange: [294, 661],
    targetExclusions: [494],
  },
  {
    name: 'volume-3',
    sourceRange: [674, 827],
    sourceCount: 152,
    mergeGroups: [],
    targetRange: [663, 817],
    targetExclusions: [687, 727, 728],
  },
  {
    name: 'volume-4',
    sourceRange: [829, 1042],
    sourceCount: 214,
    mergeGroups: [],
    targetRange: [819, 1032],
    targetExclusions: [],
  },
  {
    name: 'epilogue',
    sourceRange: [1043, 1051],
    sourceCount: 9,
    mergeGroups: [
      [1047, 1048],
      [1050, 1051],
    ],
    targetRange: [1033, 1039],
    targetExclusions: [],
  },
];

const EXPECTED_GROUP_COUNTS = [283, 367, 152, 214, 7];
const EXPECTED_REPORT_COUNT = 1023;
const EXPECTED_MAPPINGS = new Map([
  [56, 64],
  [96, 104],
  [230, 238],
  [231, 238],
  [321, 328],
  [322, 328],
  [365, 371],
  [366, 371],
  [367, 371],
  [368, 372],
  [369, 372],
  [370, 372],
  [371, 372],
  [372, 372],
  [374, 374],
  [375, 374],
  [376, 374],
  [379, 377],
  [380, 377],
  [381, 377],
  [382, 377],
  [383, 378],
  [384, 378],
  [385, 378],
  [386, 378],
  [387, 379],
  [388, 379],
  [389, 379],
  [390, 379],
  [663, 652],
  [698, 688],
  [776, 766],
  [1047, 1037],
  [1048, 1037],
  [1050, 1039],
  [1051, 1039],
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const sourcePath =
  process.argv[2] || '/mnt/c/Users/Tom/AppData/Local/Temp/anx_summaries_export.json';
const navPath =
  process.argv[3] ||
  '/mnt/c/Users/Tom/AppData/Roaming/com.bilingify.readest/Readest/Books/f15c9d6f422ff89a2aaadfa5fd69eefc/nav.json';
const outputPath =
  process.argv[4] ||
  path.join(appDir, 'src/data/aiNovelReaderV2/lingjing-xingzhe-chapters.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function range(start, end, exclusions = []) {
  const excluded = new Set(exclusions);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index).filter(
    (value) => !excluded.has(value),
  );
}

function flattenToc(items) {
  const flat = [];
  for (const item of items || []) {
    flat.push(item);
    if (item.subitems) flat.push(...flattenToc(item.subitems));
  }
  return flat;
}

function groupRecords(records, mergeGroups, volumeName) {
  const byIndex = new Map(records.map((record) => [record.index, record]));
  const mergeByIndex = new Map();
  const mergedIndexes = new Set();

  for (const group of mergeGroups) {
    const members = group.map((index) => {
      const record = byIndex.get(index);
      assert(record, `${volumeName}: missing source chapter index ${index} in merge group`);
      return record;
    });
    for (const index of group) {
      assert(!mergedIndexes.has(index), `${volumeName}: duplicate merge index ${index}`);
      mergedIndexes.add(index);
      mergeByIndex.set(index, members);
    }
  }

  const groups = [];
  const consumed = new Set();
  for (const record of records) {
    if (consumed.has(record.index)) continue;
    const mergeGroup = mergeByIndex.get(record.index);
    if (mergeGroup) {
      groups.push(mergeGroup);
      for (const member of mergeGroup) consumed.add(member.index);
    } else {
      groups.push([record]);
      consumed.add(record.index);
    }
  }
  return groups;
}

function mergeGroupTitle(records) {
  const nonEmpty = records.map((record) => record.chapter_title.trim()).filter(Boolean);
  const first = nonEmpty[0] || '';
  return nonEmpty.every((title) => title === first) ? first : nonEmpty.join(' / ');
}

const exported = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const nav = JSON.parse(fs.readFileSync(navPath, 'utf8'));
const flatToc = flattenToc(nav.toc).sort((a, b) => a.id - b.id);
assert(flatToc.length === 1040, `Expected 1040 TOC entries, got ${flatToc.length}`);
assert(
  flatToc.every((item, index) => item.id === index),
  'TOC ids must be contiguous from 0 to 1039',
);
const tocById = new Map(flatToc.map((item) => [item.id, item]));

const sourceChapters = new Map(
  exported.chapters
    .filter((chapter) => chapter.novel_id === SOURCE_NOVEL_ID)
    .map((chapter) => [chapter.id, chapter]),
);
const records = exported.summaries
  .filter((summary) => summary.novel_id === SOURCE_NOVEL_ID)
  .filter((summary) => !INVALID_SUMMARY_IDS.has(summary.id))
  .filter((summary) => summary.deleted === 0)
  .map((summary) => {
    const chapter = sourceChapters.get(summary.chapter_id);
    assert(chapter, `Missing source chapter ${summary.chapter_id} for summary ${summary.id}`);
    assert(summary.content.trim(), `Empty summary content for ${summary.id}`);
    return { ...summary, index: chapter.index_num };
  })
  .filter((record) => !SOURCE_NOTE_INDEXES.has(record.index))
  .sort((a, b) => a.index - b.index || a.created_at - b.created_at || a.id.localeCompare(b.id));

assert(records.length === 1044, `Expected 1044 formal summaries, got ${records.length}`);

const volumeGroups = VOLUMES.map((volume, volumeIndex) => {
  const [sourceStart, sourceEnd] = volume.sourceRange;
  const sourceExclusions = new Set(volume.sourceExclusions ?? []);
  const volumeRecords = records.filter(
    (record) =>
      record.index >= sourceStart &&
      record.index <= sourceEnd &&
      !sourceExclusions.has(record.index),
  );
  assert(
    volumeRecords.length === volume.sourceCount,
    `${volume.name}: expected ${volume.sourceCount} source summaries, got ${volumeRecords.length}`,
  );
  const groups = groupRecords(volumeRecords, volume.mergeGroups, volume.name);
  assert(
    groups.length === EXPECTED_GROUP_COUNTS[volumeIndex],
    `${volume.name}: expected ${EXPECTED_GROUP_COUNTS[volumeIndex]} groups, got ${groups.length}`,
  );
  const targets = range(...volume.targetRange, volume.targetExclusions);
  assert(
    groups.length === targets.length,
    `${volume.name}: ${groups.length} source groups cannot map to ${targets.length} targets`,
  );
  return { volume, groups, targets };
});

const reports = [];
const mappedSourceIndexes = new Map();
for (const { volume, groups, targets } of volumeGroups) {
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const sectionIndex = targets[index];
    const tocItem = tocById.get(sectionIndex);
    assert(tocItem, `${volume.name}: missing TOC target ${sectionIndex}`);
    const orderedGroup = [...group].sort(
      (a, b) => a.index - b.index || a.created_at - b.created_at || a.id.localeCompare(b.id),
    );
    const report = {
      sectionIndex,
      chapterTitle: tocItem.label,
      content: orderedGroup.map((record) => record.content.trim()).join('\n\n---\n\n'),
      createdAt: Math.min(...orderedGroup.map((record) => record.created_at)),
      updatedAt: Math.max(...orderedGroup.map((record) => record.updated_at)),
      sourceChapterIds: [...new Set(orderedGroup.map((record) => record.chapter_id))],
      sourceSummaryIds: orderedGroup.map((record) => record.id),
      sourceChapterTitle: mergeGroupTitle(orderedGroup),
    };
    reports.push(report);
    for (const record of orderedGroup) {
      mappedSourceIndexes.set(record.index, sectionIndex);
    }
  }
}

assert(
  reports.length === EXPECTED_REPORT_COUNT,
  `Expected ${EXPECTED_REPORT_COUNT} imported reports, got ${reports.length}`,
);
assert(new Set(reports.map((report) => report.sectionIndex)).size === reports.length, 'Duplicate targets');
assert(reports.every((report) => report.content.length > 0), 'Empty imported report content');

for (const [sourceIndex, targetIndex] of EXPECTED_MAPPINGS) {
  assert(
    mappedSourceIndexes.get(sourceIndex) === targetIndex,
    `Expected source ${sourceIndex} -> target ${targetIndex}, got ${mappedSourceIndexes.get(sourceIndex)}`,
  );
}

const expectedGaps = [494, 687, 727, 728];
const reportSections = new Set(reports.map((report) => report.sectionIndex));
for (const sectionIndex of expectedGaps) {
  assert(!reportSections.has(sectionIndex), `Target ${sectionIndex} should not have an imported report`);
}
for (const sectionIndex of [737, 738]) {
  assert(reportSections.has(sectionIndex), `Target ${sectionIndex} should have an imported report`);
}

for (const [sourceIndex, targetIndex] of mappedSourceIndexes) {
  const source = records.find((record) => record.index === sourceIndex);
  const target = reports.find((report) => report.sectionIndex === targetIndex);
  assert(source && target, `Missing signature pair ${sourceIndex} -> ${targetIndex}`);
}

const dataset = {
  version: 1,
  source: 'ai-novel-reader-v2',
  sourceNovelId: SOURCE_NOVEL_ID,
  bookHash: TARGET.bookHash,
  bookTitle: TARGET.bookTitle,
  authorName: TARGET.authorName,
  sectionCount: flatToc.length,
  tocSignature: Object.fromEntries(flatToc.map((item) => [String(item.id), item.label])),
  reports,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
console.log(
  `Wrote ${reports.length} imported chapter summaries to ${outputPath} (${(
    fs.statSync(outputPath).size / 1024 / 1024
  ).toFixed(2)} MiB)`,
);
