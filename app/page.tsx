import type { Metadata } from "next";
import { CourtWatch } from "./CourtWatch";

export const metadata: Metadata = {
  title: "CourtWatch SF",
  description: "A faster calendar for finding and booking available San Francisco tennis courts.",
};

export default function Home() {
  return <CourtWatch />;
}
