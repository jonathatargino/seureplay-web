# seureplay-web

Tiny site that downloads every replay of one court on one day from seureplay.com.br
and hands it back as a single merged MP4, or as a zip with the separate clips.

Node.js (Express) backend + plain HTML/CSS/JS frontend in `public/`. Requires Node 22+ and `ffmpeg`.

## Run

```sh
npm install
cp .env.example .env    # fill in SEUREPLAY_EMAIL and SEUREPLAY_PASSWORD; .env is git-ignored
npm start               # http://localhost:3000
npm test
```

`npm start` loads `.env` when present; plain environment variables work too.
Credentials live only on the machine running the server: never commit them, and GitHub
repository secrets would not help (they are visible only to GitHub Actions, not to your server).

## Exposing it to friends

The server only listens on `PORT`. To reach it from the internet, put an HTTPS tunnel in front of it,
for example [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) (fixed `*.ts.net` URL) or a
Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`, random URL per run).
Avoid ngrok's free plan: its monthly bandwidth cap is smaller than a couple of downloads.

**The site has no access control**: anyone with the URL uses the configured seureplay account.

| Env var | Default | Meaning |
| --- | --- | --- |
| `SEUREPLAY_EMAIL`, `SEUREPLAY_PASSWORD` | required | seureplay.com.br account used to log in |
| `PORT` | `3000` | HTTP port |
| `WORK_DIR` | `./work` | where clips and merged files live (wiped on startup) |
| `JOB_TTL_MINUTES` | `60` | files of a finished job are deleted after this |
| `MIN_FREE_GB` | `10` | a job refuses to start below this free disk space |

## How it works

1. `GET /api/filters?arena=&court=` returns the options of the site's own filter form
   (arenas; courts of an arena; dates and time ranges of a court).
2. `POST /api/jobs {arena, court, date, timeRange}` validates against those options and queues a job.
   `timeRange` is required: whole-day downloads are refused on purpose (`src/validate.js`).
   An identical pending or finished request reuses its job.
3. The job lists every page of `/replays`, streams each clip to disk (3 in parallel),
   then joins them with `ffmpeg -f concat -c copy` (no re-encoding).
   Status: `queued → listing → downloading → merging → done | empty | error`.
4. `GET /api/jobs/:id` is polled by the page; `GET /api/jobs/:id/video` serves the merged MP4 and
   `GET /api/jobs/:id/zip` streams an uncompressed zip of the clips.

## Memory and disk

- Clips are never held in memory: HTTP bodies are piped straight to files, ffmpeg copies packets
  without decoding, and both downloads are streamed from disk. Measured on a full day
  (86 clips, 2 GB): server RSS stayed at ~265 MB in every phase (166 MB idle).
- Disk is the real limit: a job needs ~2× the clips' size (clips + merged file); one busy hour
  (~30 clips) is about 1.5 GB.
  Jobs run one at a time, refuse to start below `MIN_FREE_GB`, and are deleted after `JOB_TTL_MINUTES`.
- Jobs live in memory: restarting the server forgets them and wipes `WORK_DIR`.

## Notes

- Login posts the site's form directly; its reCAPTCHA v3 is not enforced server-side (checked 2026-11-09).
  If that changes, login fails with a clear error.
- The site keeps about 5 days of replays.
