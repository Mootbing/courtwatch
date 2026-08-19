import { access } from "node:fs/promises";
import { chromium } from "playwright-core";

const SOURCE_URL = "https://www.rec.us/organizations/san-francisco-rec-park?tab=locations";
const TIMEZONE = "America/Los_Angeles";

async function executablePath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }
  throw new Error("Chromium was not found. Set CHROMIUM_PATH or use the included Dockerfile.");
}

function sfDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function to24Hour(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function extractCards(page) {
  return page.locator("div.rounded-xl.border.border-gray-200.p-3").evaluateAll((elements) =>
    elements.map((card) => {
      const link = card.querySelector('a[href^="/locations/"]');
      const name =
        card.querySelector('a[href^="/locations/"] p')?.textContent?.trim() ||
        card.querySelector("img")?.getAttribute("alt") ||
        "";
      const sections = [...card.querySelectorAll(":scope > div > div")].slice(1);
      const activities = sections.map((section) => {
        const activity = section.querySelector(":scope > p")?.textContent?.trim() || "";
        const openings = [...section.querySelectorAll(".swiper-slide > button")].map((button) => {
          const time = button.querySelector("p")?.textContent?.trim() || "";
          const values = [...button.querySelectorAll("div")]
            .map((element) => element.textContent?.trim())
            .filter(Boolean);
          return { time, duration: Number(values.at(-1)) || 60 };
        });
        return { activity, openings };
      });
      return { name, href: link?.getAttribute("href") || "", activities };
    }),
  );
}

async function loadDay(page, url, date) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const status = response?.status() ?? 0;
      if (status === 429 || status >= 500) throw new Error(`Rec responded with HTTP ${status} for ${date}`);
      await page.locator("div.rounded-xl.border.border-gray-200.p-3").first().waitFor({
        state: "visible",
        timeout: 30_000,
      });
      // Location cards render before their availability carousels finish hydrating; a fixed
      // sleep is not enough on cold loads, so wait for a slide button (fully booked days
      // legitimately never get one, hence the swallowed timeout) plus a short settle.
      await page
        .waitForFunction(() => document.querySelector(".swiper-slide button"), { timeout: 10_000 })
        .catch(() => {});
      await page.waitForTimeout(1_000);
      const cards = await extractCards(page);
      const openings = cards.reduce(
        (total, card) => total + card.activities.reduce((n, activity) => n + activity.openings.length, 0),
        0,
      );
      if (openings === 0 && attempt < 3) {
        console.warn(`No openings visible for ${date} (attempt ${attempt}/3); retrying in case hydration lagged.`);
        await page.waitForTimeout(3_000 * attempt);
        continue;
      }
      return cards;
    } catch (error) {
      lastError = error;
      console.warn(`Rec page failed for ${date} (attempt ${attempt}/3): ${error.message}`);
      // Back off harder when the failure looks like rate limiting.
      if (attempt < 3) await page.waitForTimeout((/HTTP (429|5\d\d)/.test(error.message) ? 10_000 : 2_000) * attempt);
    }
  }
  throw new Error(`Rec availability did not load for ${date} after 3 attempts`, { cause: lastError });
}

export async function scrapeAvailability({ days = 8 } = {}) {
  const browser = await chromium.launch({
    executablePath: await executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const slots = [];
  const failedDates = [];
  try {
    const page = await browser.newPage({
      locale: "en-US",
      timezoneId: TIMEZONE,
      viewport: { width: 1365, height: 900 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 CourtWatchSF/1.0",
    });
    // The card markup only needs the img alt text, so skip heavy assets to keep the
    // request volume low enough that eight back-to-back loads do not trip rate limiting.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      return type === "image" || type === "media" || type === "font" ? route.abort() : route.continue();
    });

    for (let offset = 0; offset < days; offset += 1) {
      const date = sfDate(offset);
      const dateParam = `${date}T12:00:00.000Z`;
      const url = `${SOURCE_URL}&date=${encodeURIComponent(dateParam)}`;

      let cards;
      try {
        cards = await loadDay(page, url, date);
      } catch (error) {
        // One bad day must not sink the other seven; the caller backfills it
        // from the previous snapshot.
        console.error(error.message);
        failedDates.push(date);
        continue;
      } finally {
        if (offset < days - 1) await page.waitForTimeout(1_500 + Math.floor(Math.random() * 1_500));
      }

      cards.forEach((card) => {
        const locationId = card.href.split("/").filter(Boolean).at(-1);
        if (!card.name || !locationId) return;
        card.activities
          .filter((activity) => activity.activity.toLowerCase() === "tennis")
          .forEach((activity) => {
            activity.openings.forEach((opening) => {
              const startTime = to24Hour(opening.time);
              if (!startTime) return;
              const durationMinutes = opening.duration;
              slots.push({
                id: `${date}-${locationId}-${startTime}-${durationMinutes}`,
                courtName: card.name,
                locationId,
                date,
                startTime,
                endTime: addMinutes(startTime, durationMinutes),
                durationMinutes,
                bookingUrl: `https://www.rec.us/locations/${locationId}?date=${encodeURIComponent(dateParam)}`,
              });
            });
          });
      });
    }
  } finally {
    await browser.close();
  }

  if (failedDates.length === days) {
    throw new Error(`All ${days} days failed to load; keeping the previous snapshot.`);
  }

  const uniqueSlots = [...new Map(slots.map((slot) => [slot.id, slot])).values()];
  uniqueSlots.sort((a, b) => `${a.date}${a.startTime}${a.courtName}`.localeCompare(`${b.date}${b.startTime}${b.courtName}`));

  return {
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://www.rec.us/sfrecpark",
    timezone: TIMEZONE,
    status: "live",
    window: { start: sfDate(0), end: sfDate(days - 1) },
    failedDates,
    slots: uniqueSlots,
  };
}
