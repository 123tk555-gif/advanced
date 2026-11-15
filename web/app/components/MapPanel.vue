<script setup lang="ts">
import type { Place } from "~/types/api";
import type { Mode } from "~/utils/map";

/** 地図と経路(今は位置関係だけを描いた模型。Google マップをつなぐ段階で置き換える) */
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
const pins = computed(() => layoutPins(stops.value, W, H));
const route = computed(() => pins.value.map((p) => `${p.x},${p.y}`).join(" "));
const legs = computed(() =>
  stops.value.slice(1).map((p, i) => {
    const prev = stops.value[i] as Place;
    const minutes = fmtMinutes(legMinutes(prev, p, mode.value));
    return `${prev.name} → ${p.name}: ${MODES[mode.value]}で${minutes}`;
  }),
);
const label = computed(() =>
  stops.value.length
    ? `${day.value}日目の地図。${stops.value.map((p, i) => `${i + 1} ${p.name}`).join("、")}`
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
    <svg
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
            {{ i + 1 }}
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
          {{ i + 1 }}. {{ stops[i]?.name }}
        </text>
      </template>
      <text v-else :x="W / 2" :y="H / 2" text-anchor="middle" fill="currentColor">
        この日は場所のある予定がありません
      </text>
    </svg>
    <template v-if="legs.length">
      <h3 class="small" style="margin-bottom: 0">区間ごとの移動時間({{ MODES[mode] }})</h3>
      <ol class="map-legs">
        <li v-for="leg in legs" :key="leg">{{ leg }}</li>
      </ol>
    </template>
    <p v-if="routeUrl" class="small">
      <a :href="routeUrl" target="_blank" rel="noopener"
        >この日の経路を Google マップで開く(新しいタブ)</a
      >
    </p>
    <p class="small muted">
      地図は今は簡略化しています。Google マップをつなぐと、本物の地図と経路検索の移動時間になります。
    </p>
  </section>
</template>
