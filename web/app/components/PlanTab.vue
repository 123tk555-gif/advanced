<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { Item, ItemWithComments, Place, TripView } from "~/types/api";
import type { Mode } from "~/utils/map";

/** 旅程タブ: 日ごとの予定(並べ替え・編集・削除・コメント)と地図 */
const props = defineProps<{ view: TripView }>();
const emit = defineEmits<{ changed: [] }>();
const api = useApi();
const { toast } = useToast();
const { confirm } = useConfirm();
const { user } = useAuth();

const tripId = computed(() => props.view.trip.tripId);
const days = computed(() => daysOf(props.view.trip));
const mapDay = ref(1);
const mapMode = ref<Mode>("walk");
const mobileView = ref<"list" | "map">("list");
const { leg } = useLegs();
const { google } = useGeo();

/**
 * 日ごとの予定と、地図のピン番号・前の場所からの移動時間。
 * 移動時間は、地図で選んでいる日だけ出す(経路検索の料金の枠を使い過ぎないように)
 */
const dayBlocks = computed(() =>
  Array.from({ length: days.value }, (_, i) => {
    const day = i + 1;
    let pin = 0;
    let prev: Place | null = null;
    const items = props.view.items
      .filter((it) => it.day === day)
      .map((it) => {
        let legLine: { text: string; href: string | null; timed: boolean } | null = null;
        if (it.place && prev && day === mapDay.value) {
          const state = leg(prev, it.place, mapMode.value);
          legLine = {
            text: legSentence(state, mapMode.value),
            href: needsLookupLink(state) ? googleRouteUrl([prev, it.place], mapMode.value) : null,
            timed: state.status === "ok",
          };
        }
        if (it.place) {
          pin += 1;
          prev = it.place;
        }
        return { ...it, pin: it.place ? pin : null, leg: legLine };
      });
    return { day, date: fmtDay(dateOf(props.view.trip.startDate, i)), items };
  }),
);
const firstId = computed(() => props.view.items[0]?.itemId);
const lastId = computed(() => props.view.items.at(-1)?.itemId);

// ---- 追加・編集 ----
const dialog = ref<{ open: boolean; item: Item | null; day: number }>({
  open: false,
  item: null,
  day: 1,
});
function openAdd(day: number) {
  dialog.value = { open: true, item: null, day };
}
function openEdit(item: ItemWithComments) {
  dialog.value = { open: true, item, day: item.day };
}
function onSaved(itemId: string) {
  dialog.value.open = false;
  const saved = props.view.items.find((i) => i.itemId === itemId);
  if (saved) mapDay.value = saved.day;
  emit("changed");
}

// ---- 並べ替え(↑↓)----
const pendingFocus = ref<string | null>(null);
async function move(item: ItemWithComments, dir: -1 | 1) {
  const next = planMove(props.view.items, item.itemId, dir, days.value);
  if (!next) return;
  try {
    await api.patch(`/trips/${tripId.value}/items/${item.itemId}`, {
      version: item.version,
      ...next,
    });
    toast(`「${item.title}」を ${next.day}日目の${dir < 0 ? "上" : "下"}へ動かしました`);
    pendingFocus.value = `${item.itemId}:${dir}`;
  } catch (error) {
    toast(
      error instanceof ApiError && error.code === "VERSION_CONFLICT"
        ? "ほかの人が先にこの予定を変更しました。最新の内容にしました"
        : errorMessage(error),
    );
  }
  emit("changed");
}
// 動かしたあと、同じボタンにフォーカスを戻す(キーボードで続けて動かせるように)
watch(
  () => props.view,
  async () => {
    if (!pendingFocus.value) return;
    await nextTick();
    const [id, dir] = pendingFocus.value.split(":");
    pendingFocus.value = null;
    const btn = document.querySelector<HTMLButtonElement>(`[data-move="${id}:${dir}"]`);
    (btn && !btn.disabled
      ? btn
      : document.querySelector<HTMLButtonElement>(`[data-edit="${id}"]`)
    )?.focus();
  },
);

// ---- 削除 ----
async function remove(item: ItemWithComments) {
  const ok = await confirm({
    title: "予定を削除しますか?",
    message: `「${item.title}」とそのコメントを削除します。元に戻せません。`,
    ok: "削除する",
  });
  if (!ok) return;
  try {
    await api.del(`/trips/${tripId.value}/items/${item.itemId}?version=${item.version}`);
    toast(`「${item.title}」を削除しました`);
  } catch (error) {
    toast(
      error instanceof ApiError && error.code === "VERSION_CONFLICT"
        ? "ほかの人が先にこの予定を変更したため、削除しませんでした。内容を確かめてください"
        : errorMessage(error),
    );
  }
  emit("changed");
}

// ---- コメント ----
const commentDrafts = reactive<Record<string, string>>({});
const openDetails = reactive<Record<string, boolean>>({});
async function addComment(item: ItemWithComments) {
  const body = (commentDrafts[item.itemId] ?? "").trim();
  if (!body) return toast("コメントを入力してください");
  try {
    await api.post(`/trips/${tripId.value}/items/${item.itemId}/comments`, { body });
    commentDrafts[item.itemId] = "";
    openDetails[item.itemId] = true;
    emit("changed");
  } catch (error) {
    toast(errorMessage(error));
  }
}
async function deleteComment(item: ItemWithComments, commentId: string) {
  try {
    await api.del(`/trips/${tripId.value}/items/${item.itemId}/comments/${commentId}`);
    toast("コメントを削除しました");
    emit("changed");
  } catch (error) {
    toast(errorMessage(error));
  }
}
function nameOf(userId: string) {
  return props.view.members.find((m) => m.userId === userId)?.displayName ?? "元メンバー";
}
</script>

