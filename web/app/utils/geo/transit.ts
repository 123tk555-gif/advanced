import type { Suggestion } from "./types";

/**
 * 駅・バス停などだけを探すときの種類(Google が受け付けるのは 5 つまで)。
 * transit_station に路面電車・港も含まれる。空港は含まれないので別に入れる(2026-11-22 に実測)。
 */
export const TRANSIT_TYPES = [
  "transit_station",
  "bus_stop",
  "train_station",
  "airport",
  "ferry_terminal",
];

/** 候補に付ける乗り物の種類。交通機関でなければ undefined */
export function transitKind(name: string, types: readonly string[]): string | undefined {
  const has = (...wanted: string[]) => wanted.some((type) => types.includes(type));
  if (has("airport", "international_airport")) return "空港";
  if (has("ferry_terminal")) return "港";
  if (has("tram_stop", "light_rail_station")) return "路面電車";
  if (has("train_station", "subway_station")) return "駅";
  if (has("bus_stop", "bus_station")) return "バス停";
  // JR の大きな駅などは transit_station としか付いていない
  if (has("transit_station")) return name.endsWith("駅") ? "駅" : "乗り場";
  return undefined;
}

/** ふつうの候補の後ろに、重ならない駅・バス停などを足す */
export function mergeSuggestions(general: Suggestion[], transit: Suggestion[]): Suggestion[] {
  return [...new Map([...general, ...transit].map((s) => [s.id, s])).values()];
}
