import { createDemoSnapshot } from "../../../lib/demo";

export async function GET() {
  const serviceUrl = (process.env.MONITOR_SERVICE_URL ?? "http://127.0.0.1:8899").replace(/\/$/, "");
  try {
    const response = await fetch(`${serviceUrl}/api/availability`, {
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      return new Response(await response.text(), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      });
    }
  } catch {
    // The calendar remains useful with a clearly labeled local preview.
  }
  return Response.json(createDemoSnapshot(), {
    headers: { "cache-control": "no-store" },
  });
}
