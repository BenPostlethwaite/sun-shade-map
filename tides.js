const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
const cache = new Map();

export function localDateString(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

// The provider returns a nearby ocean model cell, not a tide gauge station.
export async function getNearestTideStation(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Enter valid latitude and longitude coordinates.');
  }
  return { id: latitude + ',' + longitude, latitude, longitude,
    name: 'Near ' + latitude.toFixed(3) + ', ' + longitude.toFixed(3) };
}

export async function getTidePredictions(locationId, date) {
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid date.');
  const key = locationId + ':' + localDateString(date);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.created < 30 * 60 * 1000) return cached.promise;
  const promise = fetchPredictions(locationId, date);
  cache.set(key, { created: Date.now(), promise });
  try { return await promise; }
  catch (error) { cache.delete(key); throw error; }
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

async function fetchPredictions(locationId, date, originalLocation = null) {
  const [latitude, longitude] = locationId.split(',').map(Number);
  await getNearestTideStation(latitude, longitude);
  // Include both midnight boundaries and neighbours for detecting extrema.
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const from = new Date(start.getTime() - 3600000);
  const until = new Date(end.getTime() + 12 * 3600000);
  const params = new URLSearchParams({ latitude, longitude,
    hourly: 'sea_level_height_msl', timezone: 'GMT', timeformat: 'unixtime',
    cell_selection: 'sea', start_date: from.toISOString().slice(0, 10),
    end_date: until.toISOString().slice(0, 10) });
  let response;
  try { response = await fetch(MARINE_API + '?' + params, { signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Unable to reach the tide forecast service. Check your connection and retry.'); }
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(response.status === 429 ? 'Tide service is busy. Please try again shortly.' :
      'Tide forecast unavailable for this date. Try today or a date in the next few days.');
  }
  const times = data.hourly?.time;
  const heights = data.hourly?.sea_level_height_msl;
  if (!Array.isArray(times) || !Array.isArray(heights)) throw new Error('No sea-level forecast returned for this location.');
  const predictions = times.map((time, i) => ({ time: new Date(time * 1000), height: heights[i] }))
    .filter(p => Number.isFinite(p.time.getTime()) && Number.isFinite(p.height));
  const requested = originalLocation || { latitude, longitude };
  const cell = { latitude: data.latitude, longitude: data.longitude };
  const validCell = Number.isFinite(cell.latitude) && Number.isFinite(cell.longitude);
  const distance = validCell ? distanceKm(requested, cell) : null;
  // Best-match can return a sea coordinate but null tide values for a land input.
  // Retry that returned coordinate once, never substitute a distant ocean point.
  if (!predictions.length && !originalLocation && validCell && distance > 0.1 && distance <= 25) {
    return fetchPredictions(`${cell.latitude},${cell.longitude}`, date, requested);
  }
  if (distance !== null && distance > 25) {
    throw new Error('The available sea forecast is over 25 km away. Select a coastal location for tide estimates.');
  }
  // Never draw a fabricated flat curve for an inland location or missing day.
  const day = predictions.filter(p => p.time >= start && p.time <= end);
  if (day.length < 2 || day[0].time > start || day.at(-1).time < end ||
      day.some((p, i) => i > 0 && p.time - day[i - 1].time > 3600000)) {
    throw new Error('No complete coastal forecast for this location and date. Choose a coastal location or another day.');
  }
  predictions.forecastLocation = validCell ? {
    ...cell, distanceKm: distance, nearby: Boolean(originalLocation),
    name: `Sea forecast ${cell.latitude.toFixed(3)}, ${cell.longitude.toFixed(3)} (${distance.toFixed(1)} km away)`,
  } : null;
  return predictions;
}

/**
 * Find high and low tide times and heights for a given day
 */
export function findHighLowTides(predictions) {
  if (!predictions || predictions.length < 2) {
    return { highTides: [], lowTides: [] };
  }

  const highTides = [];
  const lowTides = [];

  for (let i = 1; i < predictions.length - 1; i++) {
    const prev = predictions[i - 1].height;
    const current = predictions[i].height;
    const next = predictions[i + 1].height;

    // High tide: current is greater than both neighbors
    if (current > prev && current >= next && predictions.slice(i + 1).find(p => p.height !== current)?.height < current) {
      highTides.push({
        time: predictions[i].time,
        height: current,
      });
    }

    // Low tide: current is less than both neighbors
    if (current < prev && current <= next && predictions.slice(i + 1).find(p => p.height !== current)?.height > current) {
      lowTides.push({
        time: predictions[i].time,
        height: current,
      });
    }
  }

  return { highTides, lowTides };
}

/**
 * Calculate current tide height and status for a specific time
 */
export function calculateCurrentTideHeight(dateTime, predictions) {
  if (!predictions || predictions.length === 0) {
    return { height: null, status: 'unknown', percentage: 0 };
  }

  // Find the two predictions that bracket the current time
  let lower = null;
  let upper = null;

  for (let i = 0; i < predictions.length - 1; i++) {
    if (predictions[i].time <= dateTime && dateTime <= predictions[i + 1].time) {
      lower = predictions[i];
      upper = predictions[i + 1];
      break;
    }
  }

  if (!lower || !upper) {
    return {
      height: null,
      status: 'unknown',
      percentage: 0,
    };
  }

  // Linear interpolation between the two predictions
  const timeFraction = (dateTime - lower.time) / (upper.time - lower.time);
  const height = lower.height + (upper.height - lower.height) * timeFraction;

  // Determine if tide is rising or falling
  const status = upper.height === lower.height ? 'steady' : upper.height > lower.height ? 'rising' : 'falling';

  // Calculate percentage relative to today's min and max
  const heights = predictions.map(p => p.height);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const range = maxHeight - minHeight;
  const percentage = range > 0 ? ((height - minHeight) / range) * 100 : 50;

  return { height, status, percentage };
}

/**
 * Get the next high or low tide relative to a given time
 */
export function getNextTideChange(dateTime, predictions) {
  const { highTides, lowTides } = findHighLowTides(predictions);
  const allTides = [
    ...highTides.map(t => ({ ...t, type: 'high' })),
    ...lowTides.map(t => ({ ...t, type: 'low' })),
  ].sort((a, b) => a.time - b.time);

  const nextTide = allTides.find(t => t.time > dateTime);
  return nextTide || null;
}

/**
 * Format a Date to clock time (HH:MM)
 */
export function formatClockTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

/**
 * Get tide statistics for the day
 */
export function getTideStats(predictions) {
  if (!predictions || predictions.length === 0) {
    return {
      minHeight: null,
      maxHeight: null,
      range: null,
    };
  }

  const heights = predictions.map(p => p.height);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);

  return {
    minHeight,
    maxHeight,
    range: maxHeight - minHeight,
  };
}

export const getTideStations = getNearestTideStation;
export const getTideData = getTidePredictions;
export const calculateTideHeight = calculateCurrentTideHeight;
export const formatTideTime = formatClockTime;

export function getTideStatus(percentage, trend = 'unknown') {
  if (!Number.isFinite(percentage)) {
    return 'Tide data unavailable';
  }

  const band = percentage < 33 ? 'Low tide' : percentage > 66 ? 'High tide' : 'Mid tide';
  const direction = trend === 'rising' ? 'rising' : trend === 'falling' ? 'falling' : 'steady';

  return `${band} · ${direction}`;
}
