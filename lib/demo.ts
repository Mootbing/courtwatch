import type { AvailabilitySlot, AvailabilitySnapshot } from "./types";

const COURTS = [
  ["Dolores", "95745483-6b38-4e99-8ba2-a3e23cda8587"],
  ["Mountain Lake", "af2cd971-0c10-479d-a12e-ca63d55f71be"],
  ["Presidio Wall", "c2f20478-83d8-48c9-af3d-065d7ba22d60"],
  ["Crocker Amazon", "779905bd-4c2b-45b3-abd0-48140998bca1"],
  ["Minnie & Lovie Ward", "bb6254d3-0ef0-475d-8de9-ac7d6b0323f4"],
  ["Parkside Square", "5a0b8fa6-11db-433e-9314-bafb956d8622"],
  ["St. Mary's", "25eafd72-ca31-4df7-8850-79c05edf3796"],
  ["Sunset", "fe61cfdb-abf7-4f52-8ce4-45feb58f10b7"],
] as const;

const TIMES = ["07:30", "09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00"];

function sfDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function createDemoSnapshot(): AvailabilitySnapshot {
  const slots: AvailabilitySlot[] = [];
  for (let day = 0; day < 8; day += 1) {
    const date = sfDate(day);
    COURTS.forEach(([courtName, locationId], courtIndex) => {
      TIMES.forEach((startTime, timeIndex) => {
        if ((day * 3 + courtIndex * 2 + timeIndex) % 5 > 1) return;
        const durationMinutes = (courtIndex + timeIndex) % 3 === 0 ? 60 : 90;
        const dateParam = encodeURIComponent(`${date}T12:00:00.000Z`);
        slots.push({
          id: `${date}-${locationId}-${startTime}-${durationMinutes}`,
          courtName,
          locationId,
          date,
          startTime,
          endTime: addMinutes(startTime, durationMinutes),
          durationMinutes,
          bookingUrl: `https://www.rec.us/locations/${locationId}?date=${dateParam}`,
        });
      });
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://www.rec.us/sfrecpark",
    timezone: "America/Los_Angeles",
    status: "demo",
    window: { start: sfDate(0), end: sfDate(7) },
    slots,
  };
}
