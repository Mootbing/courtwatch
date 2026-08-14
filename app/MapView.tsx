"use client";

import { divIcon } from "leaflet";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { AvailabilitySlot } from "../lib/types";

const COURT_COORDINATES: Record<string, [number, number]> = {
  "Alice Marble": [37.801122, -122.419596],
  Balboa: [37.7227035, -122.44509],
  "Buena Vista": [37.7677271, -122.4402904],
  "Crocker Amazon": [37.715102, -122.432154],
  Dolores: [37.76127, -122.4273142],
  DuPont: [37.7826865, -122.4908608],
  Fulton: [37.7735648, -122.4869172],
  "Glen Canyon": [37.7363216, -122.4398164],
  Hamilton: [37.7845624, -122.4353242],
  "Helen Wills": [37.795999, -122.420253],
  Jackson: [37.763809, -122.398743],
  "Joe DiMaggio": [37.8028487, -122.4122092],
  "J.P. Murphy": [37.7515909, -122.4652452],
  Lafayette: [37.792565, -122.4262903],
  McLaren: [37.718319, -122.414096],
  "Minnie & Lovie Ward": [37.7161871, -122.4589561],
  Miraloma: [37.7385263, -122.4486817],
  Moscone: [37.801298, -122.433128],
  "Mountain Lake": [37.7866094, -122.4713131],
  "Parkside Square": [37.7383463, -122.4837811],
  "Potrero Hill": [37.756181, -122.3972068],
  "Presidio Wall": [37.7908, -122.4538],
  Richmond: [37.7861, -122.4768],
  Rossi: [37.7790653, -122.4582804],
  "Stern Grove": [37.7348237, -122.474537],
  "St. Mary's": [37.7342908, -122.4217376],
  Sunset: [37.7570992, -122.4868689],
  "Upper Noe": [37.742388, -122.4284382],
};

type TravelEstimate = {
  walkMinutes: number | null;
  transitMinutes: number | null;
  driveBestMinutes: number | null;
  driveTrafficMinutes: number | null;
};

type LocationStatus = "idle" | "asking" | "ready" | "denied" | "unavailable";

const GOOGLE_TRAVEL_MODES = [
  { label: "Walk", mode: "walking", estimate: "walkMinutes" },
  { label: "Transit", mode: "transit", estimate: "transitMinutes" },
  { label: "Drive best", mode: "driving", estimate: "driveBestMinutes" },
  { label: "Drive traffic", mode: "driving", estimate: "driveTrafficMinutes" },
] as const;

function googleMapsDirectionsUrl(
  origin: [number, number],
  destination: [number, number],
  travelMode: "walking" | "transit" | "driving",
) {
  const params = new URLSearchParams({
    api: "1",
    origin: origin.join(","),
    destination: destination.join(","),
    travelmode: travelMode,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const MAP_HOUR_HEIGHT = 56;
const SF_CENTER: [number, number] = [37.7615, -122.442];

const formatTime = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2020, 0, 1, hour, minute),
  );
};

function timeMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function pacificDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function pacificTimeMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

function courtColor(name: string) {
  const palette = ["mint", "sky", "peach", "lilac", "gold"];
  const score = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return palette[score % palette.length];
}

