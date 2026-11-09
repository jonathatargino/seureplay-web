import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJobRequest } from '../src/validate.js';

const ARENAS = ['North Park'];
const COURT_FILTERS = { courts: ['Quadra 6'], dates: ['2026-11-06'], timeRanges: ['19:00-20:00'] };
const VALID = { arena: 'North Park', court: 'Quadra 6', date: '2026-11-06', timeRange: '19:00-20:00' };

test('accepts values the site offers', () => {
  assert.equal(validateJobRequest(VALID, ARENAS, COURT_FILTERS), null);
});

test('rejects a request without a time range (no whole-day downloads)', () => {
  assert.match(validateJobRequest({ ...VALID, timeRange: '' }, ARENAS, COURT_FILTERS), /horário/);
  assert.match(validateJobRequest({ ...VALID, timeRange: undefined }, ARENAS, COURT_FILTERS), /horário/);
});

test('rejects values the site does not offer', () => {
  for (const field of ['arena', 'court', 'date', 'timeRange']) {
    assert.ok(validateJobRequest({ ...VALID, [field]: 'nope' }, ARENAS, COURT_FILTERS), field);
  }
});
