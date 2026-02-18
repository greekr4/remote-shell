# Repository Guidelines

## Project Structure & Module Organization
This repository is a Node.js web UI for remote shell control.

- `app.js`: main Express server, shell session management, and API/WebSocket handlers.
- `public/`: browser UI assets (`index.html`, `app.js`, `styles.css`, `terminal-view.html`, `ttyd-index.html`).
- `scripts/`: PowerShell launch/stop helpers for local or authenticated startup.
- `bin/` and `ttyd.exe`: optional terminal dependencies/executables.
- `logs/`: runtime output logs (`server-*.log`).

## Build, Run, and Development Commands
- `npm install`  
  Install dependencies from `package-lock.json`.
- `npm run dev`  
  Start the app using `node app.js` (same as `npm start`).
- `npm run start`  
  Production-style local run; keep this command for docs and scripts.
- `scripts/start-local.ps1`  
  Windows helper for local launcher behavior.
- `scripts/stop.ps1`  
  Stop running shell/server process cleanly.

## Coding Style & Naming Conventions
- Use UTF-8 source encoding for all files.
- JavaScript style follows existing project patterns: semicolons, clear function names, and camelCase identifiers.
- Prefer small, single-purpose functions and explicit argument names.
- Keep route paths and event names descriptive (`/api/...`, websocket events).
- Folder and file names should stay kebab-case in `scripts/` and `public/`.

## Testing Guidelines
- No dedicated automated test suite is currently configured.
- Use the following smoke checks before submitting changes:
  - Start server and open UI at `http://localhost:7680`.
  - Verify command execution in terminal view and refresh behavior.
  - Check mobile layout in `<640px` width.
- A Playwright dependency exists for future E2E work; if you add tests, place them in a `tests/` folder and add an `npm test` script when ready.

## Security & Configuration
- By default, custom command input is restricted.  
  Enable explicitly with `ALLOW_CUSTOM=true` only in controlled environments.
- Never expose this server directly to public internet without auth/proxy controls.
- Keep logs/credentials out of source control and rotate session tokens used for remote access.

## Commit & Pull Request Guidelines
- The repository currently has limited commit history available, so follow the project convention below:
  - `[FEAT]`, `[FIX]`, `[MODIFY]`, `[DOCS]`, `[CHORE]` prefixes in Korean message.
- PRs should include:
  - A short summary of changed behavior.
  - Test/check steps performed.
  - Screenshots for UI behavior changes.
  - Related issue or task reference when applicable.