function distanceMiles(from: [number, number], to: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthMiles = 3958.8;
  const dLat = radians(to[0] - from[0]);
  const dLon = radians(to[1] - from[1]);
  const lat1 = radians(from[0]);
  const lat2 = radians(to[0]);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function formatDistance(value: number) {
  return value < 0.1 ? "<0.1 mi" : `${value.toFixed(1)} mi`;
}

type PositionedSlot = { slot: AvailabilitySlot; column: number; columns: number };

function positionDayOverlaps(slots: AvailabilitySlot[]): PositionedSlot[] {
  const sorted = [...slots].sort((a, b) =>
    a.startTime === b.startTime
      ? b.durationMinutes - a.durationMinutes
      : a.startTime.localeCompare(b.startTime),
  );
  const positioned: PositionedSlot[] = [];
  let cluster: AvailabilitySlot[] = [];
  let clusterEnd = -1;

  function placeCluster() {
    if (!cluster.length) return;
    const columnEnds: number[] = [];
    const assignments = cluster.map((slot) => {
      const start = timeMinutes(slot.startTime);
      const end = start + slot.durationMinutes;
      let column = columnEnds.findIndex((value) => value <= start);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = end;
      return { slot, column };
    });
    assignments.forEach((item) => positioned.push({ ...item, columns: columnEnds.length }));
    cluster = [];
    clusterEnd = -1;
  }

  sorted.forEach((slot) => {
    const start = timeMinutes(slot.startTime);
    const end = start + slot.durationMinutes;
    if (cluster.length && start >= clusterEnd) placeCluster();
    cluster.push(slot);
    clusterEnd = Math.max(clusterEnd, end);
  });
  placeCluster();
  return positioned;
}

function DaySchedule({ slots, date }: { slots: AvailabilitySlot[]; date: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const displayDate = new Date(`${date}T12:00:00`);
  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
    (_, index) => DAY_START_HOUR + index,
  );
  const events = positionDayOverlaps(slots);
  const bodyHeight = (DAY_END_HOUR - DAY_START_HOUR) * MAP_HOUR_HEIGHT;
  const nowMinute = pacificTimeMinutes(now);
  const nowTop = ((nowMinute - DAY_START_HOUR * 60) / 60) * MAP_HOUR_HEIGHT;
  const showNow = date === pacificDateKey(now)
    && nowMinute >= DAY_START_HOUR * 60
    && nowMinute <= DAY_END_HOUR * 60;

  return (
    <aside className="map-day-panel" aria-label="Day schedule">
      <header className="map-day-header">
        <div className="map-date-tile">
          <span>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(displayDate)}</span>
          <strong>{displayDate.getDate()}</strong>
        </div>
        <div>
          <strong>Day schedule</strong>
          <span>{slots.length} open {slots.length === 1 ? "time" : "times"}</span>
        </div>
      </header>
      <div className="map-day-scroll">
        <div className="map-day-timeline" style={{ height: bodyHeight }}>
          <div className="map-time-axis">
            {hours.map((hour) => (
              <span style={{ top: (hour - DAY_START_HOUR) * MAP_HOUR_HEIGHT }} key={hour}>
                {formatTime(`${String(hour).padStart(2, "0")}:00`)}
              </span>
            ))}
          </div>
          <div className="map-event-lane">
            {hours.map((hour) => (
              <i className="map-hour-line" style={{ top: (hour - DAY_START_HOUR) * MAP_HOUR_HEIGHT }} key={hour} />
            ))}
            {showNow && <div className="map-now-line" style={{ top: nowTop }} aria-label="Current time" />}
            {events.map(({ slot, column, columns }) => {
              const top = ((timeMinutes(slot.startTime) - DAY_START_HOUR * 60) / 60) * MAP_HOUR_HEIGHT;
              const height = Math.max(31, (slot.durationMinutes / 60) * MAP_HOUR_HEIGHT - 2);
              const style = {
                top,
                height,
                left: `calc(${(column / columns) * 100}% + 2px)`,
                width: `calc(${100 / columns}% - 4px)`,
              } as CSSProperties;
              return (
                <a
                  className={`map-day-event ${courtColor(slot.courtName)}`}
                  style={style}
                  href={slot.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Book ${slot.courtName} at ${formatTime(slot.startTime)}`}
                  key={slot.id}
                >
                  <strong>{slot.courtName}</strong>
                  <span>{formatTime(slot.startTime)}</span>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MapFocus({
  court,
  userLocation,
}: {
  court?: [number, number];
  userLocation: [number, number] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!court) return;
    if (userLocation) {
      map.fitBounds([userLocation, court], { padding: [65, 65], maxZoom: 14, animate: true });
    } else {
      map.flyTo(court, 14, { duration: 0.8 });
    }
  }, [court, map, userLocation]);

  return null;
}

function estimateLabel(value: number | null | undefined, loading: boolean) {
  if (loading) return "…";
  if (value == null) return "—";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function MapView({ slots, date }: { slots: AvailabilitySlot[]; date: string }) {
  const groups = useMemo(
    () =>
      [...slots.reduce((map, slot) => {
        const current = map.get(slot.courtName) ?? [];
        current.push(slot);
        map.set(slot.courtName, current);
        return map;
      }, new Map<string, AvailabilitySlot[]>())]
        .filter(([name]) => COURT_COORDINATES[name])
        .map(([name, courtSlots]) => [
          name,
          [...courtSlots].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        ] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    [slots],
  );
  const [selectedName, setSelectedName] = useState<string | null>(groups[0]?.[0] ?? null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [estimates, setEstimates] = useState<Record<string, TravelEstimate>>({});
  const [routeLoading, setRouteLoading] = useState<string[]>([]);
  const [routeErrors, setRouteErrors] = useState<Record<string, string>>({});
  const [routeAttempt, setRouteAttempt] = useState(0);
  const [routeGeometry, setRouteGeometry] = useState<Record<string, [number, number][]>>({});
  const [geometryLoading, setGeometryLoading] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const rankedGroups = useMemo(() => {
    const origin = userLocation ?? SF_CENTER;
    return groups
      .map(([name, courtSlots]) => ({
        name,
        courtSlots,
        distance: distanceMiles(origin, COURT_COORDINATES[name]),
      }))
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  }, [groups, userLocation]);

  useEffect(() => {
    if (!groups.length) {
      setSelectedName(null);
      return;
    }
    if (!selectedName || !groups.some(([name]) => name === selectedName)) {
      setSelectedName(groups[0][0]);
    }
  }, [groups, selectedName]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("asking");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location: [number, number] = [coords.latitude, coords.longitude];
        const nearest = groups
          .map(([name]) => ({ name, distance: distanceMiles(location, COURT_COORDINATES[name]) }))
          .sort((a, b) => a.distance - b.distance)[0];
        setEstimates({});
        setRouteGeometry({});
        setUserLocation(location);
        if (nearest) setSelectedName(nearest.name);
        setLocationStatus("ready");
        setRouteErrors({});
      },
      (error) => {
        setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
    );
  }

  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    if (!userLocation || !groups.length) return;
    const controller = new AbortController();
    const names = groups.map(([name]) => name);
    let nextIndex = 0;
    setRouteLoading(names);
    setRouteErrors({});

    async function loadNext() {
      while (nextIndex < names.length && !controller.signal.aborted) {
        const name = names[nextIndex++];
        const destination = COURT_COORDINATES[name];
        const params = new URLSearchParams({
          from: userLocation.join(","),
          to: destination.join(","),
        });
        try {
          const response = await fetch(`/api/travel-time?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Routing is temporarily unavailable");
          const result = await response.json() as TravelEstimate;
          setEstimates((current) => ({ ...current, [name]: result }));
        } catch (error) {
          if (error instanceof Error && error.name !== "AbortError") {
            setRouteErrors((current) => ({ ...current, [name]: error.message }));
          }
        } finally {
          if (!controller.signal.aborted) {
            setRouteLoading((current) => current.filter((item) => item !== name));
          }
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(3, names.length) }, () => loadNext()));
    return () => controller.abort();
  }, [groups, routeAttempt, userLocation]);

  useEffect(() => {
    if (!userLocation || !selectedName || routeGeometry[selectedName]) return;
    const destination = COURT_COORDINATES[selectedName];
    if (!destination) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({
        from: userLocation.join(","),
        to: destination.join(","),
      });
      setGeometryLoading(selectedName);
      try {
        const response = await fetch(`/api/route-geometry?${params}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Route preview unavailable");
        const result = await response.json() as { positions: [number, number][] };
        setRouteGeometry((current) => ({ ...current, [selectedName]: result.positions }));
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "AbortError") {
          setGeometryLoading(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setGeometryLoading((current) => current === selectedName ? null : current);
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [routeGeometry, selectedName, userLocation]);

  function selectCourt(name: string, scrollCard = false, retryFailed = false) {
    if (retryFailed && name === selectedName && routeErrors[name]) {
      setRouteAttempt((attempt) => attempt + 1);
    }
    setSelectedName(name);
    if (retryFailed) {
      setRouteErrors((current) => {
        if (!current[name]) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
    if (scrollCard) {
      cardRefs.current[name]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }

  const selectedCoordinates = selectedName ? COURT_COORDINATES[selectedName] : undefined;
  const loadedCount = groups.filter(([name]) => estimates[name]).length;
  const locationButtonCopy = locationStatus === "asking"
    ? "Finding you…"
    : locationStatus === "ready"
      ? routeLoading.length
        ? `Loading routes ${loadedCount}/${groups.length}`
        : "All routes loaded"
      : locationStatus === "denied"
        ? "Location blocked — retry"
        : locationStatus === "unavailable"
          ? "Try location again"
          : "Use my location";

  return (
    <div className="map-shell">
      <div className="map-location-bar">
        <div>
          <strong>Travel time from where you are</strong>
          <span>Used only for trip estimates; CourtWatch does not save your location.</span>
        </div>
        <button
          className={locationStatus === "ready" ? "location-ready" : ""}
          onClick={requestLocation}
          disabled={locationStatus === "asking"}
          type="button"
        >
          <i aria-hidden="true" /> {locationButtonCopy}
        </button>
      </div>

      <div className="map-workspace">
        <DaySchedule slots={slots} date={date} />
        <div className="map-stage">
          <MapContainer center={SF_CENTER} zoom={12} scrollWheelZoom className="court-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFocus court={selectedCoordinates} userLocation={userLocation} />
          {selectedName && routeGeometry[selectedName] && (
            <Polyline
              positions={routeGeometry[selectedName]}
              pathOptions={{ color: "#4285f4", weight: 6, opacity: 0.9 }}
            />
          )}
          {userLocation && (
            <CircleMarker
              center={userLocation}
              radius={8}
              pathOptions={{ color: "#ffffff", fillColor: "#4285f4", fillOpacity: 1, weight: 3 }}
            >
              <Popup>You are here</Popup>
            </CircleMarker>
          )}
          {rankedGroups.map(({ name, courtSlots, distance }, index) => {
            const selected = selectedName === name;
            const marker = divIcon({
              className: "court-marker-wrap",
              html: `<span class="court-marker${selected ? " selected" : ""}"><b>${index + 1}</b></span>`,
              iconSize: [38, 42],
              iconAnchor: [19, 42],
            });
            return (
              <Marker
                position={COURT_COORDINATES[name]}
                icon={marker}
                eventHandlers={{ click: () => selectCourt(name, true, true) }}
                key={name}
              >
                <Popup className="court-popup" minWidth={220}>
                  <strong>{name}</strong>
                  <span>#{index + 1} nearest · {formatDistance(distance)} · {courtSlots.length} open times</span>
                  <div className="popup-slots">
                    {courtSlots.slice(0, 6).map((slot) => (
                      <a href={slot.bookingUrl} target="_blank" rel="noreferrer" key={slot.id}>
                        {formatTime(slot.startTime)} <small>{slot.durationMinutes} min</small>
                      </a>
                    ))}
                  </div>
                </Popup>
              </Marker>
            );
          })}
          </MapContainer>
          <div className="map-legend">
            <strong>{groups.length}</strong>
            <span>courts with openings</span>
            <small>Numbers rank distance {userLocation ? "from you" : "from SF center"}</small>
          </div>
          {groups.length === 0 && <div className="map-empty">No matching openings on this date.</div>}
        </div>
      </div>

      {groups.length > 0 && (
        <section className="map-cards-section" aria-label="Courts with openings">
          <div className="map-cards-heading">
            <div>
              <strong>Open courts near you</strong>
              <span>Routes load automatically · traffic uses the current SF time.</span>
            </div>
            <span>{groups.length} courts</span>
          </div>
          <div className="court-card-track">
            {rankedGroups.map(({ name, courtSlots, distance }, index) => {
              const selected = selectedName === name;
              const estimate = estimates[name];
              const loading = routeLoading.includes(name);
              const destination = COURT_COORDINATES[name];
              return (
                <div
                  className={`map-court-card ${selected ? "selected" : ""}`}
                  ref={(node) => { cardRefs.current[name] = node; }}
                  onMouseEnter={() => selectCourt(name)}
                  onFocus={() => selectCourt(name)}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a")) return;
                    selectCourt(name, false, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectCourt(name, false, true);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  key={name}
                >
                  <header>
                    <div>
                      <span>#{index + 1} · {formatDistance(distance)} · {courtSlots.length} OPEN {courtSlots.length === 1 ? "TIME" : "TIMES"}</span>
                      <h3>{name}</h3>
                    </div>
                    <i aria-hidden="true">↗</i>
                  </header>
                  <div className="travel-times" aria-live={selected ? "polite" : "off"}>
                    {GOOGLE_TRAVEL_MODES.map(({ label, mode, estimate: estimateKey }) => {
                      const directionsUrl = userLocation
                        ? googleMapsDirectionsUrl(userLocation, destination, mode)
                        : null;
                      return (
                        <a
                          href={directionsUrl ?? "#"}
                          target={directionsUrl ? "_blank" : undefined}
                          rel={directionsUrl ? "noreferrer" : undefined}
                          aria-label={directionsUrl
                            ? `Open ${label.toLowerCase()} directions to ${name} in Google Maps`
                            : `Share location for ${label.toLowerCase()} directions to ${name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!directionsUrl) {
                              event.preventDefault();
                              requestLocation();
                            }
                          }}
                          title={estimateKey === "driveTrafficMinutes"
                            ? "Estimated from current San Francisco time-of-day traffic"
                            : undefined}
                          key={estimateKey}
                        >
                          <span>{label} ↗</span>
                          <strong>{estimateLabel(estimate?.[estimateKey], loading)}</strong>
                        </a>
                      );
                    })}
                  </div>
                  {selected && userLocation && geometryLoading === name && (
                    <p className="travel-note route-preview-loading">Drawing OSM route…</p>
                  )}
                  {!userLocation && selected && (
                    <p className="travel-note">Allow location above to estimate your trip.</p>
                  )}
                  {userLocation && selected && !estimate && !loading && routeErrors[name] && (
                    <p className="travel-note error">{routeErrors[name]}. Select the card to retry.</p>
                  )}
                  {!selected && !estimate && <p className="travel-note">Tap for travel times</p>}
                  <div className="card-booking-times">
                    {courtSlots.slice(0, 4).map((slot) => (
                      <a href={slot.bookingUrl} target="_blank" rel="noreferrer" key={slot.id}>
                        <span>{formatTime(slot.startTime)}</span>
                        <small>Book ↗</small>
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="routing-credit">
            Trip estimates by <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transitous</a> using OpenStreetMap and open transit data. Times are estimates; the route provider may briefly log requests under its <a href="https://transitous.org/privacy/" target="_blank" rel="noreferrer">privacy policy</a>.
          </p>
        </section>
      )}
    </div>
  );
}
