export type AvailabilityStatus = "live" | "stale" | "demo";

export type AvailabilitySlot = {
  id: string;
  courtName: string;
  locationId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  bookingUrl: string;
};

export type AvailabilitySnapshot = {
  updatedAt: string;
  sourceUrl: string;
  timezone: "America/Los_Angeles";
  status: AvailabilityStatus;
  window: { start: string; end: string };
  slots: AvailabilitySlot[];
};
