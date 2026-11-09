import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobQueue } from '../src/jobs.js';

const REQUEST = { arena: 'North Park', court: 'Quadra 6', date: '2026-11-06', timeRange: '19:00-20:00' };

function fakeSite(videos) {
  return {
    listVideos: async () => videos,
    download: async (video, dest) => writeFile(dest, video.filename),
  };
}

async function withQueue(site, fn, { merge = async (_files, out) => writeFile(out, 'merged') } = {}) {
  const workDir = await mkdtemp(join(tmpdir(), 'jobs-test-'));
  const queue = new JobQueue({ site, merge, workDir, ttlMs: 60_000 });
  try {
    await fn(queue);
  } finally {
    queue.close();
    await rm(workDir, { recursive: true, force: true });
  }
}

test('a day without videos ends as "empty"', async () => {
  await withQueue(fakeSite([]), async (queue) => {
    const job = await queue.submit(REQUEST).done;
    assert.equal(job.status, 'empty');
  });
});

test('downloads every clip, merges them and exposes the file', async () => {
  const videos = [
    { url: 'u1', filename: 'Quadra 6_06_11_19h59_32.mp4' },
    { url: 'u2', filename: 'Quadra 6_06_11_19h38_53.mp4' },
  ];
  let mergedInputs;
  const merge = async (files, out) => {
    mergedInputs = files.map((f) => f.split('/').pop());
    await writeFile(out, 'merged');
  };
  await withQueue(
    fakeSite(videos),
    async (queue) => {
      const job = await queue.submit(REQUEST).done;
      assert.equal(job.status, 'done');
      assert.deepEqual({ total: job.total, downloaded: job.downloaded }, { total: 2, downloaded: 2 });
      assert.deepEqual(mergedInputs.sort(), videos.map((v) => v.filename).sort());
      assert.equal(job.fileName, 'North Park - Quadra 6 - 2026-11-06 1900-2000.mp4');
      assert.ok(job.filePath);
      // individual clips stay on disk so they can be zipped on demand
      assert.deepEqual(job.clips.map((c) => c.split('/').pop()).sort(), videos.map((v) => v.filename).sort());
      await Promise.all(job.clips.map((c) => access(c)));
    },
    { merge },
  );
});

test('a failed download fails the job instead of merging a partial video', async () => {
  const site = {
    listVideos: async () => [{ url: 'u1', filename: 'a_06_11_19h00_00.mp4' }],
    download: async () => {
      throw new Error('boom');
    },
  };
  await withQueue(site, async (queue) => {
    const job = await queue.submit(REQUEST).done;
    assert.equal(job.status, 'error');
  });
});

test('a job fails up front when the disk is below the free-space floor', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'jobs-test-'));
  const queue = new JobQueue({
    site: fakeSite([{ url: 'u1', filename: 'a_06_11_19h00_00.mp4' }]),
    merge: async () => {},
    workDir,
    ttlMs: 60_000,
    minFreeBytes: Number.MAX_SAFE_INTEGER,
  });
  try {
    const job = await queue.submit(REQUEST).done;
    assert.equal(job.status, 'error');
    assert.match(job.message, /espaço em disco/);
  } finally {
    queue.close();
    await rm(workDir, { recursive: true, force: true });
  }
});

test('the same request while a job is pending reuses that job', async () => {
  await withQueue(fakeSite([]), async (queue) => {
    const first = queue.submit(REQUEST);
    const second = queue.submit({ ...REQUEST });
    assert.equal(first.id, second.id);
    await first.done;
  });
});

test('jobs run one at a time', async () => {
  let running = 0;
  let maxRunning = 0;
  const site = {
    listVideos: async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return [];
    },
    download: async () => {},
  };
  await withQueue(site, async (queue) => {
    await Promise.all([
      queue.submit(REQUEST).done,
      queue.submit({ ...REQUEST, court: 'Quadra 1' }).done,
    ]);
    assert.equal(maxRunning, 1);
  });
});
