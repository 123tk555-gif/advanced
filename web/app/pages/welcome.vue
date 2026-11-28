<script setup lang="ts">
/** 表示名の登録(会員登録の後に、まだ表示名が無いとき)。旅を作る・参加する前に必要 */
import { safeReturnTo } from "~/utils/auth/return-to";
import { validateDisplayName } from "~/utils/auth/validate";

useHead({ title: "表示名の登録 | Tri-Tri" });
const auth = useAuth();
const api = useApi();
const route = useRoute();
const { toast } = useToast();

const returnTo = safeReturnTo(route.query.returnTo);
const name = ref("");
const errors = ref<string[]>([]);
const busy = ref(false);

onMounted(async () => {
  // 通信の失敗でここに来たときは、登録済みの表示名が読めればそのまま戻る
  if (!auth.user.value?.displayName) await auth.loadProfile();
  if (auth.user.value?.displayName) await navigateTo(returnTo, { replace: true });
});

async function submit() {
  const found = validateDisplayName(name.value);
  errors.value = found;
  if (found.length) return;
  busy.value = true;
  try {
    const n = name.value.trim();
    await api.put("/me", { displayName: n });
    auth.setDisplayName(n);
    toast(`${n} さんとしてログインしました`);
    await navigateTo(returnTo);
  } catch (error) {
    errors.value = [errorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>表示名の登録</h1>
    <p>旅のメンバーに見える名前を決めてください。あとからアカウント設定で変えられます。</p>
    <form novalidate @submit.prevent="submit">
      <ErrorsBox :errors="errors" />
      <label for="welcome-name">表示名 <span class="hint">20 文字まで</span></label>
      <input id="welcome-name" v-model="name" type="text" maxlength="20" required />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">登録する</button>
      </div>
    </form>
  </div>
</template>
