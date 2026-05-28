const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function toRadians(degrees) {
  return degrees * DEG2RAD;
}

export function toDegrees(radians) {
  return radians * RAD2DEG;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

export function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
}

export function formatClock(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date).toLowerCase();
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return '—';
  }

  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (hours === 0) {
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  }

  if (mins === 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

function decimalHours(date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

function fractionalYear(date) {
  const day = dayOfYear(date);
  return (2 * Math.PI / 365) * (day - 1 + (decimalHours(date) - 12) / 24);
}

function equationOfTime(date) {
  const gamma = fractionalYear(date);
  return 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
}

function solarDeclination(date) {
  const gamma = fractionalYear(date);
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

export function solarPosition(date, latitude, longitude) {
  const eqTime = equationOfTime(date);
  const declination = solarDeclination(date);
  const latitudeRad = toRadians(latitude);
  const timeOffset = eqTime + 4 * longitude - 60 * (-date.getTimezoneOffset() / 60);
  const trueSolarTime = ((date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + timeOffset) % 1440 + 1440) % 1440;
  const hourAngle = toRadians(trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180);

  const cosZenith = clamp(
    Math.sin(latitudeRad) * Math.sin(declination) +
    Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith);
  const altitude = Math.PI / 2 - zenith;

  let azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) - Math.tan(declination) * Math.cos(latitudeRad),
  );
  azimuth = normalizeDegrees(toDegrees(azimuth) + 180);

  return {
    azimuth,
    altitude: toDegrees(altitude),
    declination: toDegrees(declination),
    equationOfTime: eqTime,
    hourAngle: toDegrees(hourAngle),
  };
}

export function wallAngleFromDimensions(height, overhang) {
  if (!(height > 0) && !(overhang > 0)) {
    if (overhang < 0) {
      return -90;
    }

    return 0;
  }

  if (!(height > 0)) {
    return overhang > 0 ? 90 : overhang < 0 ? -90 : 0;
  }

  if (!(overhang > 0)) {
    if (overhang < 0) {
      return toDegrees(Math.atan(overhang / height));
    }

    return 0;
  }

  return toDegrees(Math.atan(overhang / height));
}

export function wallDimensionsFromAngle(height, angle) {
  const wallHeight = Number(height);

  if (!(wallHeight > 0)) {
    return { height: 0, overhang: 0 };
  }

  const clampedAngle = clamp(angle, -89.9, 89.9);
  const overhang = wallHeight * Math.tan(toRadians(clampedAngle));

  return { height: wallHeight, overhang };
}

export function wallIncidence(position, wallAspect, wallAngle) {
  const sunAzimuth = toRadians(position.azimuth);
  const sunAltitude = toRadians(position.altitude);
  const wallAspectRad = toRadians(normalizeDegrees(wallAspect));
  const wallAngleRad = toRadians(clamp(wallAngle, -90, 90));

  const sunVector = [
    Math.cos(sunAltitude) * Math.sin(sunAzimuth),
    Math.cos(sunAltitude) * Math.cos(sunAzimuth),
    Math.sin(sunAltitude),
  ];

  const wallNormal = [
    Math.cos(wallAngleRad) * Math.sin(wallAspectRad),
    Math.cos(wallAngleRad) * Math.cos(wallAspectRad),
    // For our angle convention (0° vertical, + overhang, - slabby) we invert
    // the sign here so a positive overhang makes the surface normal point
    // slightly downward (reducing incidence for a sun above the horizon).
    -Math.sin(wallAngleRad),
  ];

  return clamp(
    sunVector[0] * wallNormal[0] + sunVector[1] * wallNormal[1] + sunVector[2] * wallNormal[2],
    -1,
    1,
  );
}

function exposureState(date, latitude, longitude, wallAspect, wallAngle) {
  const position = solarPosition(date, latitude, longitude);
  const incidence = wallIncidence(position, wallAspect, wallAngle);

  return {
    date,
    position,
    incidence,
    isLit: position.altitude > 0 && incidence > 0,
  };
}

function midpointDate(start, end) {
  return new Date((start.getTime() + end.getTime()) / 2);
}

function altitudeState(date, latitude, longitude) {
  const position = solarPosition(date, latitude, longitude);
  return {
    date,
    position,
    isAboveHorizon: position.altitude > 0,
  };
}

function refineAltitudeTransition(left, right, latitude, longitude, toleranceMinutes = 1) {
  let a = left;
  let b = right;
  let stateA = altitudeState(a, latitude, longitude).isAboveHorizon;
  let stateB = altitudeState(b, latitude, longitude).isAboveHorizon;

  if (stateA === stateB) {
    return b;
  }

  while ((b - a) / 60000 > toleranceMinutes) {
    const mid = midpointDate(a, b);
    const stateMid = altitudeState(mid, latitude, longitude).isAboveHorizon;

    if (stateMid === stateA) {
      a = mid;
      stateA = stateMid;
    } else {
      b = mid;
      stateB = stateMid;
    }
  }

  return b;
}

function refineTransition(left, right, latitude, longitude, wallAspect, wallAngle, toleranceMinutes = 1) {
  let a = left;
  let b = right;
  let stateA = exposureState(a, latitude, longitude, wallAspect, wallAngle).isLit;
  let stateB = exposureState(b, latitude, longitude, wallAspect, wallAngle).isLit;

  if (stateA === stateB) {
    return b;
  }

  while ((b - a) / 60000 > toleranceMinutes) {
    const mid = midpointDate(a, b);
    const stateMid = exposureState(mid, latitude, longitude, wallAspect, wallAngle).isLit;

    if (stateMid === stateA) {
      a = mid;
      stateA = stateMid;
    } else {
      b = mid;
      stateB = stateMid;
    }
  }

  return b;
}

export function findExposureWindows(date, latitude, longitude, wallAspect, wallAngle) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const stepMinutes = 10;
  const samples = [];

  for (let minute = 0; minute <= 24 * 60; minute += stepMinutes) {
    const sampleDate = new Date(startOfDay.getTime() + minute * 60000);
    samples.push(exposureState(sampleDate, latitude, longitude, wallAspect, wallAngle));
  }

  const windows = [];
  let currentWindowStart = null;

  for (let index = 0; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    const nextSample = samples[index + 1];

    if (sample.isLit && currentWindowStart === null) {
      currentWindowStart = sample.date;
    }

    if (sample.isLit !== nextSample.isLit) {
      const transition = refineTransition(
        sample.date,
        nextSample.date,
        latitude,
        longitude,
        wallAspect,
        wallAngle,
        1,
      );

      if (nextSample.isLit) {
        currentWindowStart = transition;
      } else if (currentWindowStart !== null) {
        windows.push({ start: currentWindowStart, end: transition });
        currentWindowStart = null;
      }
    }
  }

  if (samples.at(-1)?.isLit && currentWindowStart !== null) {
    windows.push({ start: currentWindowStart, end: new Date(startOfDay.getTime() + 24 * 60 * 60000) });
  }

  return windows.map((window) => ({
    ...window,
    durationMinutes: (window.end - window.start) / 60000,
  }));
}

