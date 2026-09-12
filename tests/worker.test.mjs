import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';

test('Worker fails closed for missing key, bad routes and disallowed origins', async () => {
  assert.equal((await worker.fetch(new Request('https://test/stations'), {})).status,503);
  assert.equal((await worker.fetch(new Request('https://test/events?station=../../bad'), {})).status,400);
  assert.equal((await worker.fetch(new Request('https://test/stations',{headers:{Origin:'https://other.test'}}), {})).status,403);
});
test('Worker forwards secret only in upstream header and prevents caching', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url,'https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations/0001/TidalEvents?duration=7');
    assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'test-secret');
    assert.equal(options.redirect,'manual');
    return Response.json([{EventType:'HighWater'}]);
  };
  try {
    const response = await worker.fetch(new Request('https://test/events?station=0001',{headers:{Origin:'https://benpostlethwaitesheff.github.io'}}),{ADMIRALTY_API_KEY:'test-secret'});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://benpostlethwaitesheff.github.io');
    assert.equal((await response.text()).includes('test-secret'),false);
  } finally { globalThis.fetch = original; }
});

