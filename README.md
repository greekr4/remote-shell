# remote-shell

Mobile-first Claude/Codex command UI project for Windows.

## What this project does
- Runs a lightweight Express web UI on your Windows PC.
- Provides one-tap diagnostics plus prompt templates for Claude/Codex workflow.
- Shows command output in the browser.
- Keeps a persistent shell session and connects it by session URL.

## Project structure
- `app.js`: Express server + command API + session terminal socket
- `public/index.html`: mobile command UI
- `public/app.js`: client logic
- `public/styles.css`: mobile-first styling
- `scripts/start-external-auth.ps1`
- `scripts/stop.ps1`

## Install
```powershell
cd C:\Users\Administrator\Desktop\hobby-project\remote-shell
npm install
```

## Run UI server
```powershell
cd C:\Users\Administrator\Desktop\hobby-project\remote-shell
npm run start
```

- UI URL (LAN/WAN): `http://<YOUR_IP>:7680`
- Live terminal: `http://<YOUR_IP>:7680/terminal-view?sid=<session-id>`

## Use from phone
1. Open `http://<YOUR_IP>:7680`
2. Tap preset buttons to inject and run commands in Live Terminal
3. Check output panel
4. Terminal is embedded in the page and reuses the same session id on refresh.

## Security notes
- Custom command run is disabled by default.
- To enable custom command input:
```powershell
$env:ALLOW_CUSTOM='true'; node app.js
```
- Do not expose direct shell access to public internet for long-term usage.
