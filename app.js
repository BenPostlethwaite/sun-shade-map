import {
  currentSunSummary,
  currentWallStatus,
  findExposureWindows,
  formatClock,
  formatDuration,
  normalizeDegrees,
  solarPath,
  solarPosition,
  sunriseSunsetTimes,
  wallAngleFromDimensions,
  wallDimensionsFromAngle,
} from './solar.js';

import {
  calculateTideHeight,
  findHighLowTides,
  formatTideTime,
  getNextTideChange,
  getTideData,
  getTideStations,
  getTideStats,
  getTideStatus,
} from './tides.js';

const STORAGE_KEY = 'sun-shade-map-state';
const DEFAULT_STATE = {
  date: new Date().toISOString().slice(0, 10),
  time: new Date().toTimeString().slice(0, 5),
  latitude: 51.5074,
  longitude: -0.1278,
  wallAspect: 180,
  angleMode: 'angle',
  wallAngle: 0,
  wallHeight: 2.4,
  wallOverhang: 0,
  tideEnabled: true,
  tideOffset: 0,
  tideStationId: '',
  tideStationName: 'Current location',
  tideStationLatitude: null,
  tideStationLongitude: null,
};

const elements = {
  summaryStatus: document.getElementById('summaryStatus'),
  summaryLocation: document.getElementById('summaryLocation'),
  summaryDate: document.getElementById('summaryDate'),
  summaryCard: document.querySelector('.summary-card'),
  dateInput: document.getElementById('dateInput'),
  timeInput: document.getElementById('timeInput'),
  timeSlider: document.getElementById('timeSlider'),
  latInput: document.getElementById('latInput'),
  lonInput: document.getElementById('lonInput'),
  geoButton: document.getElementById('geoButton'),
  resetButton: document.getElementById('resetButton'),
  nowButton: document.getElementById('nowButton'),
  wallAspectInput: document.getElementById('wallAspectInput'),
  wallAspectSlider: document.getElementById('wallAspectSlider'),
  angleModeButton: document.getElementById('angleModeButton'),
  dimensionModeButton: document.getElementById('dimensionModeButton'),
  angleModePanel: document.getElementById('angleModePanel'),
  dimensionModePanel: document.getElementById('dimensionModePanel'),
  wallAngleInput: document.getElementById('wallAngleInput'),
  wallAngleSlider: document.getElementById('wallAngleSlider'),
  wallHeightInput: document.getElementById('wallHeightInput'),
  wallOverhangInput: document.getElementById('wallOverhangInput'),
  tideEnabledInput: document.getElementById('tideEnabledInput'),
  tideStationButton: document.getElementById('tideStationButton'),
  tideStationStat: document.getElementById('tideStationStat'),
  tideOffsetInput: document.getElementById('tideOffsetInput'),
  
  sunAzimuthStat: document.getElementById('sunAzimuthStat'),
  sunAltitudeStat: document.getElementById('sunAltitudeStat'),
  wallStatusStat: document.getElementById('wallStatusStat'),
  totalSunlitStat: document.getElementById('totalSunlitStat'),
  skyCanvas: document.getElementById('skyCanvas'),
  tideCanvas: document.getElementById('tideCanvas'),
  windowsList: document.getElementById('windowsList'),
  sunriseStat: document.getElementById('sunriseStat'),
  sunsetStat: document.getElementById('sunsetStat'),
  nextChangeStat: document.getElementById('nextChangeStat'),
  highTideStat: document.getElementById('highTideStat'),
  lowTideStat: document.getElementById('lowTideStat'),
  currentTideStat: document.getElementById('currentTideStat'),
  tideStatus: document.getElementById('tideStatus'),
};

const ctx = elements.skyCanvas.getContext('2d');
const tideCtx = elements.tideCanvas ? elements.tideCanvas.getContext('2d') : null;
let state = loadState();
let lastPath = [];
let lastRenderContext = null;
let tideState = {
  loading: false,
  error: null,
  station: null,
  predictions: [],
  updatedAt: null,
};
let tideRequestToken = 0;

