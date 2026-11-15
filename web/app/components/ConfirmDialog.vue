<script setup lang="ts">
const { pending, answer } = useConfirm();
</script>

<template>
  <AppDialog :open="pending !== null" title-id="confirm-title" @close="answer(false)">
    <template v-if="pending">
      <h2 id="confirm-title">{{ pending.title }}</h2>
      <p>{{ pending.message }}</p>
      <div class="actions">
        <button
          type="button"
          :class="pending.danger ? 'danger filled' : 'primary'"
          @click="answer(true)"
        >
          {{ pending.ok }}
        </button>
        <button type="button" autofocus @click="answer(false)">やめる</button>
      </div>
    </template>
  </AppDialog>
</template>
