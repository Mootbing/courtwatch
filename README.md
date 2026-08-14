# CourtWatch SF

A calendar-style monitor for reservable San Francisco public tennis courts. It reads the public Rec booking pages, refreshes hourly on Railway, and publishes a subscribable `.ics` feed for Google Calendar.

## Local site

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Without a monitor service configured, the interface uses clearly labeled preview data.

To run the live monitor locally in Docker:

```bash
docker build -t courtwatch-sf-monitor .
docker run --rm -p 8899:8788 courtwatch-sf-monitor
```

The site automatically looks for the local monitor at `http://127.0.0.1:8899`.

## Railway deployment

The production project uses three Railway services built from the same `Dockerfile`:

- `web`: `npm run start`, with `MONITOR_SERVICE_URL=http://monitor.railway.internal:8788`.
- `monitor`: `npm run monitor:serve`, with a persistent volume mounted at `/data`.
- `hourly-refresh`: `npm run cron:refresh`, scheduled as `0 * * * *` UTC and calling the monitor over Railway's private network.

`railway.monitor.json` and `railway.cron.json` document the service-specific deployment settings. The public Railway domain belongs to `web`, so `/calendar.ics` remains a stable, subscribable feed without exposing the monitor directly.

Useful endpoints:

- `GET /api/availability` — current JSON snapshot
- `GET /calendar.ics` — subscription feed
- `POST /api/refresh` — protected refresh target for the cron
- `GET /health` — Railway health check

Google Calendar refreshes subscribed URLs on its own cadence, which can be slower than the monitor's hourly refresh. Clicking an event opens the official Rec location page for the matching date; availability is not held until Rec confirms the booking.
