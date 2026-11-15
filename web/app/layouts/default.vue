<script setup lang="ts">
const { user } = useAuth();
const { toasts } = useToast();
</script>

<template>
  <div>
    <a class="skip-link" href="#main">本文へ移動</a>
    <header class="site-header">
      <div class="inner">
        <NuxtLink class="logo" to="/trips">Tri-Tri</NuxtLink>
        <nav aria-label="メインメニュー">
          <template v-if="user">
            <NuxtLink to="/trips">旅の一覧</NuxtLink>
            <NuxtLink to="/settings">{{ user.displayName }} さん</NuxtLink>
          </template>
          <NuxtLink v-else to="/login">ログイン</NuxtLink>
        </nav>
      </div>
    </header>
    <main id="main" tabindex="-1">
      <slot />
    </main>
    <div class="toast-area" role="status" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="toast">{{ t.message }}</div>
    </div>
    <ConfirmDialog />
  </div>
</template>