// tooltip element for canvas hover
const canvasTooltip = document.createElement('div');
canvasTooltip.className = 'canvas-tooltip hidden';
document.body.appendChild(canvasTooltip);

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return { ...DEFAULT_STATE };
  }

  try {
    return { ...DEFAULT_STATE, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSelectedDateTime() {
  return new Date(`${state.date}T${state.time}:00`);
}

function minutesToTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeStringToMinutes(timestr) {
  const [h, m] = timestr.split(':').map(Number);
  return h * 60 + m;
}

function formatTideHeight(height) {
  return Number.isFinite(height) ? `${height.toFixed(1)}m` : '—';
}

function getAdjustedTidePredictions() {
  if (!tideState.predictions.length) {
    return [];
  }

  const offset = Number(state.tideOffset) || 0;
  return tideState.predictions.map((prediction) => ({
    ...prediction,
    height: prediction.height + offset,
  }));
}

function buildTideSamples(predictions, startOfDay) {
  const samples = [];

  for (let minute = 0; minute <= 1440; minute += 20) {
    const time = new Date(startOfDay.getTime() + minute * 60000);
    const tide = calculateTideHeight(time, predictions);
    samples.push({
      minute,
      time,
      height: tide.height,
    });
  }

  return samples;
}

function buildTideSnapshot(dateTime) {
  const predictions = state.tideEnabled ? getAdjustedTidePredictions() : [];
  const hasTideData = predictions.length > 0;
  const startOfDay = new Date(state.date);
  startOfDay.setHours(0, 0, 0, 0);

  if (!hasTideData) {
    return {
      enabled: Boolean(state.tideEnabled),
      hasTideData: false,
      predictions,
      samples: [],
      highTides: [],
      lowTides: [],
      current: { height: null, status: 'unknown', percentage: 0 },
      nextChange: null,
      stats: { minHeight: null, maxHeight: null, range: null },
      stationName: tideState.station?.name || state.tideStationName || 'Current location',
      error: tideState.error,
      loading: tideState.loading,
    };
  }

  const stats = getTideStats(predictions);
  const current = calculateTideHeight(dateTime, predictions);
  const { highTides, lowTides } = findHighLowTides(predictions);

  return {
    enabled: true,
    hasTideData: true,
    predictions,
    samples: buildTideSamples(predictions, startOfDay),
    highTides,
    lowTides,
    current,
    nextChange: getNextTideChange(dateTime, predictions),
    stats,
    stationName: tideState.station?.name || state.tideStationName || 'Current location',
    error: tideState.error,
    loading: tideState.loading,
  };
}

function getWallAngle() {
  if (state.angleMode === 'dimensions') {
    return wallAngleFromDimensions(Number(state.wallHeight), Number(state.wallOverhang));
  }

  return Number(state.wallAngle);
}

function updateSummary(position, wallStatus, windows) {
  const location = `${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)}`;
  const dateText = new Intl.DateTimeFormat([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${state.date}T12:00:00`));

  elements.summaryStatus.textContent = wallStatus;
  elements.summaryLocation.textContent = location;
  elements.summaryDate.textContent = dateText;
  elements.sunAzimuthStat.textContent = `${position.azimuth.toFixed(1)}°`;
  elements.sunAltitudeStat.textContent = `${position.altitude.toFixed(1)}°`;
  elements.wallStatusStat.textContent = wallStatus;
  const totalMinutes = windows.reduce((sum, window) => sum + window.durationMinutes, 0);
  elements.totalSunlitStat.textContent = formatDuration(totalMinutes);

  // Visual status on the summary card
  if (elements.summaryCard) {
    // animated theme toggle
    elements.summaryCard.classList.remove('sunlit', 'shaded', 'below');
    const wasSunlit = document.body.classList.contains('sunlit');

    if (wallStatus === 'Sunlit') {
      elements.summaryCard.classList.add('sunlit');
      if (!wasSunlit) {
        // play sunrise animation then set sunlit
        document.body.classList.add('sunrise-keyframes');
        setTimeout(() => document.body.classList.remove('sunrise-keyframes'), 900);
      }
      document.body.classList.add('sunlit');
    } else if (wallStatus === 'Shaded') {
      elements.summaryCard.classList.add('shaded');
      if (wasSunlit) {
        document.body.classList.add('sunset-keyframes');
        setTimeout(() => document.body.classList.remove('sunset-keyframes'), 900);
      }
      document.body.classList.remove('sunlit');
    } else {
      elements.summaryCard.classList.add('below');
      if (wasSunlit) {
        document.body.classList.add('sunset-keyframes');
        setTimeout(() => document.body.classList.remove('sunset-keyframes'), 900);
      }
      document.body.classList.remove('sunlit');
    }
  }
}

function updateSunTimes(sunTimes) {
  elements.sunriseStat.textContent = sunTimes.sunrise ? formatClock(sunTimes.sunrise) : '—';
  elements.sunsetStat.textContent = sunTimes.sunset ? formatClock(sunTimes.sunset) : '—';
}

function renderWindows(windows) {
  if (!windows.length) {
    elements.windowsList.innerHTML = '<div class="empty-state">No direct sun exposure on the selected wall for this date.</div>';
    return;
  }
  const startOfDay = new Date(state.date);
  startOfDay.setHours(0, 0, 0, 0);

  // Build combined timebar with multiple lit segments
  const segments = windows.map((window) => {
    const startMinutes = Math.round((window.start - startOfDay) / 60000);
    const leftPercent = Math.max(0, Math.min(100, (startMinutes / 1440) * 100));
    const widthPercent = Math.max(0.2, Math.min(100, (window.durationMinutes / 1440) * 100));
    return { leftPercent, widthPercent };
  });

  const segmentsHtml = segments.map(s => `<div class="timebar-lit" style="left: ${s.leftPercent}%; width: ${s.widthPercent}%;"></div>`).join('');

  const windowsHtml = windows.map((window) => `
    <article class="window-card">
      <strong>${formatClock(window.start)} - ${formatClock(window.end)}</strong>
      <small>${formatDuration(window.durationMinutes)}</small>
    </article>
  `).join('');

  elements.windowsList.innerHTML = `
    ${windowsHtml}
  `;
}

function getNextChangeText(windows, currentTime) {
  const timeline = [];

  for (const window of windows) {
    timeline.push({ type: 'enter', time: window.start });
    timeline.push({ type: 'exit', time: window.end });
  }

  timeline.sort((left, right) => left.time - right.time);

  const upcoming = timeline.find((entry) => entry.time > currentTime);

  if (!upcoming) {
    return 'No more changes today';
  }

  const minutesAway = Math.max(0, Math.round((upcoming.time - currentTime) / 60000));
  const durationText = formatDuration(minutesAway);
  const timeText = formatClock(upcoming.time);

  return `${upcoming.type === 'enter' ? 'Goes into the sun' : 'Goes into the shade'} in ${durationText} at ${timeText}`;
}

function projectPoint(azimuth, altitude, radius) {
  const azRad = azimuth * Math.PI / 180;
  const altClamped = Math.max(0, Math.min(90, altitude));
  const r = radius * (1 - altClamped / 90);
  const center = elements.skyCanvas.width / 2;

  return {
    x: center + r * Math.sin(azRad),
    y: center - r * Math.cos(azRad),
  };
}

function drawArc(ctxInstance, radius, color, lineWidth = 2) {
  const center = elements.skyCanvas.width / 2;

  ctxInstance.beginPath();
  ctxInstance.arc(center, center, radius, 0, Math.PI * 2);
  ctxInstance.strokeStyle = color;
  ctxInstance.lineWidth = lineWidth;
  ctxInstance.stroke();
}

function drawArrow(ctxInstance, fromX, fromY, toX, toY, color, lineWidth = 4) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = 18;

  // Draw shaft stopping where the arrowhead begins so the head sits at the tip
  const shaftEndX = toX - headLength * Math.cos(angle);
  const shaftEndY = toY - headLength * Math.sin(angle);

  ctxInstance.beginPath();
  ctxInstance.moveTo(fromX, fromY);
  ctxInstance.lineTo(shaftEndX, shaftEndY);
  ctxInstance.strokeStyle = color;
  ctxInstance.lineWidth = lineWidth;
  ctxInstance.lineCap = 'round';
  ctxInstance.stroke();

  ctxInstance.beginPath();
  ctxInstance.moveTo(toX, toY);
  ctxInstance.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 7),
    toY - headLength * Math.sin(angle - Math.PI / 7),
  );
  ctxInstance.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 7),
    toY - headLength * Math.sin(angle + Math.PI / 7),
  );
  ctxInstance.closePath();
  ctxInstance.fillStyle = color;
  ctxInstance.fill();
}

function drawTideGauge(context, outerRadius, tideSnapshot) {
  if (!tideSnapshot?.hasTideData || !tideSnapshot.enabled) {
    return;
  }

  const size = elements.skyCanvas.width;
  const center = size / 2;
  const gaugeRadius = outerRadius * 0.97;
  const startAngle = Math.PI * 1.05;
  const endAngle = Math.PI * 1.95;
  const sweep = endAngle - startAngle;
  const steps = 48;

  const mix = (left, right, amount) => {
    const blend = Math.max(0, Math.min(1, amount));
    const channel = (channelIndex) => Math.round(left[channelIndex] + (right[channelIndex] - left[channelIndex]) * blend);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
  };

  const lowColor = [74, 154, 255];
  const midColor = [95, 214, 209];
  const highColor = [141, 236, 255];

  context.lineCap = 'round';
  context.lineWidth = 12;

  for (let index = 0; index < steps; index += 1) {
    const start = startAngle + (sweep * index) / steps;
    const end = startAngle + (sweep * (index + 1)) / steps;
    const t = index / (steps - 1);
    const segmentColor = t < 0.5
      ? mix(lowColor, midColor, t * 2)
      : mix(midColor, highColor, (t - 0.5) * 2);

    context.beginPath();
    context.strokeStyle = segmentColor;
    context.arc(center, center, gaugeRadius, start, end);
    context.stroke();
  }

  const currentPercentage = Number.isFinite(tideSnapshot.current?.percentage)
    ? tideSnapshot.current.percentage
    : 50;
  const currentAngle = startAngle + sweep * (currentPercentage / 100);
  const markerRadius = gaugeRadius + 2;
  const currentPoint = {
    x: center + markerRadius * Math.cos(currentAngle),
    y: center + markerRadius * Math.sin(currentAngle),
  };

  context.beginPath();
  context.arc(currentPoint.x, currentPoint.y, 8, 0, Math.PI * 2);
  context.fillStyle = '#f5aa3b';
  context.shadowColor = 'rgba(245,170,59,0.35)';
  context.shadowBlur = 16;
  context.fill();
  context.shadowBlur = 0;

  const labelColor = document.body.classList.contains('sunlit') ? 'rgba(32,32,24,0.9)' : 'rgba(255,255,255,0.92)';
  context.fillStyle = labelColor;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '600 14px "Aptos", "Segoe UI", sans-serif';

  const lowPoint = {
    x: center + gaugeRadius * Math.cos(startAngle),
    y: center + gaugeRadius * Math.sin(startAngle),
  };
  const highPoint = {
    x: center + gaugeRadius * Math.cos(endAngle),
    y: center + gaugeRadius * Math.sin(endAngle),
  };

  context.beginPath();
  context.arc(lowPoint.x, lowPoint.y, 4, 0, Math.PI * 2);
  context.fillStyle = '#4a9aff';
  context.fill();

  context.beginPath();
  context.arc(highPoint.x, highPoint.y, 4, 0, Math.PI * 2);
  context.fillStyle = '#8decff';
  context.fill();

  context.fillStyle = labelColor;
  context.fillText('L', lowPoint.x, lowPoint.y + 16);
  context.fillText('H', highPoint.x, highPoint.y + 16);

  const statusText = tideSnapshot.current?.height == null
    ? 'Tide unavailable'
    : `${formatTideHeight(tideSnapshot.current.height)} ${getTideStatus(tideSnapshot.current.percentage, tideSnapshot.current.status)}`;
  context.fillText(statusText, center, center + outerRadius * 0.72);
}

function renderSky(position, wallAspect, wallSteepness, windows = [], tideSnapshot = null) {
  const canvas = elements.skyCanvas;
  const context = ctx;
  const size = canvas.width;
  const center = size / 2;
  const outerRadius = size * 0.42;

  context.clearRect(0, 0, size, size);

  const isLight = document.body.classList.contains('sunlit');
  const skyGradient = context.createRadialGradient(center, center, 40, center, center, outerRadius);
  if (isLight) {
    skyGradient.addColorStop(0, 'rgba(255, 252, 238, 0.95)');
    skyGradient.addColorStop(1, 'rgba(255, 244, 220, 0.95)');
  } else {
    skyGradient.addColorStop(0, 'rgba(20, 48, 81, 0.95)');
    skyGradient.addColorStop(1, 'rgba(7, 14, 24, 0.95)');
  }
  context.fillStyle = skyGradient;
  context.fillRect(0, 0, size, size);

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = isLight ? 'rgba(28,28,24,0.12)' : 'rgba(255,255,255,0.08)';

  for (const ring of [outerRadius * 0.25, outerRadius * 0.5, outerRadius * 0.75, outerRadius]) {
    drawArc(context, ring, isLight ? 'rgba(32,32,28,0.08)' : 'rgba(255,255,255,0.07)', 1);
  }

  for (let az = 0; az < 360; az += 30) {
    const point = projectPoint(az, 0, outerRadius);
    context.beginPath();
    context.moveTo(center, center);
    context.lineTo(point.x, point.y);
    context.strokeStyle = az % 90 === 0 ? (isLight ? 'rgba(28,28,24,0.26)' : 'rgba(255,255,255,0.18)') : (isLight ? 'rgba(28,28,24,0.12)' : 'rgba(255,255,255,0.08)');
    context.stroke();
  }

  context.restore();

  const path = solarPath(new Date(`${state.date}T12:00:00`), state.latitude, state.longitude, 5);
  lastPath = path;
  if (path.length > 1) {
    context.beginPath();
    path.forEach((point, index) => {
      const projected = projectPoint(point.azimuth, point.altitude, outerRadius);
      if (index === 0) {
        context.moveTo(projected.x, projected.y);
      } else {
        context.lineTo(projected.x, projected.y);
      }
    });
    context.strokeStyle = isLight ? 'rgba(38, 155, 148, 0.9)' : 'rgba(96, 214, 209, 0.8)';
    context.lineWidth = 3;
    context.stroke();
  }

  // Draw quarter-hour ticks and hourly labels along the visible path,
  // but only for minutes that are within sunlit (non-shaded) exposure windows.
  // ticks/labels are drawn after lit segments so they appear on top

  // (current-time marker removed)

  // Draw lit segments on the path itself using exposure windows
  if (windows && windows.length) {
    const startOfDay = new Date(state.date);
    startOfDay.setHours(0, 0, 0, 0);

    for (const window of windows) {
      const winStartMin = Math.round((window.start - startOfDay) / 60000);
      const winEndMin = Math.round((window.end - startOfDay) / 60000);
      const segPoints = path.filter(p => p.minute >= winStartMin && p.minute <= winEndMin);
      if (segPoints.length < 2) continue;

      context.beginPath();
      segPoints.forEach((pt, i) => {
        const projected = projectPoint(pt.azimuth, pt.altitude, outerRadius);
        if (i === 0) context.moveTo(projected.x, projected.y);
        else context.lineTo(projected.x, projected.y);
      });
      context.lineWidth = 6;
      context.strokeStyle = '#f5aa3b';
      context.lineCap = 'round';
      context.shadowColor = 'rgba(245,170,59,0.35)';
      context.shadowBlur = 14;
      context.stroke();
      context.shadowBlur = 0;

      // Draw end caps
      const first = segPoints[0];
      const last = segPoints[segPoints.length - 1];
      const p1 = projectPoint(first.azimuth, first.altitude, outerRadius);
      const p2 = projectPoint(last.azimuth, last.altitude, outerRadius);
      context.beginPath();
      context.fillStyle = '#f5aa3b';
      context.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
      context.fill();
    }
  }

  // Draw quarter-hour ticks and hourly labels along the visible path,
  // but only for minutes that are within sunlit (non-shaded) exposure windows.
  if (lastPath && lastPath.length > 1) {
    const pathPoints = lastPath;
    const tickColor = isLight ? 'rgba(32,32,28,0.9)' : 'rgba(255,255,255,0.9)';
    const smallTickR = 1.6;
    const hourTickR = 3.0;
    context.fillStyle = tickColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '400 12px "Aptos", "Segoe UI", sans-serif';

    const startOfDay = new Date(state.date);
    startOfDay.setHours(0, 0, 0, 0);
    let lastLabelPos = null;
    for (const pt of pathPoints) {
      if (pt.minute % 15 !== 0) continue;
      const proj = projectPoint(pt.azimuth, pt.altitude, outerRadius);
      context.beginPath();
      const r = (pt.minute % 60 === 0) ? hourTickR : smallTickR;
      context.arc(proj.x, proj.y, r, 0, Math.PI * 2);
      context.fill();

      if (pt.minute % 60 === 0) {
        const labelRadius = outerRadius * 1.12;
        const labelPt = projectPoint(pt.azimuth, pt.altitude, labelRadius);
        if (!lastLabelPos || Math.hypot(labelPt.x - lastLabelPos.x, labelPt.y - lastLabelPos.y) > 28) {
          const labelDate = new Date(startOfDay.getTime() + pt.minute * 60000);
          const hour = labelDate.getHours() % 12 || 12;
          const suffix = labelDate.getHours() >= 12 ? 'pm' : 'am';
          const labelText = `${hour}${suffix}`;
          const w = context.measureText(labelText).width + 10;
          const h = 18;
          context.beginPath();
          context.fillStyle = isLight ? 'rgba(255,255,255,0.88)' : 'rgba(6,12,22,0.7)';
          if (context.roundRect) {
            context.roundRect(labelPt.x - w/2, labelPt.y - h/2, w, h, 6);
            context.fill();
          } else {
            context.fillRect(labelPt.x - w/2, labelPt.y - h/2, w, h);
          }
          context.fillStyle = isLight ? 'rgba(28,28,24,0.9)' : 'rgba(255,255,255,0.92)';
          context.fillText(labelText, labelPt.x, labelPt.y + 0.5);
          lastLabelPos = labelPt;
        }
      }
    }
  }

  const wallAngle = normalizeDegrees(Number(wallAspect));
  const wallPoint = projectPoint(wallAngle, Number(wallSteepness), outerRadius * 0.95);
  drawArrow(context, center, center, wallPoint.x, wallPoint.y, isLight ? 'rgba(28,28,24,0.92)' : 'rgba(255,255,255,0.92)', 4);

  // (labels removed) — wall label is not drawn on the sky view
  if (position.altitude > 0) {
    const sunPoint = projectPoint(position.azimuth, position.altitude, outerRadius);
    context.beginPath();
    context.arc(sunPoint.x, sunPoint.y, 14, 0, Math.PI * 2);
    context.fillStyle = '#f5aa3b';
    context.shadowColor = 'rgba(245, 170, 59, 0.5)';
    context.shadowBlur = 20;
    context.fill();
    context.shadowBlur = 0;

    context.beginPath();
    context.arc(sunPoint.x, sunPoint.y, 28, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(245, 170, 59, 0.24)';
    context.lineWidth = 2;
    context.stroke();
  }

  context.fillStyle = isLight ? 'rgba(32,32,28,0.84)' : 'rgba(255,255,255,0.84)';
  context.font = '600 18px "Aptos", "Segoe UI", sans-serif';
  context.fillText('N', center - 8, center - outerRadius - 10);
  context.fillText('E', center + outerRadius + 12, center + 6);
  context.fillText('S', center - 8, center + outerRadius + 26);
  context.fillText('W', center - outerRadius - 22, center + 6);

  // wall label removed per user request

  drawTideGauge(context, outerRadius, tideSnapshot);
}

function renderTideGraph(tideSnapshot, dateTime, sunTimes) {
  if (!tideCtx) {
    return;
  }

  const canvas = elements.tideCanvas;
  const context = tideCtx;
  const width = canvas.width;
  const height = canvas.height;
  const left = 58;
  const right = 22;
  const top = 18;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  context.clearRect(0, 0, width, height);

  if (!tideSnapshot.enabled) {
    context.fillStyle = document.body.classList.contains('sunlit') ? 'rgba(32,32,24,0.8)' : 'rgba(255,255,255,0.84)';
    context.font = '600 15px "Aptos", "Segoe UI", sans-serif';
    context.fillText('Enable tide data to view the daily curve.', left, top + 28);
    elements.tideStatus.textContent = 'Tide data is turned off.';
    return;
  }

  if (tideSnapshot.loading && !tideSnapshot.hasTideData) {
    context.fillStyle = document.body.classList.contains('sunlit') ? 'rgba(32,32,24,0.8)' : 'rgba(255,255,255,0.84)';
    context.font = '600 15px "Aptos", "Segoe UI", sans-serif';
    context.fillText('Loading tide data…', left, top + 28);
    elements.tideStatus.textContent = 'Loading nearest tide station and predictions…';
    return;
  }

  if (tideSnapshot.error && !tideSnapshot.hasTideData) {
    context.fillStyle = document.body.classList.contains('sunlit') ? 'rgba(32,32,24,0.8)' : 'rgba(255,255,255,0.84)';
    context.font = '600 15px "Aptos", "Segoe UI", sans-serif';
    context.fillText('Tide data unavailable for this location.', left, top + 28);
    elements.tideStatus.textContent = tideSnapshot.error;
    return;
  }

  const predictions = tideSnapshot.predictions;
  const samples = tideSnapshot.samples;
  if (!predictions.length || !samples.length) {
    context.fillStyle = document.body.classList.contains('sunlit') ? 'rgba(32,32,24,0.8)' : 'rgba(255,255,255,0.84)';
    context.font = '600 15px "Aptos", "Segoe UI", sans-serif';
    context.fillText('No tide predictions returned for this day.', left, top + 28);
    elements.tideStatus.textContent = tideSnapshot.error || 'No predictions available.';
    return;
  }

  const heights = samples.map((sample) => sample.height);
  let minHeight = Math.min(...heights);
  let maxHeight = Math.max(...heights);
  if (Math.abs(maxHeight - minHeight) < 0.1) {
    maxHeight += 0.05;
    minHeight -= 0.05;
  }
  const heightRange = maxHeight - minHeight;
  const xForMinute = (minute) => left + (minute / 1440) * chartWidth;
  const yForHeight = (value) => top + (1 - (value - minHeight) / heightRange) * chartHeight;
  const isLight = document.body.classList.contains('sunlit');
  const gridColor = isLight ? 'rgba(32,32,24,0.12)' : 'rgba(255,255,255,0.12)';
  const axisColor = isLight ? 'rgba(32,32,24,0.75)' : 'rgba(255,255,255,0.82)';

  context.save();
  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  context.setLineDash([4, 8]);

  for (let line = 0; line <= 4; line += 1) {
    const value = minHeight + (heightRange * line) / 4;
    const y = yForHeight(value);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
  }

  context.restore();

  context.fillStyle = axisColor;
  context.font = '600 12px "Aptos", "Segoe UI", sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let line = 0; line <= 4; line += 1) {
    const value = minHeight + (heightRange * line) / 4;
    const y = yForHeight(value);
    context.fillText(formatTideHeight(value), left - 10, y);
  }

  const startOfDay = new Date(dateTime);
  startOfDay.setHours(0, 0, 0, 0);
  const sunriseMinute = sunTimes?.sunrise ? ((sunTimes.sunrise.getHours() * 60) + sunTimes.sunrise.getMinutes()) : null;
  const sunsetMinute = sunTimes?.sunset ? ((sunTimes.sunset.getHours() * 60) + sunTimes.sunset.getMinutes()) : null;

  const drawTimeLine = (minute, label, color) => {
    if (minute == null) {
      return;
    }

    const x = xForMinute(minute);
    context.save();
    context.strokeStyle = color;
    context.setLineDash([6, 6]);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + chartHeight);
    context.stroke();
    context.restore();

    context.fillStyle = color;
    context.textAlign = 'center';
    context.fillText(label, x, height - 14);
  };

  drawTimeLine(sunriseMinute, 'sunrise', 'rgba(245,170,59,0.55)');
  drawTimeLine(sunsetMinute, 'sunset', 'rgba(245,170,59,0.45)');

  const curveColor = isLight ? 'rgba(53, 128, 255, 0.9)' : 'rgba(97, 226, 219, 0.9)';
  context.beginPath();
  samples.forEach((sample, index) => {
    const x = xForMinute(sample.minute);
    const y = yForHeight(sample.height);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = curveColor;
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();

  const currentMinute = dateTime.getHours() * 60 + dateTime.getMinutes();
  const currentX = xForMinute(currentMinute);
  context.save();
  context.strokeStyle = 'rgba(245,170,59,0.85)';
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(currentX, top);
  context.lineTo(currentX, top + chartHeight);
  context.stroke();
  context.restore();

  const currentPoint = calculateTideHeight(dateTime, predictions);
  if (Number.isFinite(currentPoint.height)) {
    const y = yForHeight(currentPoint.height);
    context.beginPath();
    context.arc(currentX, y, 6, 0, Math.PI * 2);
    context.fillStyle = '#f5aa3b';
    context.fill();
  }

  const highTide = tideSnapshot.highTides[0];
  const lowTide = tideSnapshot.lowTides[0];
  const markerColor = isLight ? '#214cff' : '#8decff';
  const drawMarker = (entry, label, fillColor) => {
    if (!entry) {
      return;
    }

    const minute = entry.time.getHours() * 60 + entry.time.getMinutes();
    const x = xForMinute(minute);
    const y = yForHeight(entry.height);
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fillStyle = fillColor;
    context.fill();
    context.fillStyle = axisColor;
    context.textAlign = 'center';
    context.fillText(label, x, y - 14);
  };

  drawMarker(lowTide, 'low', markerColor);
  drawMarker(highTide, 'high', '#f5aa3b');

  context.fillStyle = axisColor;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.font = '600 13px "Aptos", "Segoe UI", sans-serif';
  const currentHeightText = currentPoint.height == null ? 'Tide unavailable' : `${formatTideHeight(currentPoint.height)} ${getTideStatus(currentPoint.percentage, currentPoint.status)}`;
  context.fillText(`${currentHeightText} • ${tideSnapshot.stationName}`, left, height - 12);

  if (tideSnapshot.nextChange) {
    const minutesAway = Math.max(0, Math.round((tideSnapshot.nextChange.time - dateTime) / 60000));
    context.textAlign = 'right';
    context.fillText(`${tideSnapshot.nextChange.type} tide in ${formatDuration(minutesAway)}`, width - right, height - 12);
    elements.tideStatus.textContent = `${currentHeightText}. Next ${tideSnapshot.nextChange.type} tide at ${formatTideTime(tideSnapshot.nextChange.time)}.`;
  } else {
    elements.tideStatus.textContent = `${currentHeightText}. No later tide change found for this day.`;
  }
}

function renderTideInfo(tideSnapshot) {
  elements.tideStationStat.textContent = tideSnapshot.stationName || 'Current location';

  if (!state.tideEnabled) {
    elements.highTideStat.textContent = '—';
    elements.lowTideStat.textContent = '—';
    elements.currentTideStat.textContent = 'Hidden';
    elements.tideStatus.textContent = 'Tide data is turned off.';
    return;
  }

  if (tideSnapshot.loading && !tideSnapshot.hasTideData) {
    elements.highTideStat.textContent = '—';
    elements.lowTideStat.textContent = '—';
    elements.currentTideStat.textContent = 'Loading…';
    elements.tideStatus.textContent = 'Loading nearest tide station and predictions…';
    return;
  }

  if (!tideSnapshot.hasTideData) {
    elements.highTideStat.textContent = '—';
    elements.lowTideStat.textContent = '—';
    elements.currentTideStat.textContent = '—';
    elements.tideStatus.textContent = tideSnapshot.error || 'Tide data unavailable for this location.';
    return;
  }

  const highTide = tideSnapshot.highTides[0];
  const lowTide = tideSnapshot.lowTides[0];
  const current = tideSnapshot.current;

  elements.highTideStat.textContent = highTide
    ? `${formatTideTime(highTide.time)} (${formatTideHeight(highTide.height)})`
    : '—';
  elements.lowTideStat.textContent = lowTide
    ? `${formatTideTime(lowTide.time)} (${formatTideHeight(lowTide.height)})`
    : '—';
  elements.currentTideStat.textContent = current.height == null
    ? '—'
    : `${formatTideHeight(current.height)} (${current.status})`;
}

function renderCurrentView() {
  if (!lastRenderContext) {
    return;
  }

  const tideSnapshot = buildTideSnapshot(lastRenderContext.dateTime);

  updateSummary(lastRenderContext.currentPosition, lastRenderContext.wallStatus, lastRenderContext.windows);
  updateSunTimes(lastRenderContext.sunTimes);
  renderWindows(lastRenderContext.windows);
  renderSky(
    lastRenderContext.currentPosition,
    lastRenderContext.wallAspect,
    lastRenderContext.wallAngle,
    lastRenderContext.windows,
    tideSnapshot,
  );
  renderTideInfo(tideSnapshot);
  renderTideGraph(tideSnapshot, lastRenderContext.dateTime, lastRenderContext.sunTimes);
  elements.nextChangeStat.textContent = getNextChangeText(lastRenderContext.windows, lastRenderContext.dateTime);
}

async function updateTideData() {
  const requestToken = ++tideRequestToken;

  if (!state.tideEnabled) {
    tideState = {
      loading: false,
      error: null,
      station: null,
      predictions: [],
      updatedAt: null,
    };
    renderCurrentView();
    return;
  }

  tideState = {
    loading: true,
    error: null,
    station: null,
    predictions: [],
    updatedAt: tideState.updatedAt,
  };
  renderCurrentView();

  const latitude = Number(state.latitude);
  const longitude = Number(state.longitude);
  const dateTime = getSelectedDateTime();

  try {
    const station = await getTideStations(latitude, longitude);
    if (requestToken !== tideRequestToken) {
      return;
    }

    if (!station) {
      tideState = {
        loading: false,
        error: 'No nearby tide station could be found.',
        station: null,
        predictions: [],
        updatedAt: new Date(),
      };
      renderCurrentView();
      return;
    }

    const predictions = await getTideData(station.id, dateTime);
    if (requestToken !== tideRequestToken) {
      return;
    }

    if (!predictions || predictions.length === 0) {
      tideState = {
        loading: false,
        error: `No tide predictions returned for station ${station.name}.`,
        station,
        predictions: [],
        updatedAt: new Date(),
      };
      state.tideStationId = station.id;
      state.tideStationName = station.name;
      state.tideStationLatitude = station.latitude;
      state.tideStationLongitude = station.longitude;
      saveState();
      renderCurrentView();
      return;
    }

    tideState = {
      loading: false,
      error: null,
      station,
      predictions,
      updatedAt: new Date(),
    };
    state.tideStationId = station.id;
    state.tideStationName = station.name;
    state.tideStationLatitude = station.latitude;
    state.tideStationLongitude = station.longitude;
    saveState();
    renderCurrentView();
  } catch (error) {
    if (requestToken !== tideRequestToken) {
      return;
    }

    tideState = {
      loading: false,
      error: error instanceof Error ? error.message : 'Unable to load tide data.',
      station: null,
      predictions: [],
      updatedAt: new Date(),
    };
    renderCurrentView();
  }
}

function syncControlsFromState() {
  elements.dateInput.value = state.date;
  elements.timeInput.value = state.time;
  if (elements.timeSlider) elements.timeSlider.value = timeStringToMinutes(state.time);
  elements.latInput.value = state.latitude;
  elements.lonInput.value = state.longitude;
  elements.wallAspectInput.value = state.wallAspect;
  if (elements.wallAspectSlider) elements.wallAspectSlider.value = state.wallAspect;
  elements.wallAngleInput.value = state.wallAngle;
  if (elements.wallAngleSlider) elements.wallAngleSlider.value = state.wallAngle;
  elements.wallHeightInput.value = state.wallHeight;
  elements.wallOverhangInput.value = state.wallOverhang;
  if (elements.tideEnabledInput) elements.tideEnabledInput.checked = Boolean(state.tideEnabled);
  if (elements.tideOffsetInput) elements.tideOffsetInput.value = state.tideOffset;
  if (elements.tideStationStat) elements.tideStationStat.textContent = state.tideStationName || 'Current location';

  const isDimensions = state.angleMode === 'dimensions';
  elements.angleModeButton.classList.toggle('active', !isDimensions);
  elements.dimensionModeButton.classList.toggle('active', isDimensions);
  elements.angleModePanel.classList.toggle('hidden', isDimensions);
  elements.dimensionModePanel.classList.toggle('hidden', !isDimensions);
}

// Canvas mouse interactions: show time tooltip when hovering near the path
function screenToCanvasCoords(evt) {
  const rect = elements.skyCanvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (elements.skyCanvas.width / rect.width);
  const y = (evt.clientY - rect.top) * (elements.skyCanvas.height / rect.height);
  return { x, y, clientX: evt.clientX, clientY: evt.clientY };
}

elements.skyCanvas.addEventListener('mousemove', (evt) => {
  const pos = screenToCanvasCoords(evt);
  if (!lastPath || !lastPath.length) return;
  // find nearest point on lastPath
  let nearest = null;
  let nearestDist = Infinity;
  const size = elements.skyCanvas.width;
  const center = size / 2;
  const outerRadius = size * 0.42;
  for (const pt of lastPath) {
    const p = projectPoint(pt.azimuth, pt.altitude, outerRadius);
    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
    if (d < nearestDist) { nearestDist = d; nearest = pt; }
  }
  if (nearest && nearestDist < 18) {
    canvasTooltip.textContent = `${formatClock(new Date(new Date(state.date).setHours(0,0,0,0) + nearest.minute*60000))}`;
    canvasTooltip.classList.remove('hidden');
    canvasTooltip.style.left = `${pos.clientX}px`;
    canvasTooltip.style.top = `${pos.clientY - 10}px`;
  } else {
    canvasTooltip.classList.add('hidden');
  }
});

elements.skyCanvas.addEventListener('mouseleave', () => {
  canvasTooltip.classList.add('hidden');
});

function updateFromState() {
  if (state.angleMode === 'dimensions') {
    state.wallAngle = wallAngleFromDimensions(Number(state.wallHeight), Number(state.wallOverhang));
  }

  saveState();
  syncControlsFromState();

  const dateTime = getSelectedDateTime();
  const wallAngle = getWallAngle();
  const currentPosition = solarPosition(dateTime, Number(state.latitude), Number(state.longitude));
  const sunTimes = sunriseSunsetTimes(dateTime, Number(state.latitude), Number(state.longitude));
  const windows = findExposureWindows(dateTime, Number(state.latitude), Number(state.longitude), Number(state.wallAspect), wallAngle);
  const wallStatus = currentWallStatus(currentPosition, Number(state.wallAspect), wallAngle);

  lastRenderContext = {
    dateTime,
    currentPosition,
    sunTimes,
    windows,
    wallStatus,
    wallAspect: Number(state.wallAspect),
    wallAngle,
  };

  renderCurrentView();
  void updateTideData();
}

function bindInput(input, updater) {
  const handleUpdate = () => {
    updater();
    updateFromState();
  };

  input.addEventListener('input', handleUpdate);
  input.addEventListener('change', handleUpdate);
}

bindInput(elements.dateInput, () => {
  state.date = elements.dateInput.value;
});

bindInput(elements.timeInput, () => {
  state.time = elements.timeInput.value;
});

if (elements.timeSlider) bindInput(elements.timeSlider, () => {
  state.time = minutesToTimeString(Number(elements.timeSlider.value));
});

bindInput(elements.latInput, () => {
  state.latitude = Number(elements.latInput.value);
});

bindInput(elements.lonInput, () => {
  state.longitude = Number(elements.lonInput.value);
});

bindInput(elements.wallAspectInput, () => {
  state.wallAspect = Number(elements.wallAspectInput.value);
});

if (elements.wallAspectSlider) bindInput(elements.wallAspectSlider, () => {
  state.wallAspect = Number(elements.wallAspectSlider.value);
  elements.wallAspectInput.value = elements.wallAspectSlider.value;
});

bindInput(elements.wallAngleInput, () => {
  state.wallAngle = Number(elements.wallAngleInput.value);
  state.wallOverhang = wallDimensionsFromAngle(Number(state.wallHeight), Number(state.wallAngle)).overhang;
});

if (elements.wallAngleSlider) bindInput(elements.wallAngleSlider, () => {
  state.wallAngle = Number(elements.wallAngleSlider.value);
  elements.wallAngleInput.value = elements.wallAngleSlider.value;
});

bindInput(elements.wallHeightInput, () => {
  state.wallHeight = Number(elements.wallHeightInput.value);
});
bindInput(elements.wallOverhangInput, () => {
  state.wallOverhang = Number(elements.wallOverhangInput.value);
});

if (elements.tideEnabledInput) bindInput(elements.tideEnabledInput, () => {
  state.tideEnabled = elements.tideEnabledInput.checked;
});

if (elements.tideOffsetInput) bindInput(elements.tideOffsetInput, () => {
  state.tideOffset = Number(elements.tideOffsetInput.value);
});


elements.angleModeButton.addEventListener('click', () => {
  state.angleMode = 'angle';
  updateFromState();
});

elements.dimensionModeButton.addEventListener('click', () => {
  state.angleMode = 'dimensions';
  updateFromState();
});

elements.geoButton.addEventListener('click', async () => {
  if (!navigator.geolocation) {
    alert('Geolocation is not available in this browser.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.latitude = Number(position.coords.latitude.toFixed(6));
      state.longitude = Number(position.coords.longitude.toFixed(6));
      updateFromState();
    },
    (error) => {
      alert(`Could not get your location: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

elements.resetButton.addEventListener('click', () => {
  state = { ...DEFAULT_STATE };
  tideState = {
    loading: false,
    error: null,
    station: null,
    predictions: [],
    updatedAt: null,
  };
  updateFromState();
});

if (elements.tideStationButton) elements.tideStationButton.addEventListener('click', () => {
  state.tideEnabled = true;
  if (elements.tideEnabledInput) {
    elements.tideEnabledInput.checked = true;
  }
  void updateTideData();
});

if (elements.nowButton) elements.nowButton.addEventListener('click', () => {
  const now = new Date();
  state.date = now.toISOString().slice(0,10);
  state.time = now.toTimeString().slice(0,5);
  updateFromState();
});

window.addEventListener('resize', () => updateFromState());

function initialize() {
  syncControlsFromState();
  updateFromState();
}

initialize();