import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginRequired, parseFilters, parseReplays } from '../src/parse.js';

const BASE = 'https://seureplay.com.br/replays?arena=North%20Park&amp;court=Quadra%206&amp;date=2026-11-06';

const videoBlock = (name) => {
  const path = `/Aplicativos/Seu Replay/North Park/Quadra 6/${name}`;
  return `
  <div class="swiper-slide"><div class="modal__content">
    <video><source src="https://x.dl.dropboxusercontent.com/cd/0/get/abc/file" type="video/mp4"></video>
    <div class="courts__bottom">
      <a href="https://seureplay.com.br/video/download/${path.replaceAll(' ', '%20')}" class="download-btn">Download</a>
    </div>
  </div></div>`;
};

const replaysPage = (names, nextPage) => `<html><body>
  <form method="POST" action="https://seureplay.com.br/logout"><button>Sair</button></form>
  <select name="arena" id="selectedArena">
    <option value="">Todas as arenas</option>
    <option value="4Play">4Play</option>
    <option value="North Park" selected>North Park</option>
  </select>
  <select name="court" id="selectedCourt">
    <option value="">Todas as quadras</option>
    <option value="Quadra 1">Quadra 1</option>
    <option value="Quadra 6" selected>Quadra 6</option>
  </select>
  <select name="date" id="selectedDate">
    <option value="">Todas as datas</option>
    <option value="2026-11-09">
        09/11/2026
    </option>
    <option value="2026-11-06" selected>06/11/2026</option>
  </select>
  <select name="time_range" id="selectedTimeRange">
    <option value="">Todos os horários</option>
    <option value="18:00-19:00">18:00 - 19:00</option>
    <option value="19:00-20:00" selected>19:00 - 20:00</option>
  </select>
  ${names.map(videoBlock).join('')}
  <ul class="pagination"><li>${
    nextPage ? `<a href="${BASE}&amp;page=${nextPage}" class="next"><i></i></a>` : '<span class="next disabled"></span>'
  }</li></ul>
</body></html>`;

const LOGIN_PAGE = `<html><body><form method="POST" action="https://seureplay.com.br/login">
<input type="hidden" name="_token" value="abc"><input type="email" name="email"><input type="password" name="password">
</form></body></html>`;

test('parseReplays extracts download URLs and decoded filenames', () => {
  const page = parseReplays(replaysPage(['Quadra 6_06_11_19h59_32.mp4', 'Quadra 6_06_11_19h38_53.mp4'], null));
  assert.deepEqual(page.videos, [
    {
      url: 'https://seureplay.com.br/video/download//Aplicativos/Seu%20Replay/North%20Park/Quadra%206/Quadra%206_06_11_19h59_32.mp4',
      filename: 'Quadra 6_06_11_19h59_32.mp4',
    },
    {
      url: 'https://seureplay.com.br/video/download//Aplicativos/Seu%20Replay/North%20Park/Quadra%206/Quadra%206_06_11_19h38_53.mp4',
      filename: 'Quadra 6_06_11_19h38_53.mp4',
    },
  ]);
});

test('parseReplays returns the next page URL, unescaped', () => {
  const page = parseReplays(replaysPage(['a_06_11_19h00_00.mp4'], 2));
  assert.equal(
    page.nextUrl,
    'https://seureplay.com.br/replays?arena=North%20Park&court=Quadra%206&date=2026-11-06&page=2',
  );
});

test('parseReplays returns no next page on the last page', () => {
  assert.equal(parseReplays(replaysPage(['a_06_11_19h00_00.mp4'], null)).nextUrl, null);
});

test('parseReplays on an empty listing returns no videos', () => {
  assert.deepEqual(parseReplays(replaysPage([], null)).videos, []);
});

test('parseFilters lists the site options, skipping the "all" placeholder', () => {
  assert.deepEqual(parseFilters(replaysPage([], null)), {
    arenas: ['4Play', 'North Park'],
    courts: ['Quadra 1', 'Quadra 6'],
    dates: ['2026-11-09', '2026-11-06'],
    timeRanges: ['18:00-19:00', '19:00-20:00'],
  });
});

test('parsing the login page throws LoginRequired', () => {
  assert.throws(() => parseReplays(LOGIN_PAGE), LoginRequired);
  assert.throws(() => parseFilters(LOGIN_PAGE), LoginRequired);
});
