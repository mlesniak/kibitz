# kibitz

Availability monitor for **Arche Svea Kiebitz** (Spiekeroog, unit 176608) — watches August 2027 and fires a push notification the moment any day opens up.

## Architecture

```
inselzeit.de page HTML
        |
        | (scrape fresh JWT token each run)
        v
api2.v-office.com/api/json/getCal
        |
        | (availability array, one entry per day)
        v
checker.ts  ──── /var/lib/kibitz-checker/state.json   (was_available, notified, failure counters)
        |
        ├── www/status.json    (read by frontend)
        └── ntfy.sh topic: madeleine-kibitz   (on false→true transition)

kibitz.mlesniak.com  ←  Caddy file_server  ←  /opt/kibitz-checker/www/
```

### Token resilience

The v-office JWT token is embedded directly in the inselzeit.de page HTML on every request. `checker.ts` scrapes it fresh on each run — so even if the token rotates (new deployment, key change), the checker self-heals without any manual intervention.

If token extraction fails 3 consecutive times, a warning push is sent to the same ntfy topic.

### Notification logic

- **One push, on the first `false → true` transition** for August 2027.
- If the dates become unavailable again later (re-booked), the `notified` flag resets — so a subsequent re-opening triggers a new push.
- Warning pushes (fetch errors) are throttled to once per failure streak.

### Frontend

Single static `index.html` — no build step, no framework. Fetches `status.json` (relative URL, same origin) every 5 minutes. Shows:

- Status banner (red/green)
- Month calendar grid for August 2027 with per-day color
- Last checked time, estimated next check, free day count

## Deployment

```sh
./deploy.sh                  # rsync to root@mlesniak.com + run setup.sh
```

`setup.sh` is idempotent: installs npm deps, seeds an empty `status.json`, writes the Caddy vhost config, and enables the systemd timer.

### Manual run

```sh
ssh root@mlesniak.com
cd /opt/kibitz-checker
node node_modules/.bin/tsx checker.ts --dry-run   # no writes, no pushes
node node_modules/.bin/tsx checker.ts             # real run
```

### Logs / timer

```sh
journalctl -u kibitz-checker.service -f
systemctl list-timers kibitz-checker.timer
```

## File layout

```
checker.ts                    main checker script
package.json                  npm manifest (tsx dependency)
tsconfig.json
setup.sh                      idempotent server setup
deploy.sh                     rsync + setup
systemd/
  kibitz-checker.service      oneshot service
  kibitz-checker.timer        15-min periodic trigger
www/
  index.html                  frontend (static)
  status.json                 written by checker (excluded from rsync)
```

## Config

All constants are at the top of `checker.ts`:

| Constant | Value |
|---|---|
| `UNIT_PAGE_URL` | inselzeit.de Kiebitz page |
| `UNIT_ID` | 176608 |
| `CHECK_MONTH` | August 2027 |
| `NTFY_TOPIC` | `madeleine-kibitz` |
| `FAILURE_THRESHOLD` | 3 consecutive failures before warning push |
| Timer interval | 15 min (`OnUnitActiveSec` in `.timer`) |
