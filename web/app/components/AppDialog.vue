<script setup lang="ts">
/**
 * 画面の上に重ねて出すダイアログ(ブラウザ標準の <dialog>)。
 * Esc キーで閉じられ、開いている間は後ろの画面を操作できない。閉じると元のボタンにフォーカスが戻る。
 */
const props = defineProps<{ open: boolean; titleId: string }>();
const emit = defineEmits<{ close: [] }>();
const el = ref<HTMLDialogElement | null>(null);
let returnFocus: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    const dlg = el.value;
    if (!dlg) return;
    if (open && !dlg.open) {
      returnFocus = document.activeElement as HTMLElement | null;
      dlg.showModal();
      await nextTick();
      (dlg.querySelector("[autofocus]") as HTMLElement | null)?.focus();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  },
  { immediate: true },
);

function onClose() {
  if (returnFocus?.isConnected) returnFocus.focus();
  if (props.open) emit("close");
}
</script>

<template>
  <dialog ref="el" :aria-labelledby="titleId" @close="onClose">
    <div v-if="open" class="dialog-body"><slot /></div>
  </dialog>
</template>
