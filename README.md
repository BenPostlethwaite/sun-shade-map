# Sun Shade Map

Local-first sun position and wall exposure planner for rock climbers.

## Run locally

Use the bundled Python server:

```powershell
C:/Users/benpo/AppData/Local/Microsoft/WindowsApps/python3.12.exe server.py
```

Then open `http://127.0.0.1:8000` in your browser.

## Deploy to GitHub Pages

This project is configured for GitHub Pages via GitHub Actions.

1. Push the repository to GitHub.
2. In the repo settings, go to `Pages` and set the source to `GitHub Actions`.
3. Push to `main` or `master` to trigger the deployment workflow.

The workflow publishes only the static site files (`index.html`, `app.js`, `solar.js`, `tides.js`, `styles.css`, and `favicon.svg`) so the hosted site stays lightweight.

## What is implemented

- Sun position calculations for a selected location and time.
- Wall exposure windows for a selected date.
- Two wall input modes: angle from vertical, or height plus overhang distance.
- A sky-dome visualization with the sun path and wall direction.
- Local persistence of the last-used settings.
- Location-based sea-level forecasts including tides, using Open-Meteo Marine (UK and worldwide model coverage).

## Tide forecasts

The browser requests your location when the app opens. Allow access, press **Use my location** to retry, or enter coordinates manually. The forecast follows the selected coordinates and date. Inland locations and dates without a complete forecast display an unavailable message; the sun planner remains usable.

No API key or backend is required for personal, non-commercial use. The app calls `https://marine-api.open-meteo.com/v1/marine` with `sea_level_height_msl`; see the [provider documentation](https://open-meteo.com/en/docs/marine-weather-api) and [usage terms](https://open-meteo.com/en/terms). Coordinates are sent to Open-Meteo to retrieve the forecast. Successful requests are cached in memory for 30 minutes and simultaneous requests are shared.

Heights are hourly model estimates relative to global mean sea level. They are not chart-datum heights. High and low times are approximate extrema of those hourly samples. The daily cards show all detected extrema on the selected device-local calendar day; the next tide may fall on the following day. All clock times use the device's time zone, including when viewing remote coordinates.

Coastal accuracy is limited. Do not use these estimates for navigation or to determine safe access to tidal climbing areas. Check [ADMIRALTY EasyTide](https://easytide.admiralty.co.uk/) and local conditions. Data attribution is displayed below the graph.

## Verification

When a land request returns no tide values but identifies a sea cell within 25 km, the app retries that cell once. The forecast label shows the returned sea coordinates and distance from the selected location. This is a nearby sea estimate, not an estuary or harbour tide prediction. More distant cells are rejected.

With Node.js 22 or newer, run `node --test tests/tides.test.mjs`. The tests cover the deployment file list, request caching, invalid coordinates, missing data, flat extrema and out-of-range interpolation.


### ADMIRALTY tide times

The high/low panel uses the free ADMIRALTY Tidal API Discovery through the `sun-shade-tides` Cloudflare Worker. The API key stays in the Worker secret `ADMIRALTY_API_KEY`. Predictions and station responses are requested with `no-store` and are not written to browser storage. Select a coastal location within 25 km of a station and today or one of the next six days. GMT event times are converted to the device time zone, including British Summer Time. Approximate predictions retain the provider's approximation indicator.

The sea-level chart remains an Open-Meteo hourly model estimate relative to mean sea level. ADMIRALTY event heights are above chart datum and are deliberately displayed separately. Discovery does not supply a continuous tide curve. The station link opens its EasyTide page for comparison.

The frontend Worker URL is in `admiralty.js`; permitted website origins are in `worker/index.mjs`. Deployment instructions are in `worker/README.md`. The Pages workflow includes `admiralty.js`.
