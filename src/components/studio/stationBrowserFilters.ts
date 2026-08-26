import { shouldShowInspiredPill } from "@/lib/inspired-stations";

export type TopFilter = "all" | "decades" | "genres" | "mixes" | "stations" | "inspired";

export const TOP_PILLS: { id: TopFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "decades", label: "Decades" },
  { id: "genres", label: "Genres" },
  { id: "mixes", label: "My Mixes" },
  { id: "stations", label: "My Stations" },
  { id: "inspired", label: "Inspired" },
];

export function visibleTopPills(
  inspiredStations: readonly unknown[],
  inspiredLoading: boolean,
): { id: TopFilter; label: string }[] {
  const showInspired = shouldShowInspiredPill(inspiredStations, inspiredLoading);
  return TOP_PILLS.filter((pill) => pill.id !== "inspired" || showInspired);
}

export function inspiredRowMode(
  inspiredStations: readonly unknown[],
  inspiredLoading: boolean,
): "hidden" | "skeleton" | "cards" {
  if (!shouldShowInspiredPill(inspiredStations, inspiredLoading)) return "hidden";
  if (inspiredLoading && inspiredStations.length === 0) return "skeleton";
  return "cards";
}
