import { refreshAvailability } from "./refresh.mjs";

const snapshot = await refreshAvailability();
console.log(`Saved ${snapshot.slots.length} tennis openings at ${snapshot.updatedAt}`);
