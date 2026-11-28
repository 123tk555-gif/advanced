<script setup lang="ts">
/**
 * S01 ログイン。
 * 本番(Cognito)と試験用は、メールアドレスとパスワード。
 * 開発用は、利用者 ID と表示名を入れるだけで入れる(手元で何人かを試すため)。
 */
import { authErrorMessage } from "~/utils/auth/messages";
import { createPendingName } from "~/utils/auth/pending";
import { safeReturnTo } from "~/utils/auth/return-to";
import { validateDisplayName, validateEmail } from "~/utils/auth/validate";

useHead({ title: "ログイン | Tri-Tri" });
const route = useRoute();
const auth = useAuth();
const api = useApi();
const { toast } = useToast();

const returnTo = safeReturnTo(route.query.returnTo);
const errors = ref<string[]>([]);
const busy = ref(false);
/** 確認コードがまだのとき、その画面へ案内する */
const needsConfirm = ref(false);

// ---- メールアドレスとパスワード ----
const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const password = ref("");

async function submitEmail() {
  needsConfirm.value = false;
  const found = [...validateEmail(email.value)];
  if (!password.value) found.push("パスワードを入力してください");
  errors.value = found;
  if (found.length) return;

  busy.value = true;
  try {
    await auth.emailAuth().signIn(email.value, password.value);
    await auth.restore();
    await auth.loadProfile();
    const signedIn = auth.user.value;
    if (!signedIn) throw new Error("ログインの情報を読めませんでした");
    if (!signedIn.displayName) {
      // 会員登録で入れた表示名があれば、ここで登録する
      const name = createPendingName(sessionStorage).take(email.value);
      if (name) {
        await api.put("/me", { displayName: name });
        auth.setDisplayName(name);
      }
    }
    password.value = "";
    if (!auth.user.value?.displayName) {
      await navigateTo({ path: "/welcome", query: { returnTo } });
      return;
    }
    await navigateTo(returnTo);
    toast(`${auth.user.value.displayName} さんとしてログインしました`);
  } catch (error) {
    needsConfirm.value = error instanceof Error && error.name === "UserNotConfirmedException";
    errors.value = [error instanceof ApiError ? errorMessage(error) : authErrorMessage(error)];
  } finally {
    busy.value = false;
  }
}

// ---- 開発用 ----
const userId = ref("");
const displayName = ref("");

async function submitDev() {
  const id = userId.value.trim();
  const name = displayName.value.trim();
  const found: string[] = [];
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    found.push("利用者 ID は、半角の英数字・-・_ で 40 文字までにしてください");
  }
  found.push(...validateDisplayName(name));
  errors.value = found;
  if (found.length) return;

  busy.value = true;
  auth.devLogin({ userId: id, displayName: name });
  try {
    await api.put("/me", { displayName: name });
    await navigateTo(returnTo);
    toast(`${name} さんとしてログインしました`);
  } catch (error) {
    await auth.logout();
    errors.value = [errorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <template v-if="auth.mode === 'dev'">
      <h1>ログイン(開発用)</h1>
      <p class="notice small">
        手元で動かすための仮のログインです。利用者 ID と表示名を入れるだけで入れます。
        別のタブで別の ID を使うと、別の人として試せます。インターネットに公開するときは、メールアドレスとパスワードのログインに替わります。
      </p>
      <form novalidate @submit.prevent="submitDev">
        <ErrorsBox :errors="errors" />
        <label for="login-id">利用者 ID <span class="hint">半角の英数字(例: taro)</span></label>
        <input id="login-id" v-model="userId" type="text" autocomplete="username" required />
        <label for="login-name">表示名 <span class="hint">旅のメンバーに見える名前。20 文字まで</span></label>
        <input id="login-name" v-model="displayName" type="text" maxlength="20" required />
        <div class="actions">
          <button class="primary" type="submit" :disabled="busy">ログイン</button>
        </div>
      </form>
    </template>

    <template v-else>
      <h1>ログイン</h1>
      <p v-if="auth.mode === 'fake'" class="notice small">
        試験用のログインです(メールは送りません)。この画面は自動テストのためのもので、本番では使いません。
      </p>
      <form novalidate @submit.prevent="submitEmail">
        <ErrorsBox :errors="errors" />
        <p v-if="needsConfirm" class="small">
          <NuxtLink :to="{ path: '/signup/confirm', query: { email: email.trim() } }"
            >確認コードを入れる画面へ</NuxtLink
          >
        </p>
        <label for="login-email">メールアドレス</label>
        <input
          id="login-email"
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="username"
          required
        />
        <label for="login-password">パスワード</label>
        <input
          id="login-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
        <div class="actions">
          <button class="primary" type="submit" :disabled="busy">ログイン</button>
        </div>
      </form>
      <ul class="list-plain small auth-links">
        <li>
          はじめての方は <NuxtLink :to="{ path: '/signup', query: { returnTo } }">会員登録</NuxtLink>
        </li>
        <li>
          <NuxtLink :to="{ path: '/password-reset', query: { email: email.trim() || undefined } }"
            >パスワードを忘れた方</NuxtLink
          >
        </li>
      </ul>
    </template>
  </div>
</template>
