import { scrapeAvailability } from "./scraper.mjs";
import { writeSnapshot } from "./store.mjs";

let running = null;

export function refreshAvailability() {
  if (running) return running;
  running = scrapeAvailability({ days: Number(process.env.LOOKAHEAD_DAYS || 8) })
    .then(async (snapshot) => {
      await writeSnapshot(snapshot);
      return snapshot;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
