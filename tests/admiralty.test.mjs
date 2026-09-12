import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nearestStation, parseEvents} from '../admiralty.js';

test('nearest station uses GeoJSON longitude-first coordinates and rejects distant ports', () => {
  const data = {features:[
    {geometry:{type:'Point',coordinates:[-1.4,50.883333]},properties:{Id:'0062',Name:'SOUTHAMPTON'}},
    {geometry:{type:'Point',coordinates:[-5,50]},properties:{Id:'0001',Name:'Other'}},
  ]};
  assert.equal(nearestStation(data,50.924618,-1.3737).id,'0062');
  assert.ok(nearestStation(data,50.924618,-1.3737).distance < 5);
  assert.throws(() => nearestStation(data,53,-1),/within 25 km/);
  assert.throws(() => nearestStation(data,NaN,-1),/valid coordinates/);
});

test('GMT event timestamps preserve minutes and provider approximation flags', () => {
  const events = parseEvents([
    {EventType:'HighWater',DateTime:'2026-09-12T11:37:00',Height:4.625,IsApproximateTime:true},
    {EventType:'LowWater',DateTime:'2026-09-12T04:54:00Z',Height:0.4},
    {EventType:'HighWater',DateTime:'invalid',Height:2},
    {EventType:'LowWater',DateTime:'2026-09-12T04:54:00',Height:null},
  ]);
  assert.equal(events.length,2);
  assert.equal(events[1].time.toISOString(),'2026-09-12T11:37:00.000Z');
  assert.equal(events[1].time.toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'}),'12:37');
  assert.equal(events[1].approximateTime,true);
});
