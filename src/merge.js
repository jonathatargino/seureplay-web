import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CLIP_TIME = /_(\d{2})h(\d{2})_(\d{2})\.mp4$/;

function clipTime(path) {
  const match = CLIP_TIME.exec(path);
  if (!match) throw new Error(`Unexpected clip filename (no _HHhMM_SS.mp4 suffix): ${path}`);
  return match.slice(1).join('');
}

/** ffmpeg concat-demuxer input: clips in chronological order, absolute and quote-escaped. */
export function concatList(files) {
  return files
    .map((file) => ({ file: resolve(file), time: clipTime(file) }))
    .sort((a, b) => a.time.localeCompare(b.time))
    .map(({ file }) => `file '${file.replaceAll("'", "'\\''")}'\n`)
    .join('');
}

/**
 * Joins the clips without re-encoding (-c copy): ffmpeg only copies packets,
 * so memory stays flat no matter how large the clips are.
 */
export async function mergeClips(files, output) {
  const listPath = `${output}.txt`;
  await writeFile(listPath, concatList(files));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output];
  await new Promise((resolvePromise, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)),
    );
  });
}
