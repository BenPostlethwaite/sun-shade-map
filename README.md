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

The workflow publishes only the static site files (`index.html`, `app.js`, `solar.js`, `styles.css`, and `favicon.svg`) so the hosted site stays lightweight.

## What is implemented

- Sun position calculations for a selected location and time.
- Wall exposure windows for a selected date.
- Two wall input modes: angle from vertical, or height plus overhang distance.
- A sky-dome visualization with the sun path and wall direction.
- Local persistence of the last-used settings.