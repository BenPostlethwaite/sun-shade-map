const NOAA_API_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const STATIONS_API = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';

// Cache for tide stations and predictions to reduce API calls
const tideCache = {
  stations: new Map(),
  predictions: new Map(),
  allStations: null,
};

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function distanceKm(latA, lonA, latB, lonB) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest NOAA tide station to a given location
 */
export async function getNearestTideStation(latitude, longitude) {
  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  
  if (tideCache.stations.has(cacheKey)) {
    return tideCache.stations.get(cacheKey);
  }

  try {
    const response = await fetch(STATIONS_API);

    if (!response.ok) {
      throw new Error(`Station lookup failed with ${response.status}`);
    }

    const data = await response.json();
    const stations = Array.isArray(data?.stations) ? data.stations : [];

    if (stations.length === 0) {
      console.warn('No tide stations found nearby');
      return null;
    }

    if (!Array.isArray(tideCache.allStations)) {
      tideCache.allStations = stations
        .map((entry) => ({
          id: entry.id ?? entry.stationId ?? entry.station_id,
          name: entry.name ?? entry.stationName ?? 'Unknown station',
          latitude: Number(entry.lat ?? entry.latitude),
          longitude: Number(entry.lng ?? entry.lon ?? entry.longitude),
        }))
        .filter((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude) && entry.id);
    }

    const station = tideCache.allStations
      .map((entry) => ({
        ...entry,
        distanceKm: distanceKm(latitude, longitude, entry.latitude, entry.longitude),
      }))
      .sort((left, right) => left.distanceKm - right.distanceKm)[0];

    if (!station) {
      return null;
    }

    const result = {
      id: station.id,
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
    };

    tideCache.stations.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error fetching tide stations:', error);
    return null;
  }
}

/**
 * Fetch tide predictions for a given station and date
 */
export async function getTidePredictions(stationId, date) {
  const dateStr = date.toISOString().split('T')[0];
  const cacheKey = `${stationId}-${dateStr}`;

  if (tideCache.predictions.has(cacheKey)) {
    return tideCache.predictions.get(cacheKey);
  }

  try {
    // Get predictions for the day (hourly)
    const response = await fetch(
      `${NOAA_API_BASE}?station=${stationId}&begin_date=${dateStr.replace(/-/g, '')}&end_date=${dateStr.replace(/-/g, '')}&product=predictions&datum=MLLW&units=metric&time_zone=gmt&format=json`
    );

    if (!response.ok) {
      throw new Error(`Prediction lookup failed with ${response.status}`);
    }

    const data = await response.json();

    if (!data.predictions || data.predictions.length === 0) {
      console.warn(`No tide predictions for station ${stationId}`);
      return null;
    }

    const predictions = data.predictions.map(p => ({
      time: new Date(`${String(p.t).replace(' ', 'T')}Z`),
      height: parseFloat(p.v),
    }));

    tideCache.predictions.set(cacheKey, predictions);
    return predictions;
  } catch (error) {
    console.error('Error fetching tide predictions:', error);
    return null;
  }
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
    if (current > prev && current > next) {
      highTides.push({
        time: predictions[i].time,
        height: current,
      });
    }

    // Low tide: current is less than both neighbors
    if (current < prev && current < next) {
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
    // Use the closest prediction if we're outside the range
    const closest = predictions.reduce((prev, curr) =>
      Math.abs(curr.time - dateTime) < Math.abs(prev.time - dateTime) ? curr : prev
    );
    return {
      height: closest.height,
      status: 'unknown',
      percentage: 0,
    };
  }

  // Linear interpolation between the two predictions
  const timeFraction = (dateTime - lower.time) / (upper.time - lower.time);
  const height = lower.height + (upper.height - lower.height) * timeFraction;

  // Determine if tide is rising or falling
  const status = upper.height > lower.height ? 'rising' : 'falling';

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
