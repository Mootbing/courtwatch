import { createServer } from "node:http";
import { snapshotToIcs } from "./ics.mjs";
import { refreshAvailability } from "./refresh.mjs";
import { readSnapshot } from "./store.mjs";

const port = Number(process.env.PORT || 8788);

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "cache-control": contentType.startsWith("text/calendar") ? "public, max-age=300" : "public, max-age=60",
  });
  response.end(body);
}

async function currentSnapshot() {
  const snapshot = await readSnapshot();
  if (!snapshot) return null;
  const age = Date.now() - new Date(snapshot.updatedAt).getTime();
  return { ...snapshot, status: age > 7_200_000 ? "stale" : "live" };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
    });
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, JSON.stringify({ ok: true, hasSnapshot: Boolean(await readSnapshot()) }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/availability") {
      const snapshot = await currentSnapshot();
      if (!snapshot) {
        send(response, 503, JSON.stringify({ error: "The first court refresh has not completed yet." }));
        return;
      }
      send(response, 200, JSON.stringify(snapshot));
      return;
    }
    if (request.method === "GET" && url.pathname === "/calendar.ics") {
      const snapshot = await currentSnapshot();
      if (!snapshot) {
        send(response, 503, "Calendar feed is waiting for its first refresh.\n", "text/plain; charset=utf-8");
        return;
      }
      send(response, 200, snapshotToIcs(snapshot), "text/calendar; charset=utf-8");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/refresh") {
      const expected = process.env.CRON_SECRET;
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (expected && supplied !== expected) {
        send(response, 401, JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const snapshot = await refreshAvailability();
      send(response, 200, JSON.stringify({ ok: true, updatedAt: snapshot.updatedAt, slots: snapshot.slots.length }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      send(response, 200, JSON.stringify({ name: "CourtWatch SF monitor", availability: "/api/availability", calendar: "/calendar.ics" }));
      return;
    }
    send(response, 404, JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error(error);
    send(response, 500, JSON.stringify({ error: "Court refresh failed", detail: error.message }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CourtWatch monitor listening on ${port}`);
  if (process.env.REFRESH_ON_START !== "false") {
    refreshAvailability()
      .then((snapshot) => console.log(`Initial refresh saved ${snapshot.slots.length} slots`))
      .catch((error) => console.error("Initial refresh failed", error));
  }
});
