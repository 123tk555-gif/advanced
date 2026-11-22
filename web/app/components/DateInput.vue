<script setup lang="ts">
/**
 * 日付の入力欄(いつも YYYY/MM/DD)。
 * 標準の日付欄はブラウザの言語で並びが変わり、アプリから指定できないため、
 * 文字の欄で入力・表示し、標準の日付欄はカレンダーを開くためだけに使う。
 * 値は YYYY-MM-DD。読めない入力はそのまま渡し、validateTrip が知らせる。
 */
const props = defineProps<{ inputId: string; name: string; disabled?: boolean }>();
const model = defineModel<string>({ required: true });

const text = ref(toDateText(model.value));
const picker = ref<HTMLInputElement | null>(null);
const pickerValue = computed(() => parseDateInput(model.value) ?? "");

watch(model, (value) => {
  // 打っている途中の文字は書き換えない(形をそろえるのは欄を離れたとき)
  if (value !== (parseDateInput(text.value) ?? text.value)) text.value = toDateText(value);
});

function onInput() {
  model.value = parseDateInput(text.value) ?? text.value;
}
function tidy() {
  text.value = toDateText(text.value);
}

function onPick(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  text.value = toDateText(value);
  model.value = value;
  document.getElementById(props.inputId)?.focus();
}

function openPicker() {
  try {
    picker.value?.showPicker();
  } catch {
    // showPicker が使えないブラウザでも、手入力はできる
  }
}
</script>

<template>
  <div class="date-input">
    <input
      :id="inputId"
      v-model="text"
      type="text"
      placeholder="YYYY/MM/DD"
      autocomplete="off"
      required
      :disabled="disabled"
      @input="onInput"
      @change="tidy"
    />
    <button
      type="button"
      class="date-button"
      :disabled="disabled"
      :aria-label="`カレンダーで選ぶ(${name})`"
      @click="openPicker"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
      </svg>
    </button>
    <!-- ボタンに重ねた透明な日付欄。スマートフォンでは、押すとそのまま端末のカレンダーが開く -->
    <input
      :id="`${inputId}-picker`"
      ref="picker"
      type="date"
      class="date-picker"
      tabindex="-1"
      :aria-label="`カレンダー(${name})`"
      :value="pickerValue"
      :disabled="disabled"
      @click="openPicker"
      @change="onPick"
    />
  </div>
</template>
