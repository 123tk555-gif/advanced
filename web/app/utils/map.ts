import type { Place } from "~/types/api";

/** 移動手段 */
export const MODES = { walk: "徒歩", transit: "公共交通", car: "車" } as const;
export type Mode = keyof typeof MODES;
export const GOOGLE_MODES: Record<Mode, string> = {
  walk: "walking",
  transit: "transit",
  car: "driving",
};

function distanceKm(a: Place, b: Place): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 移動時間の目安(分)。Google マップをつなぐ段階で、Routes API の結果に置き換える */
export function legMinutes(a: Place, b: Place, mode: Mode): number {
  const km = distanceKm(a, b) * 1.3;
  if (mode === "walk") return Math.max(1, Math.round((km / 4.5) * 60));
  if (mode === "car") return Math.max(3, Math.round((km / 22) * 60) + 3);
  return Math.max(5, Math.round((km / 20) * 60) + 8);
}

export function fmtMinutes(min: number): string {
  return min >= 60 ? `約 ${Math.floor(min / 60)} 時間 ${min % 60} 分` : `約 ${min} 分`;
}

export function googleSearchUrl(place: Place): string {
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
}

export function googleRouteUrl(places: Place[], mode: Mode): string | null {
  if (places.length < 2) return null;
  const ll = (p: Place) => `${p.lat},${p.lng}`;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", ll(places[0] as Place));
  url.searchParams.set("destination", ll(places.at(-1) as Place));
  if (places.length > 2) url.searchParams.set("waypoints", places.slice(1, -1).map(ll).join("|"));
  url.searchParams.set("travelmode", GOOGLE_MODES[mode]);
  return url.toString();
}

/** 地図の模型に描く点(ピンと名前の位置)。近くの名前と重なるときは上下にずらす */
export function layoutPins(places: Place[], width: number, height: number, pad = 40) {
  if (places.length === 0) return [];
  const lats = places.map((p) => p.lat);
  const lngs = places.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, 0.01);
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 0.01);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const placed: { left: number; width: number; y: number }[] = [];
  return places.map((p) => {
    const x = width / 2 + (p.lng - cx) * kx * scale;
    const y = height / 2 - (p.lat - midLat) * scale;
    const anchor = x > width - 120 ? "end" : "start";
    const labelWidth = p.name.length * 13 + 20;
    const left = anchor === "end" ? x - 16 - labelWidth : x + 16;
    let ly = y + 5;
    for (let tries = 0; tries < 8; tries++) {
      const hit = placed.find(
        (q) => Math.abs(q.y - ly) < 16 && left < q.left + q.width && q.left < left + labelWidth,
      );
      if (!hit) break;
      ly = hit.y + (ly >= hit.y ? 16 : -16);
    }
    placed.push({ left, width: labelWidth, y: ly });
    return { x, y, ly, anchor, tx: anchor === "end" ? x - 16 : x + 16 } as const;
  });
}
