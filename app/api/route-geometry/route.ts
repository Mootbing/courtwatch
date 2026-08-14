type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { type?: string; coordinates?: number[][] };
  }>;
};

function parseCoordinate(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return null;
  const [lat, lon] = parts;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon] as const;
}

export async function GET(request: Request) {
  const input = new URL(request.url);
  const from = parseCoordinate(input.searchParams.get("from"));
  const to = parseCoordinate(input.searchParams.get("to"));
  if (!from || !to) {
    return Response.json({ error: "Valid from and to coordinates are required" }, { status: 400 });
  }

  const coordinates = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CourtWatch-SF/0.1 (+https://sfrecpark.org/1446/Tennis-Court-Directory)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OSRM returned ${response.status}`);
    const data = await response.json() as OsrmResponse;
    const route = data.routes?.[0];
    const coordinatesList = route?.geometry?.coordinates;
    if (data.code !== "Ok" || !coordinatesList?.length) throw new Error("No route found");
    return Response.json({
      positions: coordinatesList.map(([lon, lat]) => [lat, lon]),
      distanceMeters: route.distance ?? null,
      durationSeconds: route.duration ?? null,
    }, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route lookup failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
