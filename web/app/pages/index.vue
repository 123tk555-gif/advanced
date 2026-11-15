<script setup lang="ts">
// トップは、ログインしていれば旅の一覧へ(していなければミドルウェアがログイン画面へ送る)
await navigateTo("/trips", { replace: true });
</script>

<template>
  <div />
</template>
