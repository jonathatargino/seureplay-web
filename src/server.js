import { mkdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import archiver from 'archiver';
import express from 'express';
import { JobQueue } from './jobs.js';
import { mergeClips } from './merge.js';
import { SeuReplaySite } from './site.js';
import { validateJobRequest } from './validate.js';

const { SEUREPLAY_EMAIL, SEUREPLAY_PASSWORD } = process.env;
if (!SEUREPLAY_EMAIL || !SEUREPLAY_PASSWORD) {
  console.error('Set SEUREPLAY_EMAIL and SEUREPLAY_PASSWORD (see README.md).');
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 3000);
const WORK_DIR = resolve(process.env.WORK_DIR ?? 'work');
const JOB_TTL_MS = Number(process.env.JOB_TTL_MINUTES ?? 60) * 60_000;
const MIN_FREE_BYTES = Number(process.env.MIN_FREE_GB ?? 10) * 1e9;

// leftovers of a previous run are unreachable (jobs live in memory): start clean
await rm(WORK_DIR, { recursive: true, force: true });
await mkdir(WORK_DIR, { recursive: true });

const site = new SeuReplaySite({ email: SEUREPLAY_EMAIL, password: SEUREPLAY_PASSWORD });
const jobs = new JobQueue({ site, merge: mergeClips, workDir: WORK_DIR, ttlMs: JOB_TTL_MS, minFreeBytes: MIN_FREE_BYTES });

const app = express();
app.use(express.json());
app.use(express.static(resolve(import.meta.dirname, '../public')));

app.get('/api/filters', async (req, res) => {
  const { arena = '', court = '' } = req.query;
  res.json(await site.filters({ arena: String(arena), court: String(court) }));
});

app.post('/api/jobs', async (req, res) => {
  const { arena, court, date, timeRange } = req.body ?? {};
  const [{ arenas }, courtFilters] = await Promise.all([site.filters(), site.filters({ arena, court })]);
  const error = validateJobRequest({ arena, court, date, timeRange }, arenas, courtFilters);
  if (error) return res.status(400).json({ error });
  const { id } = jobs.submit({ arena, court, date, timeRange });
  res.status(202).json({ id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Pedido não encontrado ou expirado.' });
  const { id, status, total, downloaded, message, fileName } = job;
  res.json({ id, status, total, downloaded, message, fileName });
});

app.get('/api/jobs/:id/video', (req, res) => {
  const job = doneJob(req, res);
  if (job) res.download(job.filePath, job.fileName); // streamed from disk
});

app.get('/api/jobs/:id/zip', (req, res) => {
  const job = doneJob(req, res);
  if (!job) return;
  // store (no compression): mp4 is already compressed; the zip is streamed, never written to disk
  const zip = archiver('zip', { store: true });
  zip.on('error', (error) => {
    console.error(`[job ${job.id}] zip failed:`, error);
    res.destroy(error);
  });
  res.attachment(job.fileName.replace(/\.mp4$/, '.zip'));
  zip.pipe(res);
  job.clips.forEach((clip) => zip.file(clip, { name: basename(clip) }));
  zip.finalize();
});

function doneJob(req, res) {
  const job = jobs.get(req.params.id);
  if (job?.status === 'done') return job;
  res.status(404).json({ error: 'Vídeo não disponível.' });
  return null;
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(502).json({ error: 'Não foi possível falar com o Seu Replay agora. Tente novamente.' });
});

app.listen(PORT, () => console.log(`seureplay-web on http://localhost:${PORT}`));
