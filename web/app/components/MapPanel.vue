<script setup lang="ts">
import type { Place } from "~/types/api";
import type { MapPin, Mode } from "~/utils/map";

/**
 * 地図と経路。Google マップの API キーがあれば本物の地図(RouteMap)、
 * なければ位置関係だけを描いた模型を出す。どちらでも、区間ごとの移動時間を文字の一覧で出す。
 */
const props = defineProps<{
  items: { day: number; title: string; place: Place | null }[];
  days: number;
}>();
const day = defineModel<number>("day", { required: true });
const mode = defineModel<Mode>("mode", { required: true });

const W = 400;
const H = 300;
const stops = computed(() =>
  props.items.filter((i) => i.day === day.value && i.place).map((i) => i.place as Place),
);
const { google } = useGeo();
const { leg } = useLegs();
const { positionOf } = usePositions();

// 座標は保存していないので、表示のたびに ID から取る。番号は、取れなかった場所があってもずらさない
const located = computed(() =>
  stops.value.map((place, i) => ({ place, no: i + 1, state: positionOf(place.placeId) })),
);
const mapPins = computed<MapPin[]>(() =>
  located.value.flatMap(({ place, no, state }) =>
    state.status === "ok" ? [{ no, label: place.label, ...state.value }] : [],
  ),
);
const locating = computed(() => located.value.some((x) => x.state.status === "loading"));
const missing = computed(() =>
  located.value.filter((x) => x.state.status === "none" || x.state.status === "failed"),
);
const pins = computed(() => layoutPins(mapPins.value, W, H));
const route = computed(() => pins.value.map((p) => `${p.x},${p.y}`).join(" "));

const legs = computed(() =>
  stops.value.slice(1).map((to, i) => {
    const from = stops.value[i] as Place;
    const state = leg(from, to, mode.value);
    return {
      state,
      text: `${from.label} → ${to.label}: ${legSentence(state, mode.value)}`,
      href: needsLookupLink(state) ? googleRouteUrl([from, to], mode.value) : null,
    };
  }),
);
const found = computed(() =>
  legs.value.flatMap(({ state }) => (state.status === "ok" ? [state.value] : [])),
);
const paths = computed(() => found.value.flatMap((l) => (l.path ? [l.path] : [])));
const warnings = computed(() => [...new Set(found.value.flatMap((l) => l.warnings ?? []))]);
const label = computed(() =>
  stops.value.length
    ? `${day.value}日目の地図。${stops.value.map((p, i) => `${i + 1} ${p.label}`).join("、")}`
    : `${day.value}日目の地図。場所のある予定はありません`,
);
const routeUrl = computed(() => googleRouteUrl(stops.value, mode.value));
const modeKeys = Object.keys(MODES) as Mode[];
</script>

<template>
  <section class="map-panel" aria-labelledby="map-title">
    <h2 id="map-title" class="visually-hidden">地図と経路</h2>
    <div class="map-tools" role="group" aria-label="地図に出す日">
      <button
        v-for="d in days"
        :key="d"
        type="button"
        class="small"
        :aria-pressed="d === day"
        @click="day = d"
      >
        {{ d }}日目
      </button>
    </div>
    <div class="map-tools" role="group" aria-label="移動手段">
      <button
        v-for="key in modeKeys"
        :key="key"
        type="button"
        class="small"
        :aria-pressed="mode === key"
        @click="mode = key"
      >
        {{ MODES[key] }}
      </button>
    </div>
    <RouteMap
      v-if="google"
      :pins="mapPins"
      :paths="paths"
      :dashed="mode === 'transit'"
      :label="label"
    />
    <svg
      v-else
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="label"
      style="background: var(--map-land); color: var(--text)"
    >
      <template v-if="pins.length">
        <line
          v-for="x in [60, 140, 220, 300, 380]"
          :key="`v${x}`"
          :x1="x"
          y1="0"
          :x2="x - 40"
          :y2="H"
          stroke="var(--map-road)"
          stroke-width="6"
        />
        <line
          v-for="y in [50, 130, 210, 280]"
          :key="`h${y}`"
          x1="0"
          :y1="y"
          :x2="W"
          :y2="y + 20"
          stroke="var(--map-road)"
          stroke-width="5"
        />
        <path
          d="M 250 0 C 230 80, 280 150, 240 220 S 230 300, 220 300"
          fill="none"
          stroke="var(--map-water)"
          stroke-width="14"
        />
        <polyline
          :points="route"
          fill="none"
          stroke="var(--route)"
          stroke-width="4"
          stroke-linejoin="round"
          :stroke-dasharray="mode === 'transit' ? '10 6' : undefined"
        />
        <g v-for="(p, i) in pins" :key="`c${i}`">
          <circle
            :cx="p.x"
            :cy="p.y"
            r="13"
            fill="var(--route)"
            stroke="var(--surface)"
            stroke-width="3"
          />
          <text
            :x="p.x"
            :y="p.y + 5"
            text-anchor="middle"
            font-size="14"
            font-weight="bold"
            fill="var(--primary-text)"
          >
            {{ mapPins[i]?.no }}
          </text>
        </g>
        <text
          v-for="(p, i) in pins"
          :key="`t${i}`"
          :x="p.tx"
          :y="p.ly"
          :text-anchor="p.anchor"
          font-size="13"
          font-weight="bold"
          fill="currentColor"
          stroke="var(--map-land)"
          stroke-width="4"
          paint-order="stroke"
        >
          {{ mapPins[i]?.no }}. {{ mapPins[i]?.label }}
        </text>
      </template>
      <text v-else :x="W / 2" :y="H / 2" text-anchor="middle" fill="currentColor">
        {{ stops.length ? "地図に出せる場所がありません" : "この日は場所のある予定がありません" }}
      </text>
    </svg>
    <p v-if="locating" class="small muted" role="status">場所の位置を取得しています…</p>
    <p v-if="missing.length" class="small error-text" role="status">
      地図に出せなかった場所: {{ missing.map((x) => `${x.no}. ${x.place.label}`).join("、") }}
    </p>
    <template v-if="legs.length">
      <h3 class="small" style="margin-bottom: 0">区間ごとの移動時間({{ MODES[mode] }})</h3>
      <ol class="map-legs">
        <li v-for="(row, i) in legs" :key="i">
          {{ row.text }}
          <a v-if="row.href" :href="row.href" target="_blank" rel="noopener"
            >Google マップで調べる<span class="visually-hidden"
              >({{ i + 1 }} 番目の区間、新しいタブ)</span
            ></a
          >
        </li>
      </ol>
      <p v-if="google && found.length" class="gmaps-credit" translate="no">Google Maps</p>
      <p v-for="warning in warnings" :key="warning" class="small muted">注意: {{ warning }}</p>
    </template>
    <p v-if="routeUrl" class="small">
      <a :href="routeUrl" target="_blank" rel="noopener"
        >この日の経路を Google マップで開く(新しいタブ)</a
      >
    </p>
    <p v-if="!google" class="small muted">
      今は Google マップの API キーが設定されていないため、地図は位置関係だけの簡略図で、徒歩・車の移動時間は直線距離からの目安です。
    </p>
  </section>
</template>
