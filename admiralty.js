const API = 'https://sun-shade-tides.ben-postlethwaite05.workers.dev';

function distanceKm(latitude, longitude, coordinates) {
  const rad = Math.PI / 180;
  const [lon, lat] = coordinates;
  const h = Math.sin((lat - latitude) * rad / 2) ** 2 +
    Math.cos(latitude * rad) * Math.cos(lat * rad) * Math.sin((lon - longitude) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function nearestStation(data, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Enter valid coordinates.');
  }
  const stations = (data.features || []).filter(f =>
    /^[0-9]{4}[A-Za-z]?$/.test(f.properties?.Id || '') &&
    f.geometry?.type === 'Point' && f.geometry.coordinates?.length === 2 && f.geometry.coordinates.every(Number.isFinite))
    .map(f => ({id:f.properties.Id, name:f.properties.Name, distance:distanceKm(latitude, longitude, f.geometry.coordinates), footnote:f.properties.Footnote}));
  stations.sort((a, b) => a.distance - b.distance);
  if (!stations.length || stations[0].distance > 25) throw new Error('No ADMIRALTY station within 25 km. Select a coastal location.');
  return stations[0];
}

export function parseEvents(data) {
  if (!Array.isArray(data)) throw new Error('ADMIRALTY returned an unexpected response.');
  return data.filter(e => ['HighWater', 'LowWater'].includes(e.EventType)).map(e => ({
    // ADMIRALTY timestamps without an offset are GMT, even during British Summer Time.
    time: new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(e.DateTime) ? e.DateTime : e.DateTime + 'Z'),
    height:e.Height, type:e.EventType === 'HighWater' ? 'High' : 'Low',
    approximateTime:Boolean(e.IsApproximateTime), approximateHeight:Boolean(e.IsApproximateHeight),
  })).filter(e => Number.isFinite(e.time.getTime()) && Number.isFinite(e.height)).sort((a,b) => a.time-b.time);
}

async function request(path, signal) {
  const response = await fetch(API + path, {cache:'no-store', signal});
  if (!response.ok) throw new Error(response.status === 429 ? 'ADMIRALTY allowance reached. Please try later.' : 'ADMIRALTY tide times are unavailable. Please retry.');
  return response.json();
}

// Keep only the currently displayed response in the DOM; no prediction cache or local storage.
let activeRequest;
export async function updateAdmiraltyPanel({latitude, longitude, date, tideEnabled}) {
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const status = document.getElementById('admiraltyStatus');
  const list = document.getElementById('admiraltyEvents');
  const source = document.getElementById('admiraltySource');
  list.replaceChildren(); source.textContent = '';
  status.textContent = tideEnabled ? 'Loading local ADMIRALTY predictions…' : 'Tide data is turned off.';
  if (!tideEnabled) return;
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const station = nearestStation(await request('/stations', controller.signal), Number(latitude), Number(longitude));
    const events = parseEvents(await request('/events?station=' + encodeURIComponent(station.id), controller.signal));
    if (activeRequest !== controller) return;
    const start = new Date(date + 'T00:00:00');
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const day = events.filter(e => e.time >= start && e.time < end);
    const clock = d => d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', hour12:false});
    status.textContent = `${station.name} · ${station.distance.toFixed(1)} km away · ${start.toLocaleDateString('en-GB')} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    if (!day.length) {
      const item = document.createElement('li');
      item.textContent = 'No events available for this day. Discovery covers today and the next six days.';
      list.append(item);
    }
    for (const event of day) {
      const item = document.createElement('li');
      const label = document.createElement('span'); label.textContent = `${event.type} tide`;
      const time = document.createElement('strong'); time.textContent = `${event.approximateTime ? '≈ ' : ''}${clock(event.time)}`;
      const height = document.createElement('span'); height.textContent = `${event.approximateHeight ? '≈ ' : ''}${event.height.toFixed(2)} m`;
      item.append(label, time, height); list.append(item);
    }
    const link = document.createElement('a');
    link.href = 'https://easytide.admiralty.co.uk/?PortID=' + encodeURIComponent(station.id);
    link.textContent = `View ${station.name} on ADMIRALTY EasyTide`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    source.append(link);
    if (station.footnote) source.append(document.createTextNode(' · ' + station.footnote));
  } catch (error) {
    if (activeRequest !== controller) return;
    status.textContent = controller.signal.aborted ? 'ADMIRALTY request timed out. Please retry.' : error.message;
  } finally { clearTimeout(timer); }
}
