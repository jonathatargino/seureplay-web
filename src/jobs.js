import { randomUUID } from 'node:crypto';
import { mkdir, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const PENDING = new Set(['queued', 'listing', 'downloading', 'merging']);

/**
 * Runs "download every clip of a court/day and merge them" jobs, one job at a time,
 * so disk and bandwidth use stay bounded. Clips and the merged file are deleted after ttlMs.
 *
 * Job status: queued → listing → downloading → merging → done | empty | error
 */
export class JobQueue {
  #jobs = new Map();
  #timers = new Set();
  #chain = Promise.resolve();

  constructor({ site, merge, workDir, ttlMs, downloadConcurrency = 3, minFreeBytes = 0 }) {
    Object.assign(this, { site, merge, workDir, ttlMs, downloadConcurrency, minFreeBytes });
  }

  /** Returns { id, done }; an identical request that is pending or done reuses its job. */
  submit(request) {
    const key = JSON.stringify([request.arena, request.court, request.date, request.timeRange]);
    const existing = [...this.#jobs.values()].find(
      (job) => job.key === key && (PENDING.has(job.status) || job.status === 'done'),
    );
    if (existing) return { id: existing.id, done: existing.done };

    const job = { id: randomUUID(), key, request, status: 'queued', total: 0, downloaded: 0 };
    this.#jobs.set(job.id, job);
    job.done = this.#chain = this.#chain.then(() => this.#run(job)).then(() => job);
    return { id: job.id, done: job.done };
  }

  get(id) {
    return this.#jobs.get(id);
  }

  close() {
    this.#timers.forEach(clearTimeout);
  }

  async #run(job) {
    const dir = join(this.workDir, job.id);
    try {
      job.status = 'listing';
      const videos = await this.site.listVideos(job.request);
      if (videos.length === 0) {
        job.status = 'empty';
        return;
      }
      await this.#ensureFreeSpace();
      await mkdir(dir, { recursive: true });

      job.status = 'downloading';
      job.total = videos.length;
      const files = await this.#downloadAll(job, videos, dir);

      job.status = 'merging';
      const output = join(dir, 'merged.mp4');
      await this.merge(files, output);

      const { arena, court, date, timeRange } = job.request;
      // clips stay on disk until the job expires so they can also be downloaded as a zip
      Object.assign(job, {
        status: 'done',
        filePath: output,
        fileName: `${arena} - ${court} - ${date} ${timeRange.replaceAll(':', '')}.mp4`,
        clips: files,
      });
    } catch (error) {
      Object.assign(job, { status: 'error', message: error.message });
      console.error(`[job ${job.id}] failed:`, error);
      await rm(dir, { recursive: true, force: true });
    } finally {
      this.#expire(job, dir);
    }
  }

  async #downloadAll(job, videos, dir) {
    const pending = [...videos];
    const worker = async () => {
      for (let video = pending.shift(); video; video = pending.shift()) {
        await this.site.download(video, join(dir, video.filename));
        job.downloaded += 1;
      }
    };
    await Promise.all(Array.from({ length: this.downloadConcurrency }, worker));
    return videos.map((video) => join(dir, video.filename));
  }

  async #ensureFreeSpace() {
    if (!this.minFreeBytes) return;
    const { bavail, bsize } = await statfs(this.workDir);
    if (bavail * bsize < this.minFreeBytes) {
      throw new Error('Servidor sem espaço em disco no momento. Tente novamente mais tarde.');
    }
  }

  #expire(job, dir) {
    const timer = setTimeout(async () => {
      this.#timers.delete(timer);
      this.#jobs.delete(job.id);
      await rm(dir, { recursive: true, force: true });
    }, this.ttlMs);
    timer.unref();
    this.#timers.add(timer);
  }
}
