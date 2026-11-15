<script setup lang="ts">
import { MAX_TRIP_DAYS } from "@tritri/shared";

/** 旅の情報の入力欄(作成と設定で共通) */
export interface TripFields {
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
}
defineProps<{ disabled?: boolean }>();
const model = defineModel<TripFields>({ required: true });
</script>

<template>
  <div>
    <label for="tf-title">タイトル <span class="hint">50 文字まで</span></label>
    <input
      id="tf-title"
      v-model="model.title"
      type="text"
      maxlength="50"
      required
      :disabled="disabled"
    />
    <div class="field-row">
      <div>
        <label for="tf-start">開始日</label>
        <input id="tf-start" v-model="model.startDate" type="date" required :disabled="disabled" />
      </div>
      <div>
        <label for="tf-end">終了日 <span class="hint">{{ MAX_TRIP_DAYS }} 日間まで</span></label>
        <input id="tf-end" v-model="model.endDate" type="date" required :disabled="disabled" />
      </div>
    </div>
    <label for="tf-dest">行き先 <span class="hint">省略できます。50 文字まで</span></label>
    <input
      id="tf-dest"
      v-model="model.destination"
      type="text"
      maxlength="50"
      :disabled="disabled"
    />
  </div>
</template>
