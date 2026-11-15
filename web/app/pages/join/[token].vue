<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { JoinInfo } from "~/types/api";

/**
 * 招待リンクを開いた画面。見せるのは旅のタイトル・メンバー数・自分の状態だけ。
 * 参加は申請制で、オーナーが承認するまで旅の中身は見えない。
 */
useHead({ title: "旅への招待 | Tri-Tri" });
const route = useRoute();
const api = useApi();
const { toast } = useToast();
const token = computed(() => String(route.params.token));

const info = ref<JoinInfo | null>(null);
const notFound = ref(false);
const errors = ref<string[]>([]);

async function load() {
  try {
    const next = await api.get<JoinInfo>(`/join/${token.value}`);
    // メンバーなら(承認された直後も含めて)、そのまま旅の画面へ
    if (next.status === "member") {
      if (info.value?.status === "pending") toast("参加が承認されました");
      await navigateTo(`/trips/${next.tripId}`, { replace: true });
      return;
    }
    info.value = next;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound.value = true;
    else errors.value = [errorMessage(error)];
  }
}
await load();

// 承認待ちの間は、5 秒ごとと画面に戻ったときに確かめ、承認されたら旅の画面へ移る
let timer: ReturnType<typeof setInterval> | undefined;
function checkIfPending() {
  if (info.value?.status === "pending" && document.visibilityState === "visible") void load();
}
onMounted(() => {
  timer = setInterval(checkIfPending, 5_000);
  window.addEventListener("focus", checkIfPending);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("focus", checkIfPending);
});

async function request() {
  try {
    await api.post(`/join/${token.value}`);
    toast("申請を送りました");
    await load();
  } catch (error) {
    errors.value = [errorMessage(error)];
  }
}
</script>

<template>
  <div class="narrow-page">
    <NotFoundView v-if="notFound" />
    <template v-else-if="info">
      <h1>旅への招待</h1>
      <div class="card">
        <p style="font-size: 1.2rem; margin: 0">
          <strong>{{ info.trip.title }}</strong>
        </p>
        <p class="muted" style="margin: 0">メンバー {{ info.trip.memberCount }} 人</p>
      </div>
      <p class="small muted">承認されるまでは、旅の日程や予定などは表示されません。</p>
      <ErrorsBox :errors="errors" />
      <p v-if="info.status === 'pending'" class="notice warn" role="status">
        参加を申請しました。オーナーが承認すると、この画面のまま旅のしおりに切り替わります。
      </p>
      <template v-else>
        <p>この旅に参加するには、オーナーの承認が必要です。</p>
        <div class="actions">
          <button type="button" class="primary" @click="request">参加を申請する</button>
        </div>
      </template>
    </template>
    <ErrorsBox v-else :errors="errors" />
  </div>
</template>
