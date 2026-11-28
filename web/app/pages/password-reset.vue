<script setup lang="ts">
/** S04 パスワードの再設定: メールアドレス → 確認コードと新しいパスワード */
import { FAKE_CODE } from "~/utils/auth/fake";
import { authErrorMessage } from "~/utils/auth/messages";
import { MIN_PASSWORD, validateCode, validateEmail, validatePassword } from "~/utils/auth/validate";

useHead({ title: "パスワードの再設定 | Tri-Tri" });
const auth = useAuth();
const route = useRoute();
const { toast } = useToast();
if (auth.mode === "dev") await navigateTo("/login", { replace: true });

const step = ref<"email" | "code">("email");
const email = ref(typeof route.query.email === "string" ? route.query.email : "");
const code = ref("");
const password = ref("");
const errors = ref<string[]>([]);
const busy = ref(false);

async function sendCode() {
  const found = validateEmail(email.value);
  errors.value = found;
  if (found.length) return;
  busy.value = true;
  try {
    await auth.emailAuth().resetPassword(email.value);
    step.value = "code";
  } catch (error) {
    // 登録の有無を知られないよう、登録されていないメールでも次へ進める
    if (error instanceof Error && error.name === "UserNotFoundException") step.value = "code";
    else errors.value = [authErrorMessage(error)];
  } finally {
    busy.value = false;
  }
}

async function submit() {
  const found = [...validateCode(code.value), ...validatePassword(password.value)];
  errors.value = found;
  if (found.length) return;
  busy.value = true;
  try {
    await auth.emailAuth().confirmResetPassword(email.value, code.value, password.value);
    password.value = "";
    toast("パスワードを変えました。新しいパスワードでログインしてください");
    await navigateTo({ path: "/login", query: { email: email.value.trim() } });
  } catch (error) {
    // 登録されていないメールでも、コードの誤りと同じに見せる
    errors.value = [
      error instanceof Error && error.name === "UserNotFoundException"
        ? authErrorMessage(Object.assign(new Error(), { name: "CodeMismatchException" }))
        : authErrorMessage(error),
    ];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>パスワードの再設定</h1>
    <form v-if="step === 'email'" novalidate @submit.prevent="sendCode">
      <p>登録したメールアドレスに、再設定の確認コードを送ります。</p>
      <ErrorsBox :errors="errors" />
      <label for="reset-email">メールアドレス</label>
      <input
        id="reset-email"
        v-model="email"
        type="email"
        inputmode="email"
        autocomplete="username"
        required
      />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">確認コードを送る</button>
      </div>
    </form>

    <form v-else novalidate @submit.prevent="submit">
      <p>
        {{ email.trim() }} が登録されていれば、6 桁の確認コードを送りました。コードと新しいパスワードを入れてください。
      </p>
      <p v-if="auth.mode === 'fake'" class="notice small">試験用: 確認コードは {{ FAKE_CODE }} です</p>
      <ErrorsBox :errors="errors" />
      <label for="reset-code">確認コード <span class="hint">6 桁の数字</span></label>
      <input
        id="reset-code"
        v-model="code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        required
      />
      <label for="reset-password"
        >新しいパスワード <span class="hint">{{ MIN_PASSWORD }} 文字以上</span></label
      >
      <input
        id="reset-password"
        v-model="password"
        type="password"
        autocomplete="new-password"
        :minlength="MIN_PASSWORD"
        required
      />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">パスワードを変える</button>
        <button type="button" :disabled="busy" @click="step = 'email'">メールアドレスを直す</button>
      </div>
    </form>
    <p class="small"><NuxtLink to="/login">ログインに戻る</NuxtLink></p>
  </div>
</template>
