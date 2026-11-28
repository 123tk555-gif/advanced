<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { JoinRequest, TripView } from "~/types/api";

/**
 * 旅の画面(旅程・候補・割り勘・メンバーの 4 つのタブ)。
 * ほかの人の変更は WebSocket の合図で読み直す(useTripRealtime)。切れている間は 15 秒ごと。
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
/** 見られなくなった(外された・抜けた・旅が消えた)。遅れて届いた答えで表示を戻さない */
let revoked = false;

async function load() {
  try {
    const v = await api.get<TripView>(`/trips/${tripId.value}`);
    requests.value =
      v.myRole === "owner"
        ? (await api.get<{ requests: JoinRequest[] }>(`/trips/${tripId.value}/join-requests`))
            .requests
        : [];
    if (revoked) return;
    const restoreFocus = keepFocus();
    view.value = v;
    notFound.value = false;
    loadError.value = "";
    await nextTick();
    restoreFocus();
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
const { state, people, editing, setEditing, reload } = useTripRealtime(tripId.value, {
  load,
  onRevoked() {
    revoked = true;
    view.value = null;
    requests.value = [];
    notFound.value = true;
  },
});

useHead(() => ({
  title: `${view.value?.trip.title ?? (notFound.value ? "見つかりません" : "旅")} | Tri-Tri`,
}));

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
      <!-- 見つけやすいよう、ボタンの形にして、そこでできることも書く(役割で変わる) -->
      <NuxtLink :to="`/trips/${tripId}/settings`" class="button trip-settings-link">
        旅の設定<span class="trip-settings-hint">{{
          view.myRole === "owner"
            ? "(タイトル・日程の変更、公開しおり、旅の削除など)"
            : "(旅の情報・公開しおりの確認、この旅から抜ける)"
        }}</span>
      </NuxtLink>
    </div>
    <PresenceBar :state="state" :people="people" />
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
    <PlanTab
      v-if="tab === 'plan'"
      :view="view"
      :editing="editing"
      @changed="reload"
      @editing="setEditing"
    />
    <IdeasTab v-else-if="tab === 'ideas'" :view="view" @changed="reload" />
    <MoneyTab v-else-if="tab === 'money'" :view="view" @changed="reload" />
    <MembersTab v-else :view="view" :requests="requests" @changed="reload" />
  </div>
  <p v-else-if="loadError" class="errors" role="alert">{{ loadError }}</p>
</template>