export function solarPath(date, latitude, longitude, stepMinutes = 30) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const points = [];

  for (let minute = 0; minute <= 24 * 60; minute += stepMinutes) {
    const sampleDate = new Date(startOfDay.getTime() + minute * 60000);
    const position = solarPosition(sampleDate, latitude, longitude);

    if (position.altitude >= 0) {
      points.push({ minute, ...position });
    }
  }

  return points;
}

export function sunriseSunsetTimes(date, latitude, longitude) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const stepMinutes = 10;
  const samples = [];

  for (let minute = 0; minute <= 24 * 60; minute += stepMinutes) {
    const sampleDate = new Date(startOfDay.getTime() + minute * 60000);
    samples.push(altitudeState(sampleDate, latitude, longitude));
  }

  let sunrise = null;
  let sunset = null;

  for (let index = 0; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    const nextSample = samples[index + 1];

    if (sample.isAboveHorizon !== nextSample.isAboveHorizon) {
      const transition = refineAltitudeTransition(
        sample.date,
        nextSample.date,
        latitude,
        longitude,
        1,
      );

      if (nextSample.isAboveHorizon) {
        sunrise = transition;
      } else {
        sunset = transition;
      }
    }
  }

  return { sunrise, sunset };
}

export function currentWallStatus(position, wallAspect, wallAngle) {
  const incidence = wallIncidence(position, wallAspect, wallAngle);

  if (position.altitude <= 0) {
    return 'Below horizon';
  }

  return incidence > 0 ? 'Sunlit' : 'Shaded';
}

export function currentSunSummary(position) {
  if (position.altitude <= 0) {
    return 'Below horizon';
  }

  return `${position.azimuth.toFixed(1)}° azimuth, ${position.altitude.toFixed(1)}° altitude`;
}