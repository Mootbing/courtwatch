import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function request(path, accept = "text/html") {
  return (await worker()).fetch(
    new Request(`http://localhost${path}`, { headers: { accept } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the CourtWatch calendar shell", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>CourtWatch SF<\/title>/i);
  assert.match(html, /Find an open court/i);
  assert.match(html, /Add to Google Calendar/i);
  assert.match(html, />Map<\/button>/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("serves availability JSON and a subscribable calendar", async () => {
  const availability = await request("/api/availability", "application/json");
  assert.equal(availability.status, 200);
  const snapshot = await availability.json();
  assert.equal(snapshot.timezone, "America/Los_Angeles");
  assert.ok(snapshot.slots.length > 0);

  const calendar = await request("/calendar.ics", "text/calendar");
  assert.equal(calendar.status, 200);
  assert.match(calendar.headers.get("content-type") ?? "", /^text\/calendar/i);
  const body = await calendar.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /URL:https:\/\/www\.rec\.us\/locations\//);
});

test("validates private travel-time requests before routing", async () => {
  const response = await request("/api/travel-time?from=bad&to=37.76127,-122.4273142", "application/json");
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/i);
});

test("validates route geometry requests before calling OSRM", async () => {
  const response = await request("/api/route-geometry?from=bad&to=37.76127,-122.4273142", "application/json");
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/i);
});

test("links every map travel mode to Google Maps directions", async () => {
  const source = await readFile(new URL("../app/MapView.tsx", import.meta.url), "utf8");
  assert.match(source, /https:\/\/www\.google\.com\/maps\/dir\/\?\$\{params\.toString\(\)\}/);
  assert.match(source, /mode: "walking"/);
  assert.match(source, /mode: "transit"/);
  assert.match(source, /mode: "driving"/);
  assert.match(source, /estimate: "driveBestMinutes"/);
  assert.match(source, /estimate: "driveTrafficMinutes"/);
  assert.match(source, /origin: origin\.join\(","\)/);
  assert.match(source, /destination: destination\.join\(","\)/);
});

test("renders crowded availability as readable week cards and a day list", async () => {
  const source = await readFile(new URL("../app/CourtWatch.tsx", import.meta.url), "utf8");
  assert.match(source, /className="week-grid"/);
  assert.match(source, /className="day-list"/);
  assert.match(source, /\+\{daySlots\.length - 6\} more openings/);
  assert.doesNotMatch(source, /positionOverlaps/);
});