<template>
  <div>
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
        <section
          v-for="block in dayBlocks"
          :key="block.day"
          class="day"
          :aria-labelledby="`day-${block.day}`"
        >
          <div class="day-head">
            <h2 :id="`day-${block.day}`">
              {{ block.day }}日目 <span class="muted small">{{ block.date }}</span>
            </h2>
            <button type="button" class="small" @click="openAdd(block.day)"
  :aria-label="`+ 予定を追加(${block.day}日目)`">
              + 予定を追加
            </button>
          </div>
          <ol v-if="block.items.length" class="items">
            <template v-for="it in block.items" :key="it.itemId">
              <li :id="`item-${it.itemId}`" class="item">
                <div v-if="it.leg" class="leg leg-in">
                  ↓ 前の場所から{{ it.leg.text }}
                  <a v-if="it.leg.href" :href="it.leg.href" target="_blank" rel="noopener"
                    >Google マップで調べる<span class="visually-hidden"
                      >({{ it.title }}まで、新しいタブ)</span
                    ></a
                  >
                  <span v-else-if="google && it.leg.timed" class="gmaps-credit" translate="no"
                    >Google Maps</span
                  >
                </div>
                <div class="item-main">
                  <span>
                    <span v-if="it.pin" class="pin-no" :aria-label="`地図の ${it.pin} 番`">{{
                      it.pin
                    }}</span>
                  </span>
                  <span class="item-time">{{ it.time || "--:--" }}</span>
                  <div>
                    <div class="item-title">{{ it.title }}</div>
                    <div v-if="it.place" class="item-place">場所: {{ it.place.label }}</div>
                  </div>
                </div>
                <div class="item-tools">
                  <button
                    type="button"
                    class="small"
                    :data-edit="it.itemId"
                    @click="openEdit(it)"
  :aria-label="`編集: ${it.title}`"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    class="small"
                    :data-move="`${it.itemId}:-1`"
                    :disabled="it.itemId === firstId"
                    :aria-label="`「${it.title}」を上へ`"
                    @click="move(it, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="small"
                    :data-move="`${it.itemId}:1`"
                    :disabled="it.itemId === lastId"
                    :aria-label="`「${it.title}」を下へ`"
                    @click="move(it, 1)"
                  >
                    ↓
                  </button>
                  <button type="button" class="small danger" @click="remove(it)"
  :aria-label="`削除: ${it.title}`">
                    削除
                  </button>
                  <a
                    v-if="it.place"
                    class="small"
                    :href="googleSearchUrl(it.place)"
                    target="_blank"
                    rel="noopener"
                    >Google マップで開く<span class="visually-hidden"
                      >({{ it.title }}、新しいタブ)</span
                    ></a
                  >
                </div>
                <details
                  :open="openDetails[it.itemId]"
                  @toggle="
                    openDetails[it.itemId] = ($event.target as HTMLDetailsElement).open
                  "
                >
                  <summary>メモとコメント({{ it.comments.length }})</summary>
                  <p v-if="it.memo" class="memo">{{ it.memo }}</p>
                  <p v-else class="muted small">メモはありません</p>
                  <ul class="comments">
                    <li v-for="c in it.comments" :key="c.commentId">
                      <strong>{{ c.authorName }}</strong>
                      <span class="muted small"> {{ fmtDateTime(c.createdAt) }}</span>
                      <button
                        v-if="c.userId === user?.userId"
                        type="button"
                        class="link small"
                        @click="deleteComment(it, c.commentId)"
  :aria-label="`削除: 自分のコメント`"
                      >
                        削除
                      </button>
                      <div class="memo">{{ c.body }}</div>
                    </li>
                  </ul>
                  <form novalidate @submit.prevent="addComment(it)">
                    <label :for="`cm-${it.itemId}`"
                      >コメント <span class="hint">200 文字まで</span></label
                    >
                    <div class="invite-box">
                      <input
                        :id="`cm-${it.itemId}`"
                        v-model="commentDrafts[it.itemId]"
                        type="text"
                        maxlength="200"
                      />
                      <button type="submit" class="small">送る</button>
                    </div>
                  </form>
                  <p class="small muted">
                    最終更新: {{ nameOf(it.updatedBy) }}({{ fmtDateTime(it.updatedAt) }}、版
                    {{ it.version }})
                  </p>
                </details>
              </li>
            </template>
          </ol>
          <p v-else class="empty small">予定はまだありません</p>
        </section>
      </div>
      <MapPanel v-model:day="mapDay" v-model:mode="mapMode" :items="view.items" :days="days" />
    </div>

    <ItemDialog
      :open="dialog.open"
      :trip-id="tripId"
      :start-date="view.trip.startDate"
      :days="days"
      :items="view.items"
      :members="view.members"
      :item="dialog.item"
      :day="dialog.day"
      @close="dialog.open = false"
      @saved="onSaved"
    />
  </div>
</template>
