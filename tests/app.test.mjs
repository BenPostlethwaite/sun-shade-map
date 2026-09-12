import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as solar from '../solar.js';
import * as tides from '../tides.js';

test('Jump to now updates selection; chart backing store follows display pixel density', () => {
  const elements = new Map();
  const context = new Proxy({}, {get: (o,k) => o[k] || (k === 'measureText' ? () => ({width:90}) : k.startsWith('create') ? () => ({addColorStop(){}}) : () => {}), set:(o,k,v) => {o[k]=v; return true;}});
  const make = () => ({value:'', width:960, height:960, clientWidth:600, clientHeight:320,
    style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    handlers:{}, addEventListener(k,fn){this.handlers[k]=fn;}, click(){this.handlers.click?.();},
    append(){},appendChild(){},replaceChildren(){},setAttribute(){}, getContext(){return context;},
    getBoundingClientRect(){return {width:600,height:320,left:0,top:0};}});
  const document = {hidden:false, body:make(),createElement:make,querySelector:make,
    getElementById(id){if(!elements.has(id)) elements.set(id,make()); return elements.get(id);}};
  const saved = JSON.stringify({date:'2020-01-01',time:'01:00',tideEnabled:false});
  const localStorage = {getItem(){return saved;},setItem(){}};
  const window = {devicePixelRatio:2,addEventListener(){}};
  const source = readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/import[\s\S]*?from '[^']+';/g,'');
  const dependencies = {updateAdmiraltyPanel(){},...solar,...tides,document,localStorage,window,navigator:{},ResizeObserver:class{observe(){}},setInterval(){}};
  new Function(...Object.keys(dependencies), source)(...Object.values(dependencies));
  document.getElementById('tideNowButton').click();
  assert.equal(document.getElementById('dateInput').value, tides.localDateString(new Date()));
  assert.equal(document.getElementById('timeInput').value, new Date().toTimeString().slice(0,5));
  assert.equal(document.getElementById('tideCanvas').width,1200);
  assert.equal(document.getElementById('tideCanvas').height,640);
});
