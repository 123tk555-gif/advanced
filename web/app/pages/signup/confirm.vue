<script setup lang="ts">
/** S03 確認コードの入力: メールで届いた 6 桁のコード。届かなければ送り直す */
import { FAKE_CODE } from "~/utils/auth/fake";
import { authErrorMessage } from "~/utils/auth/messages";
import { validateCode, validateEmail } from "~/utils/auth/validate";

useHead({ title: "確認コードの入力 | Tri-Tri" });
const auth = useAuth();
const route = useRoute();
const { toast } = useToast();
if (auth.mode === "dev") await navigateTo("/login", { replace: true });

const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const code = ref("");
const errors = ref<string[]>([]);
const busy = ref(false);
const resent = ref("");

async function submit() {
  const found = [...validateEmail(email.value), ...validateCode(code.value)];
  errors.value = found;
  if (found.length) return;

  busy.value = true;
  try {
    await auth.emailAuth().confirmSignUp(email.value, code.value);
    toast("メールアドレスを確認しました。ログインしてください");
    await navigateTo({
      path: "/login",
      query: { email: email.value.trim(), returnTo: route.query.returnTo },
    });
  } catch (error) {
    errors.value = [authErrorMessage(error)];
  } finally {
    busy.value = false;
  }
}

async function resend() {
  resent.value = "";
  const found = validateEmail(email.value);
  errors.value = found;
  if (found.length) return;
  busy.value = true;
  try {
    await auth.emailAuth().resendSignUpCode(email.value);
    resent.value = "確認コードを送り直しました。メールを確かめてください";
  } catch (error) {
    errors.value = [authErrorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>確認コードの入力</h1>
    <p>登録したメールアドレスに、6 桁の確認コードを送りました。届いたコードを入れてください。</p>
    <p v-if="auth.mode === 'fake'" class="notice small">試験用: 確認コードは {{ FAKE_CODE }} です</p>
    <form novalidate @submit.prevent="submit">
      <ErrorsBox :errors="errors" />
      <label for="confirm-email">メールアドレス</label>
      <input
        id="confirm-email"
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="username"
        required
      />
      <label for="confirm-code">確認コード <span class="hint">6 桁の数字</span></label>
      <input
        id="confirm-code"
        v-model="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        required
      />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">確認する</button>
        <button type="button" :disabled="busy" @click="resend">コードを送り直す</button>
      </div>
    </form>
    <p class="small" aria-live="polite">{{ resent }}</p>
    <p class="small">
      メールが届かないときは、迷惑メールのフォルダも確かめてください。
      <NuxtLink to="/login">ログインに戻る</NuxtLink>
    </p>
  </div>
</template>
