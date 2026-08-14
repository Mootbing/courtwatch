"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AvailabilitySlot, AvailabilitySnapshot } from "../lib/types";

type ViewMode = "day" | "week" | "month" | "map";

const PACIFIC = "America/Los_Angeles";
const MapView = dynamic(() => import("./MapView").then((module) => module.MapView), { ssr: false });

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function fromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function addDays(date: Date, amount: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const distance = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - distance);
  return copy;
}

function startOfMonthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  return startOfWeek(first);
}

function formatRange(date: Date, mode: ViewMode) {
  const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
  if (mode === "month") return month.format(date);
  if (mode === "day" || mode === "map") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(date);
  }
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const short = (value: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
  return `${short(start)} – ${short(end)}, ${end.getFullYear()}`;
}

function formatTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(2020, 0, 1, hour, minute),
  );
}

function formatUpdated(value?: string) {
  if (!value) return "Waiting for first refresh";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZone: PACIFIC,
  }).format(new Date(value));
}

function eventColor(name: string) {
  const palette = ["mint", "sky", "peach", "lilac", "gold"];
  const score = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return palette[score % palette.length];
}

function WeekGrid({
  days,
  slotsByDay,
  onOpenDay,
}: {
  days: Date[];
  slotsByDay: Map<string, AvailabilitySlot[]>;
  onOpenDay: (day: Date) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const firstOpenKey = days.map(dateKey).find((key) => (slotsByDay.get(key)?.length ?? 0) > 0);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !firstOpenKey || grid.scrollWidth <= grid.clientWidth) return;
    const target = grid.querySelector<HTMLElement>(`[data-date="${firstOpenKey}"]`);
    if (!target) return;
    grid.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
  }, [firstOpenKey]);

  return (
    <div className="week-grid" ref={gridRef}>
      {days.map((day) => {
        const key = dateKey(day);
        const daySlots = slotsByDay.get(key) ?? [];
        const isToday = key === dateKey(new Date());
        return (
          <section className="week-day" data-date={key} key={key}>
            <button className={`day-heading ${isToday ? "is-today" : ""}`} onClick={() => onOpenDay(day)} type="button">
              <span>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}</span>
              <strong>{day.getDate()}</strong>
            </button>
            <div className="day-slots">
              {daySlots.slice(0, 6).map((slot) => (
                <a className={`slot ${eventColor(slot.courtName)}`} href={slot.bookingUrl} target="_blank" rel="noreferrer" key={slot.id}>
                  <span className="slot-time">{formatTime(slot.startTime)}</span>
                  <strong className="slot-name">{slot.courtName}</strong>
                  <span className="slot-duration">{slot.durationMinutes} min</span>
                </a>
              ))}
              {daySlots.length === 0 && <p className="empty-day">No openings</p>}
              {daySlots.length > 6 && (
                <button className="more-slots" onClick={() => onOpenDay(day)} type="button">
                  +{daySlots.length - 6} more openings
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayView({ day, slots }: { day: Date; slots: AvailabilitySlot[] }) {
  return (
    <div className="day-view">
      <div className="day-view-title">
        <div className="date-tile">
          <span>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}</span>
          <strong>{day.getDate()}</strong>
        </div>
        <div>
          <h3>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(day)}</h3>
          <p>{slots.length} open {slots.length === 1 ? "time" : "times"}</p>
        </div>
      </div>
      {slots.length > 0 ? (
        <div className="day-list">
          {slots.map((slot) => (
            <a className="day-row" href={slot.bookingUrl} target="_blank" rel="noreferrer" key={slot.id}>
              <time>{formatTime(slot.startTime)}</time>
              <i className={`court-dot ${eventColor(slot.courtName)}`} aria-hidden="true" />
              <strong>{slot.courtName}</strong>
              <span>{slot.durationMinutes} minutes</span>
              <b>Book on Rec →</b>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-large">No matching openings on this date.</div>
      )}
    </div>
  );
}

export function CourtWatch() {
  const [snapshot, setSnapshot] = useState<AvailabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => fromKey(dateKey(new Date())));
  const [court, setCourt] = useState("all");
  const [timeBand, setTimeBand] = useState("all");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/availability", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: AvailabilitySnapshot) => active && setSnapshot(data))
      .catch(() => active && setSnapshot(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const courts = useMemo(
    () => [...new Set(snapshot?.slots.map((slot) => slot.courtName) ?? [])].sort(),
    [snapshot],
  );

  const slots = useMemo(() => {
    return (snapshot?.slots ?? []).filter((slot) => {
      if (court !== "all" && slot.courtName !== court) return false;
      const hour = Number(slot.startTime.slice(0, 2));
      if (timeBand === "morning" && hour >= 12) return false;
      if (timeBand === "afternoon" && (hour < 12 || hour >= 17)) return false;
      if (timeBand === "evening" && hour < 17) return false;
      return true;
    });
  }, [snapshot, court, timeBand]);

  const days = useMemo(() => {
    if (mode === "day" || mode === "map") return [cursor];
    const start = mode === "week" ? startOfWeek(cursor) : startOfMonthGrid(cursor);
    const count = mode === "week" ? 7 : 42;
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }, [cursor, mode]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    slots.forEach((slot) => {
      const items = map.get(slot.date) ?? [];
      items.push(slot);
      map.set(slot.date, items);
    });
    map.forEach((items) => items.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [slots]);

  const currentKey = dateKey(cursor);
  const todaysSlots = slotsByDay.get(currentKey) ?? [];
  const visibleKeys = new Set(days.map(dateKey));
  const visibleSlots = slots.filter((slot) => visibleKeys.has(slot.date));
  const visibleCourts = new Set(visibleSlots.map((slot) => slot.courtName)).size;

  function move(direction: -1 | 1) {
    if (mode === "day" || mode === "map") setCursor((value) => addDays(value, direction));
    if (mode === "week") setCursor((value) => addDays(value, direction * 7));
    if (mode === "month") {
      setCursor((value) => new Date(value.getFullYear(), value.getMonth() + direction, 1, 12));
    }
  }

  function openDay(day: Date) {
    setCursor(day);
    setMode("day");
  }

  const feedUrl =
    process.env.NEXT_PUBLIC_CALENDAR_FEED_URL ||
    (typeof window === "undefined" ? "/calendar.ics" : `${window.location.origin}/calendar.ics`);
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
    feedUrl.replace(/^https?:\/\//, "webcal://"),
  )}`;

  async function copyFeed() {
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CourtWatch SF home">
          <span className="brand-mark" aria-hidden="true">●</span>
          <span>CourtWatch <em>SF</em></span>
        </a>
        <div className="topbar-actions">
          <span className={`live-status ${snapshot?.status ?? "demo"}`}>
            <i aria-hidden="true" /> {snapshot?.status === "live" ? "Live" : snapshot?.status === "stale" ? "Stale" : "Preview"}
          </span>
          <a className="button button-dark" href={googleUrl} target="_blank" rel="noreferrer">
            <span aria-hidden="true">＋</span> Add to Google Calendar
          </a>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">SAN FRANCISCO PUBLIC TENNIS</p>
          <h1>Find an open court.<br /><span>Play more tennis.</span></h1>
          <p className="hero-copy">Every reservable SF court, organized like the calendar you already use. See a time you like? Jump straight to Rec and book it.</p>
        </div>
        <aside className="sync-card">
          <div className="sync-icon" aria-hidden="true">↻</div>
          <div>
            <strong>Hourly court check</strong>
            <span>Last refreshed {formatUpdated(snapshot?.updatedAt)}</span>
          </div>
          <button className="copy-button" onClick={copyFeed} type="button">
            {copied ? "Copied!" : "Copy .ics feed"}
          </button>
        </aside>
      </section>

      <section className="calendar-card" aria-busy={loading}>
        <div className="calendar-toolbar">
          <div className="date-controls">
            <button onClick={() => move(-1)} aria-label={`Previous ${mode}`} type="button">←</button>
            <button className="today-button" onClick={() => setCursor(fromKey(dateKey(new Date())))} type="button">Today</button>
            <button onClick={() => move(1)} aria-label={`Next ${mode}`} type="button">→</button>
            <h2>{formatRange(cursor, mode)}</h2>
          </div>
          <div className="view-switch" aria-label="Calendar view">
            {(["day", "week", "month", "map"] as ViewMode[]).map((view) => (
              <button key={view} className={mode === view ? "active" : ""} onClick={() => setMode(view)} type="button">
                {view[0].toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <label>
            <span>Court</span>
            <select value={court} onChange={(event) => setCourt(event.target.value)}>
              <option value="all">All courts</option>
              {courts.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Time</span>
            <select value={timeBand} onChange={(event) => setTimeBand(event.target.value)}>
              <option value="all">Any time</option>
              <option value="morning">Morning · before noon</option>
              <option value="afternoon">Afternoon · 12–5</option>
              <option value="evening">Evening · after 5</option>
            </select>
          </label>
          <div className="results-summary">
            <strong>{visibleSlots.length}</strong> open times
            <span>across {visibleCourts} courts</span>
          </div>
        </div>

        {loading && <div className="loading-state">Checking courts…</div>}

        {!loading && mode === "week" && <WeekGrid days={days} slotsByDay={slotsByDay} onOpenDay={openDay} />}

        {!loading && mode === "day" && <DayView day={cursor} slots={todaysSlots} />}

        {!loading && mode === "month" && (
          <div className="month-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const daySlots = slotsByDay.get(key) ?? [];
              const outside = day.getMonth() !== cursor.getMonth();
              const isToday = key === dateKey(new Date());
              return (
                <button className={`month-day ${outside ? "outside" : ""}`} onClick={() => openDay(day)} type="button" key={key}>
                  <span className={isToday ? "today-number" : ""}>{day.getDate()}</span>
                  {daySlots.length > 0 ? (
                    <>
                      <strong>{daySlots.length} open</strong>
                      {[...new Set(daySlots.map((slot) => slot.courtName))].slice(0, 2).map((name) => <i className={eventColor(name)} key={name}>{name}</i>)}
                    </>
                  ) : <em>—</em>}
                </button>
              );
            })}
          </div>
        )}

        {!loading && mode === "map" && <MapView slots={todaysSlots} date={currentKey} />}
      </section>

      <footer>
        <p><strong>Heads up:</strong> availability is informational and can change before you finish booking. Rec is always the source of truth.</p>
        <div><a href="https://sfrecpark.org/1446/Tennis-Court-Directory" target="_blank" rel="noreferrer">SF court directory ↗</a><a href="https://www.rec.us/sfrecpark" target="_blank" rel="noreferrer">Official booking site ↗</a></div>
      </footer>
    </main>
  );
}
