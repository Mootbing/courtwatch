const escapeText = (value) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const localStamp = (date, time) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
const foldLine = (line) => line.match(/.{1,70}/gu)?.map((part, index) => (index ? ` ${part}` : part)) ?? [line];

export function snapshotToIcs(snapshot) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CourtWatch SF//Availability Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CourtWatch SF — Available Tennis Courts",
    "X-WR-TIMEZONE:America/Los_Angeles",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  snapshot.slots.forEach((slot) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${slot.id}@courtwatch-sf`,
      `DTSTAMP:${stamp(snapshot.updatedAt)}`,
      `DTSTART;TZID=America/Los_Angeles:${localStamp(slot.date, slot.startTime)}`,
      `DTEND;TZID=America/Los_Angeles:${localStamp(slot.date, slot.endTime)}`,
      `SUMMARY:${escapeText(`🎾 Open — ${slot.courtName}`)}`,
      `DESCRIPTION:${escapeText(`Available at the latest hourly check. Book immediately: ${slot.bookingUrl}`)}`,
      `URL:${slot.bookingUrl}`,
      "STATUS:TENTATIVE",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}
