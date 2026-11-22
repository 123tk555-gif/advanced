<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
import type { Item, Member, Place } from "~/types/api";
import { placeError } from "~/utils/geo/input";

/**
 * 予定の追加・編集。
 * 保存したときにほかの人が先に変更していたら(サーバーが 409 を返したら)、
 * 「あなたの内容」と「今の内容」を並べて、どちらにするかを選ばせる(楽観ロック)。
 */
const props = defineProps<{
  open: boolean;
  tripId: string;
  startDate: string;
  days: number;
  items: readonly Item[];
  members: readonly Member[];
  /** 編集する予定。null なら追加 */
  item: Item | null;
  /** 追加するときの日にち */
  day: number;
}>();
const emit = defineEmits<{ close: []; saved: [itemId: string] }>();
const api = useApi();
const { toast } = useToast();

interface Draft {
  day: number;
  time: string;
  title: string;
  place: Place | null;
  memo: string;
}

const state = ref<"edit" | "conflict">("edit");
const draft = ref<Draft>({ day: 1, time: "", title: "", place: null, memo: "" });
const placeText = ref("");
const base = ref<{ version: number; day: number } | null>(null);
const current = ref<Item | null>(null);
const errors = ref<string[]>([]);
const busy = ref(false);

function fill(from: Draft) {
  draft.value = { ...from, place: from.place ? { ...from.place } : null };
  placeText.value = "";
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    state.value = "edit";
    errors.value = [];
    current.value = null;
    if (props.item) {
      fill(props.item);
      base.value = { version: props.item.version, day: props.item.day };
    } else {
      fill({ day: props.day, time: "", title: "", place: null, memo: "" });
      base.value = null;
    }
  },
  { immediate: true },
);

function validate(): string[] {
  const found: string[] = [];
  const title = draft.value.title.trim();
  if (!title) found.push("タイトルを入力してください");
  if (title.length > 100) found.push("タイトルは 100 文字までです");
  if (draft.value.memo.length > 1000) found.push("メモは 1000 文字までです");
  const placeProblem = placeError(draft.value.place, placeText.value);
  if (placeProblem) found.push(placeProblem);
  return found;
}

/** 内容(日にち以外)。日にちを変えたときは、その日の最後に入れる */
function body(version: number, fromDay: number) {
  const { day, title, time, place, memo } = draft.value;
  const others = props.items.filter((i) => i.itemId !== props.item?.itemId);
  return {
    version,
    title: title.trim(),
    time,
    place,
    memo,
    ...(day !== fromDay ? { day, order: orderAtEnd(others, day) } : {}),
  };
}

async function save(version?: number, fromDay?: number) {
  errors.value = validate();
  if (errors.value.length) return;
  busy.value = true;
  try {
    if (!props.item) {
      const { day, title, time, place, memo } = draft.value;
      const res = await api.post<{ item: Item }>(`/trips/${props.tripId}/items`, {
        day,
        order: orderAtEnd(props.items, day),
        title: title.trim(),
        time,
        place,
        memo,
      });
      toast(`「${res.item.title}」を追加しました`);
      emit("saved", res.item.itemId);
      return;
    }
    const v = version ?? base.value?.version ?? props.item.version;
    const d = fromDay ?? base.value?.day ?? props.item.day;
    const res = await api.patch<{ item: Item }>(
      `/trips/${props.tripId}/items/${props.item.itemId}`,
      body(v, d),
    );
    toast(`「${res.item.title}」を保存しました`);
    emit("saved", res.item.itemId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
      current.value = (error.body as { current: Item }).current;
      state.value = "conflict";
    } else if (error instanceof ApiError && error.status === 404) {
      toast("この予定は、ほかの人が削除しました");
      emit("saved", "");
    } else {
      errors.value = [errorMessage(error)];
    }
  } finally {
    busy.value = false;
  }
}

