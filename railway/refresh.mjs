import { scrapeAvailability } from "./scraper.mjs";
import { readSnapshot, writeSnapshot } from "./store.mjs";

let running = null;

function sfNowTime(timezone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function mergeWithPrevious(snapshot, previous) {
  if (!snapshot.failedDates?.length || !previous?.slots?.length) return snapshot;
  const today = snapshot.window.start;
  const now = sfNowTime(snapshot.timezone);
  const carried = previous.slots.filter(
    (slot) => snapshot.failedDates.includes(slot.date) && (slot.date !== today || slot.startTime > now),
  );
  if (!carried.length) return snapshot;
  console.warn(`Backfilling ${carried.length} slots for ${snapshot.failedDates.join(", ")} from the previous snapshot.`);
  const slots = [...new Map([...snapshot.slots, ...carried].map((slot) => [slot.id, slot])).values()];
  slots.sort((a, b) => `${a.date}${a.startTime}${a.courtName}`.localeCompare(`${b.date}${b.startTime}${b.courtName}`));
  return { ...snapshot, slots };
}

export function refreshAvailability() {
  if (running) return running;
  running = (async () => {
    const previous = await readSnapshot().catch(() => null);
    const scraped = await scrapeAvailability({ days: Number(process.env.LOOKAHEAD_DAYS || 8) });
    const snapshot = mergeWithPrevious(scraped, previous);
    await writeSnapshot(snapshot);
    return snapshot;
  })().finally(() => {
    running = null;
  });
  return running;
}
