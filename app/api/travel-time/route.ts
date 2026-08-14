type MotisLeg = { mode?: string };
type MotisItinerary = { duration?: number; legs?: MotisLeg[] };
type MotisResponse = { direct?: MotisItinerary[]; itineraries?: MotisItinerary[] };

function parseCoordinate(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return null;
  const [lat, lon] = parts;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon] as const;
}

function bestDuration(items: MotisItinerary[], predicate: (modes: string[]) => boolean) {
  const durations = items
    .filter((item) => predicate((item.legs ?? []).map((leg) => leg.mode ?? "")))
    .map((item) => item.duration)
    .filter((duration): duration is number => typeof duration === "number" && duration > 0);
  if (!durations.length) return null;
  return Math.max(1, Math.round(Math.min(...durations) / 60));
}

function currentSfTrafficMultiplier(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  const isWeekday = !["Sat", "Sun"].includes(weekday);

  if (isWeekday) {
    if (minutes >= 6 * 60 + 30 && minutes < 9 * 60 + 30) return 1.55;
    if (minutes >= 15 * 60 && minutes < 19 * 60) return 1.65;
    if (minutes >= 10 * 60 && minutes < 15 * 60) return 1.25;
    if (minutes >= 19 * 60 && minutes < 21 * 60) return 1.25;
    return 1.1;
  }

  if (minutes >= 11 * 60 && minutes < 19 * 60) return 1.3;
  if (minutes >= 9 * 60 && minutes < 21 * 60) return 1.18;
  return 1.08;
}

function trafficAdjustedDuration(bestCaseMinutes: number | null) {
  if (bestCaseMinutes == null) return null;
  return Math.max(bestCaseMinutes + 1, Math.ceil(bestCaseMinutes * currentSfTrafficMultiplier()));
}

export async function GET(request: Request) {
  const input = new URL(request.url);
  const from = parseCoordinate(input.searchParams.get("from"));
  const to = parseCoordinate(input.searchParams.get("to"));
  if (!from || !to) {
    return Response.json({ error: "Valid from and to coordinates are required" }, { status: 400 });
  }

  const params = new URLSearchParams({
    fromPlace: from.join(","),
    toPlace: to.join(","),
    transitModes: "TRANSIT",
    directModes: "WALK,CAR",
    maxDirectTime: "7200",
    fastestDirectFactor: "10",
    numItineraries: "3",
    maxItineraries: "3",
    timetableView: "false",
    detailedLegs: "false",
    detailedTransfers: "false",
    useRoutedTransfers: "true",
    maxTravelTime: "180",
  });

  try {
    const response = await fetch(`https://api.transitous.org/api/v6/plan?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CourtWatch-SF/0.1 (+https://sfrecpark.org/1446/Tennis-Court-Directory)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Transitous returned ${response.status}`);
    const data = await response.json() as MotisResponse;
    const direct = data.direct ?? [];
    const transit = data.itineraries ?? [];
    const driveBestMinutes = bestDuration(direct, (modes) => modes.includes("CAR"));
    return Response.json({
      walkMinutes: bestDuration(direct, (modes) => modes.includes("WALK") && !modes.includes("CAR")),
      transitMinutes: bestDuration(transit, (modes) => modes.some((mode) => !["WALK", "BIKE", "CAR"].includes(mode))),
      driveBestMinutes,
      driveTrafficMinutes: trafficAdjustedDuration(driveBestMinutes),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Routing failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