// ---- 衝突したとき ----
function nameOf(userId: string) {
  return props.members.find((m) => m.userId === userId)?.displayName ?? "元メンバー";
}
const fields: [string, (v: Draft) => string][] = [
  ["日にち", (v) => `${v.day}日目`],
  ["時刻", (v) => v.time || "なし"],
  ["タイトル", (v) => v.title],
  ["場所", (v) => v.place?.label ?? "なし"],
  ["メモ", (v) => v.memo || "なし"],
];
function keepMine() {
  if (!current.value) return;
  void save(current.value.version, current.value.day);
}
function keepTheirs() {
  toast("今の内容のままにしました");
  emit("saved", props.item?.itemId ?? "");
}
function reedit() {
  if (!current.value) return;
  fill(current.value);
  base.value = { version: current.value.version, day: current.value.day };
  state.value = "edit";
}
</script>

<template>
  <AppDialog :open="open" title-id="item-dialog-title" @close="emit('close')">
    <template v-if="state === 'edit'">
      <h2 id="item-dialog-title">{{ item ? "予定を編集" : "予定を追加" }}</h2>
      <form novalidate @submit.prevent="save()">
        <ErrorsBox :errors="errors" />
        <div class="field-row">
          <div>
            <label for="it-day">日にち</label>
            <select id="it-day" v-model.number="draft.day">
              <option v-for="d in days" :key="d" :value="d">
                {{ d }}日目 {{ fmtDay(dateOf(startDate, d - 1)) }}
              </option>
            </select>
          </div>
          <div>
            <label for="it-time">時刻 <span class="hint">省略できます</span></label>
            <input id="it-time" v-model="draft.time" type="time" />
          </div>
        </div>
        <label for="it-title">タイトル <span class="hint">100 文字まで</span></label>
        <input id="it-title" v-model="draft.title" type="text" maxlength="100" autofocus />
        <label for="it-place"
          >場所 <span class="hint">地名を入れると候補が出ます。候補から選んでください</span></label
        >
        <PlaceInput v-model="draft.place" v-model:text="placeText" input-id="it-place" />
        <label for="it-memo">メモ <span class="hint">1000 文字まで</span></label>
        <textarea id="it-memo" v-model="draft.memo" maxlength="1000" />
        <p v-if="item" class="small muted">
          最終更新: {{ nameOf(item.updatedBy) }}({{ fmtDateTime(item.updatedAt) }}、版
          {{ item.version }})
        </p>
        <div class="actions">
          <button type="submit" class="primary" :disabled="busy">保存する</button>
          <button type="button" @click="emit('close')">やめる</button>
        </div>
      </form>
    </template>

    <template v-else-if="current">
      <h2 id="item-dialog-title">ほかの人が先に変更していました</h2>
      <p>
        {{ nameOf(current.updatedBy) }}さんが {{ fmtDateTime(current.updatedAt) }}
        にこの予定を変更しました。どちらの内容にするか選んでください。
      </p>
      <div class="compare">
        <div class="card">
          <h3 style="margin-top: 0">あなたの内容</h3>
          <dl>
            <template v-for="[label, f] in fields" :key="label">
              <dt>{{ label }}{{ f(draft) !== f(current) ? "(違い)" : "" }}</dt>
              <dd>
                <span :class="{ changed: f(draft) !== f(current) }">{{ f(draft) }}</span>
              </dd>
            </template>
          </dl>
        </div>
        <div class="card">
          <h3 style="margin-top: 0">今の内容({{ nameOf(current.updatedBy) }}さん)</h3>
          <dl>
            <template v-for="[label, f] in fields" :key="label">
              <dt>{{ label }}{{ f(draft) !== f(current) ? "(違い)" : "" }}</dt>
              <dd>
                <span :class="{ changed: f(draft) !== f(current) }">{{ f(current) }}</span>
              </dd>
            </template>
          </dl>
        </div>
      </div>
      <ErrorsBox :errors="errors" />
      <div class="actions">
        <button type="button" class="primary" :disabled="busy" @click="keepMine">
          あなたの内容で保存する
        </button>
        <button type="button" @click="keepTheirs">今の内容のままにする</button>
        <button type="button" @click="reedit">今の内容をもとに編集し直す</button>
      </div>
    </template>
  </AppDialog>
</template>
