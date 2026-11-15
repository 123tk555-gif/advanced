<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { PublicView } from "~/types/api";
import type { Mode } from "~/utils/map";

/** 公開しおり(ログイン不要・読み取り専用)。旅程・地図・メンバーの表示名だけを見せる */
const route = useRoute();
const api = useApi();
const view = ref<PublicView | null>(null);
const notFound = ref(false);
const loadError = ref("");

try {
  view.value = await api.get<PublicView>(`/public/${String(route.params.token)}`);
} catch (error) {
  if (error instanceof ApiError && error.status === 404) notFound.value = true;
  else loadError.value = errorMessage(error);
}
useHead(() => ({ title: `${view.value?.trip.title ?? "公開しおり"}(公開しおり) | Tri-Tri` }));

const days = computed(() => (view.value ? daysOf(view.value.trip) : 1));
const mapDay = ref(1);
const mapMode = ref<Mode>("walk");
const mobileView = ref<"list" | "map">("list");
const blocks = computed(() =>
  Array.from({ length: days.value }, (_, i) => ({
    day: i + 1,
    date: view.value ? fmtDay(dateOf(view.value.trip.startDate, i)) : "",
    items: view.value?.items.filter((it) => it.day === i + 1) ?? [],
  })),
);
</script>

<template>
  <div>
    <div v-if="notFound" class="narrow-page"><NotFoundView /></div>
    <p v-else-if="loadError" class="errors" role="alert">{{ loadError }}</p>
    <template v-else-if="view">
      <p class="notice small">
        これは公開しおりです(読み取り専用)。割り勘とコメントは表示されません。
      </p>
      <div class="trip-head">
        <h1>{{ view.trip.title }}</h1>
        <span>{{ fmtRange(view.trip) }}</span>
      </div>
      <p>メンバー: {{ view.members.map((m) => m.displayName).join("、") }}</p>
      <div class="view-switch" role="group" aria-label="表示の切り替え">
        <button type="button" :aria-pressed="mobileView === 'list'" @click="mobileView = 'list'">
          一覧
        </button>
        <button type="button" :aria-pressed="mobileView === 'map'" @click="mobileView = 'map'">
          地図
        </button>
      </div>
      <div class="plan-layout" :data-view="mobileView">
        <div class="plan-list">
          <section v-for="b in blocks" :key="b.day" class="day">
            <div class="day-head">
              <h2>
                {{ b.day }}日目 <span class="muted small">{{ b.date }}</span>
              </h2>
            </div>
            <ol v-if="b.items.length" class="items">
              <li v-for="it in b.items" :key="it.itemId" class="item">
                <div class="item-main">
                  <span />
                  <span class="item-time">{{ it.time || "--:--" }}</span>
                  <div>
                    <div class="item-title">{{ it.title }}</div>
                    <div v-if="it.place" class="item-place">場所: {{ it.place.name }}</div>
                    <div v-if="it.memo" class="memo small">{{ it.memo }}</div>
                  </div>
                </div>
              </li>
            </ol>
            <p v-else class="empty small">予定はありません</p>
          </section>
        </div>
        <MapPanel v-model:day="mapDay" v-model:mode="mapMode" :items="view.items" :days="days" />
      </div>
    </template>
  </div>
</template>
