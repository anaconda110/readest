import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearRagModelCache,
  getRagModelCacheInfo,
  pruneRagModelCache,
} from '@/services/ai/rag/LocalEmbeddingModel';

const MB = 1024 * 1024;
const BGE = 'Xenova/bge-small-zh-v1.5';
const GTE = 'Xenova/gte-small';
const MINILM = 'Xenova/all-MiniLM-L6-v2';

interface FakeCacheEntry {
  modelKey: string;
  bytes: number;
}

function installFakeCache(entries: FakeCacheEntry[]) {
  const requests = entries.map(
    (entry) =>
      new Request(
        `https://huggingface.co/${entry.modelKey}/resolve/main/${encodeURIComponent(entry.modelKey)}.onnx`,
      ),
  );
  const responses = new Map(
    requests.map((request, index) => [
      request,
      new Response(null, {
        headers: { 'content-length': String(entries[index]!.bytes) },
      }),
    ]),
  );
  const deleted: Request[] = [];
  const cache = {
    keys: vi.fn(async () => requests),
    match: vi.fn(async (request: Request) => responses.get(request)),
    delete: vi.fn(async (request: Request) => {
      deleted.push(request);
      responses.delete(request);
      return true;
    }),
  };
  const open = vi.fn(async () => cache as unknown as Cache);
  vi.stubGlobal('caches', { open });
  return { cache, open, deleted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local RAG model cache', () => {
  it('reports only files belonging to the requested model', async () => {
    installFakeCache([
      { modelKey: BGE, bytes: 10 * MB },
      { modelKey: BGE, bytes: 20 * MB },
      { modelKey: GTE, bytes: 30 * MB },
      { modelKey: 'unrelated/model', bytes: 40 * MB },
    ]);

    await expect(getRagModelCacheInfo(BGE)).resolves.toEqual({
      cached: true,
      fileCount: 2,
      bytes: 30 * MB,
    });
  });

  it('prunes inactive models oldest-first until the budget is met', async () => {
    const { deleted } = installFakeCache([
      { modelKey: BGE, bytes: 120 * MB },
      { modelKey: GTE, bytes: 120 * MB },
      { modelKey: MINILM, bytes: 120 * MB },
    ]);

    const result = await pruneRagModelCache(256, [BGE]);

    expect(result).toEqual({
      bytesBefore: 360 * MB,
      bytesAfter: 240 * MB,
      deletedFiles: 1,
      overBudget: false,
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.url).toContain(`/${GTE}/`);
  });

  it('keeps active models and reports a soft-limit overflow', async () => {
    const { deleted } = installFakeCache([
      { modelKey: BGE, bytes: 300 * MB },
      { modelKey: GTE, bytes: 100 * MB },
    ]);

    const result = await pruneRagModelCache(256, [BGE]);

    expect(result).toEqual({
      bytesBefore: 400 * MB,
      bytesAfter: 300 * MB,
      deletedFiles: 1,
      overBudget: true,
    });
    expect(deleted.map((request) => request.url)).toEqual([expect.stringContaining(`/${GTE}/`)]);
  });

  it('clears only the selected semantic model', async () => {
    const { deleted } = installFakeCache([
      { modelKey: BGE, bytes: 10 * MB },
      { modelKey: GTE, bytes: 20 * MB },
    ]);

    await clearRagModelCache(BGE);

    expect(deleted.map((request) => request.url)).toEqual([expect.stringContaining(`/${BGE}/`)]);
  });
});
