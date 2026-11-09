import * as cheerio from 'cheerio';

/** The site answered with its login form: the session is missing or expired. */
export class LoginRequired extends Error {
  constructor() {
    super('seureplay.com.br asked for login');
    this.name = 'LoginRequired';
  }
}

function load(html) {
  const $ = cheerio.load(html);
  if ($('input[type="password"]').length) throw new LoginRequired();
  return $;
}

const optionValues = ($, selectId) =>
  $(`#${selectId} option`)
    .map((_, el) => $(el).attr('value'))
    .get()
    .filter(Boolean);

/** Filter options exactly as the site's /replays page offers them. */
export function parseFilters(html) {
  const $ = load(html);
  return {
    arenas: optionValues($, 'selectedArena'),
    courts: optionValues($, 'selectedCourt'),
    dates: optionValues($, 'selectedDate'),
    timeRanges: optionValues($, 'selectedTimeRange'),
  };
}

/** Clips listed on one /replays page, plus the URL of the next page (or null). */
export function parseReplays(html) {
  const $ = load(html);
  const videos = $('a.download-btn[href]')
    .map((_, el) => {
      const url = $(el).attr('href');
      return { url, filename: decodeURIComponent(url.split('/').pop()) };
    })
    .get();
  return { videos, nextUrl: $('.pagination a.next[href]').attr('href') ?? null };
}

export function parseCsrfToken(html) {
  const token = cheerio.load(html)('input[name="_token"]').attr('value');
  if (!token) throw new Error('Login form without _token: the seureplay login page changed');
  return token;
}
