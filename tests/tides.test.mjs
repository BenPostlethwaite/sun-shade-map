import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTidePredictions, getNearestTideStation, calculateCurrentTideHeight, findHighLowTides, localDateString } from '../tides.js';

test('Pages artifact includes every local module imported by app.js', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  for (const [, file] of app.matchAll(/from '\.\/(.+?)'/g)) assert.ok(workflow.includes(file.split('?')[0]), file);
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

test('smooth interpolation preserves data points and stays bounded between each pair', () => {
  const predictions = [0, 2, 1, -3, -3, 1].map((height, i) => ({time: new Date(i * 3600000), height}));
  for (let i = 0; i < predictions.length - 1; i++) {
    let previous = predictions[i].height;
    for (let minute = 0; minute <= 60; minute++) {
      const value = calculateCurrentTideHeight(new Date((i * 60 + minute) * 60000), predictions).height;
      const low = Math.min(predictions[i].height, predictions[i + 1].height);
      const high = Math.max(predictions[i].height, predictions[i + 1].height);
      assert.ok(value >= low - 1e-10 && value <= high + 1e-10);
      assert.ok((value - previous) * (predictions[i + 1].height - predictions[i].height) >= -1e-10);
      previous = value;
    }
    assert.equal(calculateCurrentTideHeight(predictions[i].time, predictions).height, predictions[i].height);
  }
  assert.notEqual(calculateCurrentTideHeight(new Date(1800000), predictions).height, 1);
});

test('missing land data retries the returned nearby sea point and labels its distance', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    const params = new URL(url).searchParams;
    calls++;
    if (calls === 2) assert.equal(params.get('latitude'), '49.9');
    const start = Date.parse(params.get('start_date') + 'T00:00:00Z');
    return {ok: true, json: async () => ({latitude: 49.9, longitude: 0, hourly: {
      time: Array.from({length: 96}, (_, i) => start / 1000 + i * 3600),
      sea_level_height_msl: Array.from({length: 96}, (_, i) => calls === 1 ? null : Math.sin(i)),
    }})};
  };
  try {
    const result = await getTidePredictions('50,0', new Date(2026,8,9));
    assert.equal(calls, 2);
    assert.equal(result.forecastLocation.nearby, true);
    assert.match(result.forecastLocation.name, /11.1 km away/);
  } finally { globalThis.fetch = original; }
});

test('distant sea cells are rejected without a fallback request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return {ok: true, json: async () => ({latitude: 45, longitude: 0,
    hourly: {time: [1,2], sea_level_height_msl: [null,null]}})}; };
  try {
    await assert.rejects(getTidePredictions('51,0', new Date(2026,8,9)), /over 25 km/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('plateaus produce one extremum and out-of-range heights are unavailable', () => {
  const predictions = [0,2,2,0,-2,-2,0].map((height, i) => ({time:new Date(i * 3600000), height}));
  const extrema = findHighLowTides(predictions);
  assert.equal(extrema.highTides.length, 1);
  assert.equal(extrema.lowTides.length, 1);
  assert.equal(calculateCurrentTideHeight(new Date(-1), predictions).height, null);
  assert.equal(calculateCurrentTideHeight(new Date(5400000), predictions).status, 'steady');
});
