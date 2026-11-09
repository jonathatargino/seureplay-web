import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concatList } from '../src/merge.js';

test('concatList orders clips by their HHhMM_SS time and escapes quotes', () => {
  assert.equal(
    concatList([
      '/work/Quadra 6_06_11_19h59_32.mp4',
      '/work/Quadra 6_06_11_05h10_00.mp4',
      "/work/it's_06_11_19h38_53.mp4",
    ]),
    "file '/work/Quadra 6_06_11_05h10_00.mp4'\n" +
      "file '/work/it'\\''s_06_11_19h38_53.mp4'\n" +
      "file '/work/Quadra 6_06_11_19h59_32.mp4'\n",
  );
});

test('concatList makes relative paths absolute (ffmpeg resolves them against the list file)', () => {
  assert.equal(concatList(['work/a_06_11_19h00_00.mp4']), `file '${process.cwd()}/work/a_06_11_19h00_00.mp4'\n`);
});

test('concatList rejects filenames without a clip time', () => {
  assert.throws(() => concatList(['/work/random.mp4']), /random\.mp4/);
});
