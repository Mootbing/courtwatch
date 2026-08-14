import { createDemoSnapshot } from "../../lib/demo";
import { snapshotToIcs } from "../../lib/ics";

export async function GET() {
  const serviceUrl = (process.env.MONITOR_SERVICE_URL ?? "http://127.0.0.1:8899").replace(/\/$/, "");
  try {
    const response = await fetch(`${serviceUrl}/calendar.ics`);
    if (response.ok) {
      return new Response(await response.text(), {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'inline; filename="courtwatch-sf.ics"',
          "cache-control": "public, max-age=300",
        },
      });
    }
  } catch {
    // Fall through to the local preview feed.
  }
  return new Response(snapshotToIcs(createDemoSnapshot()), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="courtwatch-sf.ics"',
      "cache-control": "no-store",
    },
  });
}
