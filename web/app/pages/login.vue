<script setup lang="ts">
/**
 * ログイン(開発用)。利用者 ID と表示名を入れるだけで入れる。
 * 本番では Cognito のログイン画面(メールアドレスとパスワード)に置き換える。
 */
useHead({ title: "ログイン | Tri-Tri" });
const route = useRoute();
const auth = useAuth();
const api = useApi();
const { toast } = useToast();

const userId = ref("");
const displayName = ref("");
const errors = ref<string[]>([]);
const busy = ref(false);

async function submit() {
  const id = userId.value.trim();
  const name = displayName.value.trim();
  const found: string[] = [];
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    found.push("利用者 ID は、半角の英数字・-・_ で 40 文字までにしてください");
  }
  if (!name) found.push("表示名を入力してください");
  if (name.length > 20) found.push("表示名は 20 文字までです");
  errors.value = found;
  if (found.length) return;

  busy.value = true;
  auth.login({ userId: id, displayName: name });
  try {
    await api.put("/me", { displayName: name });
    const returnTo = typeof route.query.returnTo === "string" ? route.query.returnTo : "/trips";
    await navigateTo(returnTo.startsWith("/") ? returnTo : "/trips");
    toast(`${name} さんとしてログインしました`);
  } catch (error) {
    auth.logout();
    errors.value = [errorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>ログイン(開発用)</h1>
    <p class="notice small">
      手元で動かすための仮のログインです。利用者 ID と表示名を入れるだけで入れます。
      別のタブで別の ID を使うと、別の人として試せます。インターネットに公開するときは、メールアドレスとパスワードのログインに替わります。
    </p>
    <form novalidate @submit.prevent="submit">
      <ErrorsBox :errors="errors" />
      <label for="login-id">利用者 ID <span class="hint">半角の英数字(例: taro)</span></label>
      <input id="login-id" v-model="userId" type="text" autocomplete="username" required />
      <label for="login-name">表示名 <span class="hint">旅のメンバーに見える名前。20 文字まで</span></label>
      <input id="login-name" v-model="displayName" type="text" maxlength="20" required />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">ログイン</button>
      </div>
    </form>
  </div>
</template>
