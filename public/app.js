const $ = (id) => document.getElementById(id);
const fields = { arena: $('arena'), court: $('court'), date: $('date'), timeRange: $('timeRange') };
const POLL_MS = 1500;

const STATUS_TEXT = {
  queued: () => 'Na fila, já começamos…',
  listing: () => 'Procurando vídeos…',
  downloading: (job) => `Baixando ${job.downloaded} de ${job.total} vídeos…`,
  merging: () => 'Juntando os vídeos…',
};

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Algo deu errado. Tente novamente.');
  return body;
}

function fillSelect(select, values, placeholder, label = (v) => v) {
  select.replaceChildren(
    new Option(placeholder, ''),
    ...values.map((value) => new Option(label(value), value)),
  );
  select.disabled = values.length === 0;
}

const formatDate = (iso) => iso.split('-').reverse().join('/');

function showMessage(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function updateSubmit() {
  $('submit').disabled = !Object.values(fields).every((select) => select.value);
}

async function loadArenas() {
  try {
    const { arenas } = await api('/api/filters');
    fillSelect(fields.arena, arenas, 'Escolha a arena');
  } catch (error) {
    fields.arena.replaceChildren(new Option('Indisponível', ''));
    showMessage(error.message);
  }
}

fields.arena.addEventListener('change', async () => {
  showMessage('');
  fillSelect(fields.court, [], fields.arena.value ? 'Carregando…' : 'Escolha a arena');
  fillSelect(fields.date, [], '—');
  fillSelect(fields.timeRange, [], '—');
  updateSubmit();
  if (!fields.arena.value) return;
  try {
    const { courts } = await api(`/api/filters?${new URLSearchParams({ arena: fields.arena.value })}`);
    fillSelect(fields.court, courts, courts.length ? 'Escolha a quadra' : 'Nenhuma quadra');
  } catch (error) {
    showMessage(error.message);
  }
});

fields.court.addEventListener('change', async () => {
  showMessage('');
  fillSelect(fields.date, [], fields.court.value ? 'Carregando…' : '—');
  fillSelect(fields.timeRange, [], '—');
  updateSubmit();
  if (!fields.court.value) return;
  try {
    const query = new URLSearchParams({ arena: fields.arena.value, court: fields.court.value });
    const { dates, timeRanges } = await api(`/api/filters?${query}`);
    fillSelect(fields.date, dates, dates.length ? 'Escolha a data' : 'Sem datas', formatDate);
    fillSelect(fields.timeRange, timeRanges, 'Escolha', (range) => range.replace('-', ' – '));
    if (!dates.length) showMessage('Essa quadra não tem replays nos últimos dias.');
  } catch (error) {
    showMessage(error.message);
  }
});

fields.date.addEventListener('change', updateSubmit);
fields.timeRange.addEventListener('change', updateSubmit);

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');
  const request = Object.fromEntries(Object.entries(fields).map(([key, select]) => [key, select.value]));
  setView('progress');
  renderProgress({ status: 'queued' });
  try {
    const { id } = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    await poll(id, request);
  } catch (error) {
    setView('form');
    showMessage(error.message);
  }
});

async function poll(id, request) {
  for (;;) {
    const job = await api(`/api/jobs/${id}`);
    if (job.status === 'done') return showResult(job);
    if (job.status === 'empty') {
      setView('form');
      const when = request.timeRange.replace('-', ' às ');
      return showMessage(`Nenhum vídeo encontrado em ${formatDate(request.date)} das ${when}.`);
    }
    if (job.status === 'error') throw new Error(job.message ?? 'Não foi possível gerar o vídeo.');
    renderProgress(job);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function renderProgress(job) {
  $('progressText').textContent = STATUS_TEXT[job.status]?.(job) ?? 'Processando…';
  const ratio = job.status === 'merging' ? 1 : job.total ? job.downloaded / job.total : 0;
  $('barFill').style.width = `${Math.round(ratio * 100)}%`;
}

function showResult(job) {
  $('resultText').textContent = `${job.total} ${job.total === 1 ? 'vídeo pronto' : 'vídeos prontos'}.`;
  $('videoLink').href = `/api/jobs/${job.id}/video`;
  $('zipLink').href = `/api/jobs/${job.id}/zip`;
  setView('result');
}

function setView(view) {
  $('form').hidden = view !== 'form';
  $('progress').hidden = view !== 'progress';
  $('result').hidden = view !== 'result';
}

$('again').addEventListener('click', () => setView('form'));

loadArenas();
