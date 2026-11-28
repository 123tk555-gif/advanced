<script setup lang="ts">
import type { MyTrip } from "~/types/api";

useHead({ title: "旅の一覧 | Tri-Tri" });
const api = useApi();
const { data, error, refresh } = await useAsyncData("my-trips", () =>
  api.get<{ trips: MyTrip[]; pending: { title: string; requestedAt: string }[] }>("/trips"),
);

// 別のタブ・別の人の操作で増えた旅も出るよう、画面に戻ったときに読み直す
function onVisible() {
  if (document.visibilityState === "visible") void refresh();
}
onMounted(() => {
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", onVisible);
  document.removeEventListener("visibilitychange", onVisible);
});
</script>

<template>
  <div>
    <div class="trip-head">
      <h1>旅の一覧</h1>
      <NuxtLink class="button primary" to="/trips/new">+ 旅を作る</NuxtLink>
    </div>
    <p v-if="error" class="errors" role="alert">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <ul v-if="data.trips.length" class="trip-list">
        <li v-for="t in data.trips" :key="t.tripId" class="card trip-card">
          <NuxtLink :to="`/trips/${t.tripId}`">{{ t.title }}</NuxtLink>
          <span v-if="t.role === 'owner'" class="badge owner">オーナー</span>
          <div>{{ fmtRange(t) }}({{ daysOf(t) }}日間)</div>
          <div class="muted small">
            <template v-if="t.destination">行き先: {{ t.destination }} ・ </template>メンバー
            {{ t.memberCount }} 人
          </div>
        </li>
      </ul>
      <p v-else class="empty">
        まだ旅がありません。「旅を作る」から始めるか、招待リンクから参加を申請してください。
      </p>
      <template v-if="data.pending.length">
        <h2>承認待ちの旅</h2>
        <ul>
          <li v-for="p in data.pending" :key="p.requestedAt">
            {{ p.title }} <span class="badge pending">オーナーの承認待ち</span>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
