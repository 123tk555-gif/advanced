<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { JoinRequest, TripView } from "~/types/api";

/**
 * 旅の画面(旅程・候補・割り勘・メンバーの 4 つのタブ)。
 * ほかの人の変更は、今は 15 秒ごとと、画面に戻ったときに読み直して反映する。
 * (WebSocket をつなぐ段階で、変更がすぐ届くようにする)
 */
const route = useRoute();
const api = useApi();
const tripId = computed(() => String(route.params.tripId));
const tab = computed(() => {
  const t = route.query.tab;
  return t === "ideas" || t === "money" || t === "members" ? t : "plan";
});

const view = ref<TripView | null>(null);
const requests = ref<JoinRequest[]>([]);
const notFound = ref(false);
const loadError = ref("");

async function load() {
  try {
    const v = await api.get<TripView>(`/trips/${tripId.value}`);
    requests.value =
      v.myRole === "owner"
        ? (await api.get<{ requests: JoinRequest[] }>(`/trips/${tripId.value}/join-requests`))
            .requests
        : [];
    view.value = v;
    notFound.value = false;
    loadError.value = "";
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound.value = true;
      view.value = null;
    } else {
      loadError.value = errorMessage(error);
    }
  }
}
await load();
watch(tripId, load);

useHead(() => ({
  title: `${view.value?.trip.title ?? (notFound.value ? "見つかりません" : "旅")} | Tri-Tri`,
}));

// ほかの人の変更を取り込む(編集のダイアログを開いている間は読み直さない)
let timer: ReturnType<typeof setInterval> | undefined;
function refreshIfIdle() {
  if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) {
    void load();
  }
}
onMounted(() => {
  timer = setInterval(refreshIfIdle, 15_000);
  window.addEventListener("focus", refreshIfIdle);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("focus", refreshIfIdle);
});

const tabs = [
  { key: "plan", label: "旅程" },
  { key: "ideas", label: "候補" },
  { key: "money", label: "割り勘" },
  { key: "members", label: "メンバー" },
] as const;
</script>

<template>
  <div v-if="notFound" class="narrow-page"><NotFoundView /></div>
  <div v-else-if="view">
    <div class="trip-head">
      <h1>{{ view.trip.title }}</h1>
      <span
        >{{ fmtRange(view.trip)
        }}<template v-if="view.trip.destination"> ・ {{ view.trip.destination }}</template></span
      >
      <NuxtLink :to="`/trips/${tripId}/settings`" class="small">旅の設定</NuxtLink>
    </div>
    <p v-if="loadError" class="notice warn" role="status">{{ loadError }}</p>
    <nav class="tabs" aria-label="旅の画面の切り替え">
      <NuxtLink
        v-for="t in tabs"
        :key="t.key"
        :to="{ query: t.key === 'plan' ? {} : { tab: t.key } }"
        :aria-current="tab === t.key ? 'page' : undefined"
      >
        {{ t.label
        }}<span
          v-if="t.key === 'members' && requests.length"
          class="count"
          :aria-label="`未処理の参加申請 ${requests.length} 件`"
          >{{ requests.length }}</span
        >
      </NuxtLink>
    </nav>
    <PlanTab v-if="tab === 'plan'" :view="view" @changed="load" />
    <IdeasTab v-else-if="tab === 'ideas'" :view="view" @changed="load" />
    <MoneyTab v-else-if="tab === 'money'" :view="view" @changed="load" />
    <MembersTab v-else :view="view" :requests="requests" @changed="load" />
  </div>
  <p v-else-if="loadError" class="errors" role="alert">{{ loadError }}</p>
</template>
