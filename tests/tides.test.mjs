import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTidePredictions, getNearestTideStation, calculateCurrentTideHeight, findHighLowTides, localDateString } from '../tides.js';

test('Pages artifact includes every local module imported by app.js', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  for (const [, file] of app.matchAll(/from '\.\/(.+?)'/g)) assert.ok(workflow.includes(file), file);
});

test('forecast uses coordinates, UTC timestamps, and coalesces requests', async () => {
  const original = globalThis.fetch;
  const date = new Date(2026, 8, 9, 14);
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('latitude'), '50.15');
    assert.equal(params.get('hourly'), 'sea_level_height_msl');
    assert.equal(params.get('timeformat'), 'unixtime');
    const start = Date.parse(params.get('start_date') + 'T00:00:00Z');
    return { ok: true, json: async () => ({ hourly: {
      time: Array.from({length: 96}, (_, i) => start / 1000 + i * 3600),
      sea_level_height_msl: Array.from({length: 96}, (_, i) => Math.sin(i / 2)),
    } }) };
  };
  try {
    const [a, b] = await Promise.all([getTidePredictions('50.15,-5.07', date), getTidePredictions('50.15,-5.07', date)]);
    assert.equal(calls, 1); assert.equal(a, b);
    assert.equal(localDateString(date), '2026-09-09');
    assert.ok(Number.isFinite(calculateCurrentTideHeight(date, a).height));
  } finally { globalThis.fetch = original; }
});

test('null sea-level data is unavailable, never converted to zero; failures can retry', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return {ok: true, json: async () => ({hourly: {time: [1,2], sea_level_height_msl: [null,null]}})}; };
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(getTidePredictions('53,-1', new Date(2026,8,9)), /No complete coastal forecast/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('invalid coordinates fail before a request', async () => {
  await assert.rejects(getNearestTideStation(91, 0), /valid latitude/);
});

test('plateaus produce one extremum and out-of-range heights are unavailable', () => {
  const predictions = [0,2,2,0,-2,-2,0].map((height, i) => ({time:new Date(i * 3600000), height}));
  const extrema = findHighLowTides(predictions);
  assert.equal(extrema.highTides.length, 1);
  assert.equal(extrema.lowTides.length, 1);
  assert.equal(calculateCurrentTideHeight(new Date(-1), predictions).height, null);
  assert.equal(calculateCurrentTideHeight(new Date(5400000), predictions).status, 'steady');
});
