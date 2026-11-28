<script setup lang="ts">
/** S02 会員登録: メールアドレス・パスワード・表示名。確認コードをメールで送る */
import { authErrorMessage } from "~/utils/auth/messages";
import { createPendingName } from "~/utils/auth/pending";
import {
  MIN_PASSWORD,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "~/utils/auth/validate";

useHead({ title: "会員登録 | Tri-Tri" });
const auth = useAuth();
const route = useRoute();
if (auth.mode === "dev") await navigateTo("/login", { replace: true });

const email = ref("");
const password = ref("");
const displayName = ref("");
const errors = ref<string[]>([]);
const busy = ref(false);

async function submit() {
  const found = [
    ...validateEmail(email.value),
    ...validatePassword(password.value),
    ...validateDisplayName(displayName.value),
  ];
  errors.value = found;
  if (found.length) return;

  busy.value = true;
  try {
    await auth.emailAuth().signUp(email.value, password.value);
    createPendingName(sessionStorage).save(email.value, displayName.value.trim());
    password.value = "";
    await navigateTo({
      path: "/signup/confirm",
      query: { email: email.value.trim(), returnTo: route.query.returnTo },
    });
  } catch (error) {
    errors.value = [authErrorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>会員登録</h1>
    <form novalidate @submit.prevent="submit">
      <ErrorsBox :errors="errors" />
      <label for="signup-email"
        >メールアドレス <span class="hint">確認コードを送ります。ログインに使います</span></label
      >
      <input
        id="signup-email"
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="username"
        required
      />
      <label for="signup-password"
        >パスワード <span class="hint">{{ MIN_PASSWORD }} 文字以上。文字の種類は問いません</span></label
      >
      <input
        id="signup-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        :minlength="MIN_PASSWORD"
        required
      />
      <label for="signup-name">表示名 <span class="hint">旅のメンバーに見える名前。20 文字まで</span></label>
      <input id="signup-name" v-model="displayName" type="text" maxlength="20" required />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">登録して確認コードを送る</button>
      </div>
    </form>
    <p class="small">登録済みの方は <NuxtLink to="/login">ログイン</NuxtLink></p>
  </div>
</template>
