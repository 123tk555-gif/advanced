<script setup lang="ts">
import type { TripFields } from "~/components/TripForm.vue";
import { ApiError } from "~/composables/useApi";
import type { TripView } from "~/types/api";

/** 旅の設定: 旅の情報・公開しおり・メンバーの管理・抜ける/削除 */
const route = useRoute();
const api = useApi();
const { toast } = useToast();
const { confirm } = useConfirm();
const { user } = useAuth();
const tripId = computed(() => String(route.params.tripId));

const view = ref<TripView | null>(null);
const notFound = ref(false);
const form = ref<TripFields>({ title: "", startDate: "", endDate: "", destination: "" });
const errors = ref<string[]>([]);
const loadError = ref("");

/** keepForm: 旅の情報の欄は書き換えない(公開リンクの発行など、別の操作の後) */
async function load(keepForm = false) {
  try {
    view.value = await api.get<TripView>(`/trips/${tripId.value}`);
    loadError.value = "";
    if (keepForm) return;
    const t = view.value.trip;
    form.value = {
      title: t.title,
      startDate: t.startDate,
      endDate: t.endDate,
      destination: t.destination,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound.value = true;
    else loadError.value = errorMessage(error);
  }
}
await load();
useHead(() => ({ title: `${view.value?.trip.title ?? "旅"} の設定 | Tri-Tri` }));

const owner = computed(() => view.value?.myRole === "owner");
// 退会した人は、外せるが、オーナーは引き継げない
const others = computed(
  () => view.value?.members.filter((m) => m.userId !== user.value?.userId) ?? [],
);
const successors = computed(() => others.value.filter((m) => !m.withdrawn));
const publicLink = computed(() =>
  view.value?.public ? `${window.location.origin}/p/${view.value.public.token}` : "",
);
const transferTo = ref("");

async function saveInfo() {
  errors.value = validateTrip(form.value);
  if (errors.value.length) return;
  try {
    await api.patch(`/trips/${tripId.value}`, form.value);
    toast("旅の情報を保存しました");
    await load();
  } catch (error) {
    errors.value = [errorMessage(error)];
  }
}

async function run(action: () => Promise<unknown>, done: string) {
  try {
    await action();
    toast(done);
  } catch (error) {
    toast(errorMessage(error));
  }
  await load(true);
}

const issuePublic = () =>
  run(() => api.post(`/trips/${tripId.value}/public`), "公開リンクを発行しました");

async function stopPublic() {
  const ok = await confirm({
    title: "公開を止めますか?",
    message: "公開リンクを開いた人には「見つかりません」と表示されます。",
    ok: "止める",
  });
  if (ok) await run(() => api.del(`/trips/${tripId.value}/public`), "公開を止めました");
}

async function copyPublic() {
  try {
    await navigator.clipboard.writeText(publicLink.value);
    toast("公開リンクをコピーしました");
  } catch {
    (document.getElementById("public-url") as HTMLInputElement | null)?.select();
  }
}

async function removeMember(userId: string, name: string) {
  const ok = await confirm({
    title: "メンバーを外しますか?",
    message: `${name}さんは、この旅のしおりを見られなくなります(支出・投票・コメントは残ります)。`,
    ok: "外す",
  });
  if (ok) {
    await run(() => api.del(`/trips/${tripId.value}/members/${userId}`), `${name}さんを外しました`);
  }
}

async function transfer() {
  const to = others.value.find((m) => m.userId === transferTo.value);
  if (!to) return;
  const ok = await confirm({
    title: "オーナーを引き継ぎますか?",
    message: `${to.displayName}さんがオーナーになり、あなたはメンバーになります。`,
    ok: "引き継ぐ",
    danger: false,
  });
  if (ok) {
    await run(
      () => api.post(`/trips/${tripId.value}/transfer`, { userId: to.userId }),
      `${to.displayName}さんにオーナーを引き継ぎました`,
    );
  }
}

async function leave() {
  const ok = await confirm({
    title: "この旅から抜けますか?",
    message: "抜けると、この旅のしおりを見られなくなります。もう一度参加するには招待が必要です。",
    ok: "抜ける",
  });
  if (!ok) return;
  try {
    await api.post(`/trips/${tripId.value}/leave`);
    toast(`「${view.value?.trip.title}」から抜けました`);
    await navigateTo("/trips");
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function deleteTrip() {
  const title = view.value?.trip.title ?? "";
  const ok = await confirm({
    title: "この旅を削除しますか?",
    message: `「${title}」の予定・候補・割り勘・コメントがすべて消えます。元に戻せません。`,
    ok: "削除する",
  });
  if (!ok) return;
  try {
    await api.del(`/trips/${tripId.value}`);
    toast(`「${title}」を削除しました`);
    await navigateTo("/trips");
  } catch (error) {
    toast(errorMessage(error));
  }
}
</script>

<template>
  <div class="narrow-page">
    <NotFoundView v-if="notFound" />
    <p v-else-if="loadError && !view" class="errors" role="alert">{{ loadError }}</p>
    <template v-else-if="view">
      <p>
        <NuxtLink :to="`/trips/${tripId}`">← {{ view.trip.title }} に戻る</NuxtLink>
      </p>
      <h1>旅の設定</h1>

      <section>
        <h2>旅の情報</h2>
        <p v-if="!owner" class="small muted">旅の情報を変えられるのはオーナーだけです。</p>
        <form novalidate @submit.prevent="saveInfo">
          <ErrorsBox :errors="errors" />
          <TripForm v-model="form" :disabled="!owner" />
          <div v-if="owner" class="actions">
            <button type="submit" class="primary">保存する</button>
          </div>
        </form>
      </section>

      <section>
        <h2>公開しおり</h2>
        <p>
          リンクを知っている人なら、ログインしなくても旅程・地図・メンバーの表示名を見られます。割り勘とコメントは見えません。
        </p>
        <template v-if="view.public">
          <div class="invite-box">
            <label for="public-url" class="visually-hidden">公開リンク</label>
            <input id="public-url" type="text" readonly :value="publicLink" />
            <button type="button" @click="copyPublic">コピー</button>
          </div>
          <p>
            <NuxtLink :to="`/p/${view.public.token}`">公開しおりを見る</NuxtLink>
          </p>
        </template>
        <p v-else class="muted">公開していません。</p>
        <div v-if="owner" class="actions">
          <button v-if="view.public" type="button" class="danger" @click="stopPublic">
            公開を止める
          </button>
          <button v-else type="button" @click="issuePublic">公開リンクを発行する</button>
        </div>
      </section>

      <section v-if="owner">
        <h2>メンバーの管理</h2>
        <template v-if="others.length">
          <ul class="list-plain">
            <li v-for="m in others" :key="m.userId" class="row">
              <span class="grow">{{ m.displayName }}</span>
              <button
                type="button"
                class="small danger"
                @click="removeMember(m.userId, m.displayName)"
  :aria-label="`外す: ${m.displayName}`"
              >
                外す
              </button>
            </li>
          </ul>
          <form novalidate @submit.prevent="transfer">
            <label for="transfer-to">オーナーを引き継ぐ</label>
            <div class="invite-box">
              <select id="transfer-to" v-model="transferTo">
                <option value="" disabled>引き継ぐ人を選ぶ</option>
                <option v-for="m in successors" :key="m.userId" :value="m.userId">
                  {{ m.displayName }}
                </option>
              </select>
              <button type="submit" :disabled="!transferTo">引き継ぐ</button>
            </div>
            <p class="small muted">引き継ぐと、あなたはメンバーになります。</p>
          </form>
        </template>
        <p v-else class="muted">ほかのメンバーはいません。</p>
      </section>

      <section>
        <h2>旅から抜ける・旅を消す</h2>
        <template v-if="owner">
          <p class="small muted">オーナーは、先にオーナーを引き継いでから抜けられます。</p>
          <div class="actions">
            <button type="button" class="danger filled" @click="deleteTrip">
              この旅を削除する
            </button>
          </div>
        </template>
        <div v-else class="actions">
          <button type="button" class="danger" @click="leave">この旅から抜ける</button>
        </div>
      </section>
    </template>
  </div>
</template>
