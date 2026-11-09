import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LoginRequired, parseCsrfToken, parseFilters, parseReplays } from './parse.js';

const ORIGIN = 'https://seureplay.com.br';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0';
const MAX_PAGES = 200;
const FILTERS_TTL_MS = 10 * 60 * 1000;

/** Logged-in client for seureplay.com.br. Logs in lazily and again when the session expires. */
export class SeuReplaySite {
  #cookies = new Map();
  #loggingIn = null;
  #filtersCache = new Map();

  constructor({ email, password }) {
    this.email = email;
    this.password = password;
  }

  /** Filter options for the given arena/court, as the site's own form shows them. */
  async filters({ arena = '', court = '' } = {}) {
    const key = `${arena}\n${court}`;
    const cached = this.#filtersCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await this.#withLogin(async () => parseFilters(await this.#html(replaysUrl({ arena, court }))));
    this.#filtersCache.set(key, { value, expires: Date.now() + FILTERS_TTL_MS });
    return value;
  }

  /** Every clip of the court/day (optionally one time range), following the pagination. */
  async listVideos({ arena, court, date, timeRange }) {
    return this.#withLogin(async () => {
      const videos = new Map();
      let url = replaysUrl({ arena, court, date, time_range: timeRange });
      for (let pages = 0; url; pages += 1) {
        if (pages >= MAX_PAGES) throw new Error(`More than ${MAX_PAGES} pages for one listing: aborting`);
        const page = parseReplays(await this.#html(url));
        page.videos.forEach((video) => videos.set(video.url, video));
        url = page.nextUrl;
      }
      return [...videos.values()];
    });
  }

  /** Streams one clip straight to disk (never buffered in memory); writes to .part then renames. */
  async download(video, dest) {
    await this.#withLogin(async () => {
      // the signal also bounds reading the body, so allow minutes for a ~25 MB clip
      const response = await this.#fetch(video.url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${video.filename}`);
      if (response.headers.get('content-type')?.startsWith('text/html')) {
        await response.body?.cancel();
        throw new LoginRequired();
      }
      const part = `${dest}.part`;
      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
        await rename(part, dest);
      } catch (error) {
        await rm(part, { force: true });
        throw error;
      }
    });
  }

  async #withLogin(fn) {
    if (this.#cookies.size === 0) await this.#login();
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof LoginRequired)) throw error;
      await this.#login();
      return fn();
    }
  }

  #login() {
    this.#loggingIn ??= (async () => {
      this.#cookies.clear();
      const token = parseCsrfToken(await this.#html(`${ORIGIN}/login`));
      const response = await this.#fetch(`${ORIGIN}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${ORIGIN}/login` },
        body: new URLSearchParams({ _token: token, email: this.email, password: this.password, remember: 'on' }),
      });
      const location = response.headers.get('location') ?? '';
      if (response.status !== 302 || location.replace(/\/$/, '').endsWith('/login')) {
        throw new Error('Login on seureplay.com.br failed: check SEUREPLAY_EMAIL/SEUREPLAY_PASSWORD');
      }
    })().finally(() => {
      this.#loggingIn = null;
    });
    return this.#loggingIn;
  }

  async #html(url) {
    const response = await this.#fetch(url);
    if (!response.ok) throw new Error(`seureplay.com.br answered ${response.status} for ${url}`);
    return response.text();
  }

  async #fetch(url, init = {}) {
    const cookie = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(cookie && { Cookie: cookie }), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      this.#cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  }
}

function replaysUrl(query) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  return `${ORIGIN}/replays?${params}`;
}
