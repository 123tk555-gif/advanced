<script setup lang="ts">
import type { Place } from "~/types/api";
import { labelFromInput, MAX_LABEL } from "~/utils/geo/input";
import { createSuggester } from "~/utils/geo/suggest";
import type { Suggestion } from "~/utils/geo/types";

/**
 * 場所の入力欄。予定の追加・編集と、候補タブで使う。
 * - 選ぶ前: 地名を入れると候補が出る(↑↓・Enter・Esc でも選べる)
 * - 選んだ後: しおりに出す表示名を直せる。最初は利用者が入力した文字にする
 *   (Google の候補名と座標は、規約でずっとは保存できないので保存しない)
 * ラベルは呼ぶ側が `<label :for="inputId">` で付ける。
 */
const props = defineProps<{ inputId: string }>();
const place = defineModel<Place | null>({ required: true });
/** 検索中の文字。候補から選ばずに保存しようとしたかどうかを、呼ぶ側が確かめられるように出す */
const text = defineModel<string>("text", { required: true });

const { places, google } = useGeo();
const { remember } = usePositions();
const matches = ref<Suggestion[]>([]);
const active = ref(-1);
const resolving = ref(false);
const failure = ref("");
const listId = computed(() => `${props.inputId}-list`);

const suggester = createSuggester(
  places,
  (found) => {
    matches.value = found;
    active.value = -1;
  },
  // 仮の候補は手元で探すだけなので待たない。Google は料金の枠を使うので、入力が止まるまで待つ
  { delayMs: google ? 300 : 0, minLength: google ? 2 : 1 },
);
onBeforeUnmount(() => suggester.cancel());

function onInput() {
  failure.value = "";
  suggester.input(text.value);
}

async function focusField() {
  await nextTick();
  document.getElementById(props.inputId)?.focus();
}

async function choose(s: Suggestion) {
  suggester.cancel();
  matches.value = [];
  const typed = text.value;
  resolving.value = true;
  failure.value = "";
  try {
    const found = await places.resolve(s);
    // 待っている間に入力を変えたり、別の予定を開いたりしていたら、古い答えは使わない
    if (text.value !== typed || place.value) return;
    if (found) {
      remember(found.placeId, found.position);
      place.value = { placeId: found.placeId, label: labelFromInput(typed) };
      text.value = "";
      await focusField();
    } else {
      failure.value = "この場所の位置を取得できませんでした。別の候補を選んでください";
    }
  } catch {
    failure.value = "場所を取得できませんでした。通信を確かめて、もう一度選んでください";
  } finally {
    resolving.value = false;
  }
}

function rename(e: Event) {
  if (place.value) place.value = { ...place.value, label: (e.target as HTMLInputElement).value };
}

function clear() {
  suggester.cancel();
  place.value = null;
  text.value = "";
  matches.value = [];
  void focusField();
}

function onKey(e: KeyboardEvent) {
  // 日本語の変換中の ↑↓・Enter は、変換の操作として扱う
  if (e.isComposing || !matches.value.length) return;
  if (e.key === "ArrowDown") {
    active.value = (active.value + 1) % matches.value.length;
  } else if (e.key === "ArrowUp") {
    active.value = (active.value - 1 + matches.value.length) % matches.value.length;
  } else if (e.key === "Enter" && active.value >= 0) {
    void choose(matches.value[active.value] as Suggestion);
  } else if (e.key === "Escape") {
    matches.value = [];
    e.stopPropagation();
  } else {
    return;
  }
  e.preventDefault();
}
</script>

<template>
  <div class="place-input">
    <template v-if="place">
      <input
        :id="inputId"
        key="label"
        type="text"
        :value="place.label"
        :maxlength="MAX_LABEL"
        :aria-describedby="`${inputId}-status`"
        autocomplete="off"
        @input="rename"
      />
      <p :id="`${inputId}-status`" class="small" aria-live="polite">
        場所を選びました。上の欄は、しおりに出す表示名です(自由に変えられます)。
        <button type="button" class="link small" @click="clear">場所を外す・選び直す</button>
      </p>
    </template>
    <template v-else>
      <input
        :id="inputId"
        key="search"
        v-model="text"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="matches.length > 0"
        :aria-controls="listId"
        :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
        :maxlength="MAX_LABEL"
        autocomplete="off"
        @input="onInput"
        @keydown="onKey"
      />
      <ul :id="listId" class="suggestions" role="listbox" aria-label="場所の候補">
        <li
          v-for="(s, i) in matches"
          :id="`${listId}-${i}`"
          :key="s.id"
          role="option"
          :aria-selected="i === active"
          @mousedown.prevent="choose(s)"
        >
          {{ s.main }}<span v-if="s.sub" class="muted small"> {{ s.sub }}</span>
        </li>
      </ul>
      <p v-if="google && matches.length" class="gmaps-credit" translate="no">Google Maps</p>
      <p class="small" aria-live="polite">
        <template v-if="resolving">場所を取得しています…</template>
        <span v-else-if="failure" class="error-text">{{ failure }}</span>
        <template v-else>場所は未設定です(地図には出ません)</template>
      </p>
    </template>
  </div>
</template>
