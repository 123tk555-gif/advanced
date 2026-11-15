<script setup lang="ts">
/** 入力の誤りをまとめて出す。出たときにフォーカスを移し、読み上げソフトにも伝える */
const props = defineProps<{ errors: string[] }>();
const box = ref<HTMLElement | null>(null);
watch(
  () => props.errors,
  async (errors) => {
    if (errors.length) {
      await nextTick();
      box.value?.focus();
    }
  },
);
</script>

<template>
  <div ref="box" class="errors" role="alert" tabindex="-1">
    <ul v-if="errors.length">
      <li v-for="e in errors" :key="e">{{ e }}</li>
    </ul>
  </div>
</template>
