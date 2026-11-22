<script setup lang="ts">
import type { Viewer } from "@tritri/shared";
import type { SocketState } from "~/utils/realtime/socket";

/**
 * 「今見ている人」と、接続の状態。
 * 人の出入りは読み上げない(うるさいため)。読み上げるのは、切れた・戻ったときだけ。
 */
const props = defineProps<{ state: SocketState; people: readonly Viewer[] }>();
const { user } = useAuth();

const status = ref("");
let wasLost = false;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.state,
  (state) => {
    clearTimeout(timer);
    if (state === "offline") {
      wasLost = true;
      status.value = "接続が切れました。再接続中です(その間は 15 秒ごとに更新します)";
    } else if (state === "online" && wasLost) {
      wasLost = false;
      status.value = "接続が戻りました";
      timer = setTimeout(() => {
        status.value = "";
      }, 5000);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));

// 自分を先頭に出す
const shown = computed(() =>
  [...props.people].sort(
    (a, b) => Number(b.userId === user.value?.userId) - Number(a.userId === user.value?.userId),
  ),
);
</script>

<template>
  <div class="presence">
    <div class="presence-people" role="group" aria-label="今見ている人">
      <span>今見ている人:</span>
      <ul v-if="state === 'online'">
        <li v-for="p in shown" :key="p.userId">
          <span class="avatar" aria-hidden="true">{{ p.displayName.slice(0, 1) }}</span>
          {{ p.displayName }}{{ p.userId === user?.userId ? "(あなた)" : "" }}
        </li>
      </ul>
      <span v-else>{{ state === "connecting" ? "確認中…" : "わかりません" }}</span>
    </div>
    <p class="presence-status" :class="{ lost: state === 'offline' }" role="status">
      {{ status }}
    </p>
  </div>
</template>
