<script setup lang="ts">
import { loadMapLibraries, watchAuthFailure } from "~/utils/geo/google";
import type { LatLng } from "~/utils/geo/types";
import type { MapPin } from "~/utils/map";

/**
 * 本物の Google マップ(API キーがあるときだけ MapPanel から使う)。
 * その日の場所に番号つきのピンを立て、区間ごとの経路を線で描く。
 * 地図を見られない人のために、同じ内容は MapPanel の「区間ごとの移動時間」の一覧にもある。
 */
const props = defineProps<{
  pins: MapPin[];
  /** 経路が見つかった区間の線。見つからない区間は、経路に見える線を描かない */
  paths: LatLng[][];
  dashed: boolean;
  label: string;
}>();

const { mapId } = useGeo();
const el = ref<HTMLElement | null>(null);
const failed = ref(false);
let stopWatching = () => {};

type Libs = Awaited<ReturnType<typeof loadMapLibraries>>;
let libs: Libs | null = null;
let map: google.maps.Map | null = null;
let markers: google.maps.marker.AdvancedMarkerElement[] = [];
let lines: google.maps.Polyline[] = [];

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function isDark() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set) return set === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function clear() {
  for (const m of markers) m.map = null;
  for (const l of lines) l.setMap(null);
  markers = [];
  lines = [];
}

function draw() {
  if (!libs || !map) return;
  clear();
  const route = token("--route", "#1d5fb4");
  const surface = token("--surface", "#ffffff");
  const glyph = token("--primary-text", "#ffffff");
  const bounds = new libs.LatLngBounds();

  props.pins.forEach((p) => {
    if (!libs || !map) return;
    const pin = new libs.PinElement({
      glyphText: String(p.no),
      glyphColor: glyph,
      background: route,
      borderColor: surface,
    });
    markers.push(
      new libs.AdvancedMarkerElement({
        map,
        position: { lat: p.lat, lng: p.lng },
        title: `${p.no}. ${p.label}`,
        content: pin,
      }),
    );
    bounds.extend({ lat: p.lat, lng: p.lng });
  });

  props.paths.forEach((path) => {
    if (!libs || !map) return;
    // 公共交通は破線にする(色だけに頼らず、線の形でも手段がわかるように)
    lines.push(
      new libs.Polyline({
        map,
        path,
        strokeColor: route,
        strokeWeight: 4,
        strokeOpacity: props.dashed ? 0 : 0.9,
        icons: props.dashed
          ? [
              {
                icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: route, scale: 3 },
                offset: "0",
                repeat: "14px",
              },
            ]
          : [],
      }),
    );
    for (const point of path) bounds.extend(point);
  });

  const only = props.pins.length === 1 ? props.pins[0] : undefined;
  if (only) {
    map.setCenter({ lat: only.lat, lng: only.lng });
    map.setZoom(15);
  } else if (props.pins.length) {
    map.fitBounds(bounds, 48);
  }
}

onMounted(async () => {
  stopWatching = watchAuthFailure(() => {
    failed.value = true;
  });
  try {
    libs = await loadMapLibraries();
    if (!el.value) return;
    const first = props.pins[0];
    map = new libs.GoogleMap(el.value, {
      mapId,
      // 色の切り替えは地図を作るときだけ効く。設定で色を変えたら、画面を開き直すと反映される
      colorScheme: isDark() ? "DARK" : "LIGHT",
      center: first ? { lat: first.lat, lng: first.lng } : { lat: 35.681, lng: 139.767 },
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      clickableIcons: false,
    });
    draw();
  } catch {
    failed.value = true;
  }
});
// 旅の画面は定期的に読み直すので、中身が変わったときだけ描き直す(動かした地図の位置を戻さない)
watch(() => JSON.stringify([props.pins, props.paths, props.dashed]), draw);
onBeforeUnmount(() => {
  stopWatching();
  clear();
});
</script>

<template>
  <p v-if="failed" class="errors small" role="alert">
    地図を読み込めませんでした。予定の一覧と、下の移動時間はそのまま使えます。
  </p>
  <div v-else ref="el" class="route-map" role="region" :aria-label="label" />
</template>
