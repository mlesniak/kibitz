# Kibitz — session context

## What this is

`kibitz` is a TypeScript/Node availability monitor for the holiday apartment
**Arche Svea Kiebitz** (Spiekeroog, unit 176608) at
https://www.inselzeit.de/Deutschland/Nordsee/Ostfriesische.Inseln/Spiekeroog/Kiebitz

It watches **August 2027** and fires a push notification the moment any day
opens up.

## Repo

https://github.com/mlesniak/kibitz  
Local: `/home/m/kibitz/`

## Infrastructure

- Server: `root@mlesniak.com`
- Deployed to: `/opt/kibitz-checker/`
- Frontend: https://kibitz.mlesniak.com (Caddy static file server)
- Caddy config: `/etc/caddy/Caddyfile.d/kibitz.caddyfile`
- State: `/var/lib/kibitz-checker/state.json`
- Runs as: systemd oneshot service + 15-min timer
- Node 24 installed on host (not Docker)

## Key files

| File | Purpose |
|---|---|
| `checker.ts` | Main runner: scrapes token, calls API, writes status.json, fires ntfy |
| `lib.ts` | Pure logic: `sliceMonth()` — maps raw availability array to per-day statuses |
| `checker.test.ts` | 8 unit tests for `sliceMonth` (Node built-in test runner) |
| `www/index.html` | Static frontend: calendar grid, status panel, test button |
| `www/status.json` | Written by checker each run; read by frontend (excluded from rsync) |
| `systemd/kibitz-checker.service` | oneshot service |
| `systemd/kibitz-checker.timer` | 15-min periodic trigger |
| `deploy.sh` | rsync to server + run `setup.sh` |
| `setup.sh` | Idempotent: npm ci, seed status.json, write Caddy config, enable timer |

## How the API works

1. GET `https://www.inselzeit.de/.../Kiebitz` → extract JWT token via
   regex `/token:\s*'(eyJ[^']+)'/` from page HTML (token is embedded
   directly, no expiry claim, refreshed every run for resilience)
2. GET `https://api2.v-office.com/api/json/getCal?actionName=getCal&lang=de&token=TOKEN&data={"unit":176608}`
3. Response: `cal.availability` = array of `"Y"/"N"/"Q"` strings, one per day
   starting from `cal.availabilityUpdate` date (UTC)
4. `sliceMonth(cal, 2027, 8)` slices out August 2027 → `DayStatus[]`

## Notification logic

- ntfy topic: `madeleine-spikeroog` (on ntfy.sh)
- Fires **once** on first `false → true` transition (`any_available`)
- If availability disappears again, `notified` resets → fires again on next opening
- Fetch failures ≥ 3 consecutive → warning push to same topic (once per streak)
- State fields: `was_available`, `notified`, `consecutive_failures`, `failure_notified`

## Commands

```sh
# Run tests
npm test

# Dry run (no writes, no pushes)
node node_modules/.bin/tsx checker.ts --dry-run

# Smoke test: bypass API, inject fake available day, fire real ntfy push
node node_modules/.bin/tsx checker.ts --smoke-test

# Deploy
./deploy.sh

# Logs on server
ssh root@mlesniak.com "journalctl -u kibitz-checker.service -n 50 --no-pager"

# Timer status
ssh root@mlesniak.com "systemctl list-timers kibitz-checker.timer --no-pager"

# Manual run on server
ssh root@mlesniak.com "node /opt/kibitz-checker/node_modules/.bin/tsx /opt/kibitz-checker/checker.ts"
```

## Deploy workflow

Every change: edit locally → commit → `git push` → `./deploy.sh`

`deploy.sh` rsyncs everything except `node_modules/`, `.git/`, and
`www/status.json` (live data must not be overwritten on redeploy).
