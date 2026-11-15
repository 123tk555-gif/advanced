<script setup lang="ts">
/** アカウント設定: 表示名の変更・画面の色・ログアウト・退会 */
useHead({ title: "アカウント設定 | Tri-Tri" });
const api = useApi();
const auth = useAuth();
const { toast } = useToast();
const { confirm } = useConfirm();

const name = ref(auth.user.value?.displayName ?? "");
const errors = ref<string[]>([]);

async function saveName() {
  const n = name.value.trim();
  const found: string[] = [];
  if (!n) found.push("表示名を入力してください");
  if (n.length > 20) found.push("表示名は 20 文字までです");
  errors.value = found;
  if (found.length) return;
  try {
    await api.put("/me", { displayName: n });
    auth.setDisplayName(n);
    toast("表示名を保存しました。参加中の旅にも反映されます");
  } catch (error) {
    errors.value = [errorMessage(error)];
  }
}

// ---- 画面の色(このブラウザにだけ覚える) ----
const THEME_KEY = "tritri-theme";
const theme = ref<"system" | "light" | "dark">("system");
onMounted(() => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") theme.value = saved;
  } catch {
    // 保存が使えなくても、端末に合わせる
  }
});
watch(theme, (t) => {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // 保存できなくても、今の画面には効く
  }
});

async function logout() {
  auth.logout();
  toast("ログアウトしました");
  await navigateTo("/login");
}

async function withdraw() {
  const ok = await confirm({
    title: "退会しますか?",
    message:
      "あなたがオーナーの旅は、いちばん早く参加したメンバーに引き継ぎます。メンバーがあなた 1 人だけの旅は残り、名前は「退会した会員」になります。元に戻せません。",
    ok: "退会する",
  });
  if (!ok) return;
  try {
    await api.del("/me");
    auth.logout();
    toast("退会しました");
    await navigateTo("/login");
  } catch (error) {
    toast(errorMessage(error));
  }
}

const themes = { system: "端末に合わせる", light: "ライト", dark: "ダーク" } as const;
</script>

<template>
  <div class="narrow-page">
    <h1>アカウント設定</h1>
    <form novalidate @submit.prevent="saveName">
      <ErrorsBox :errors="errors" />
      <label for="pf-name">表示名 <span class="hint">20 文字まで</span></label>
      <input id="pf-name" v-model="name" type="text" maxlength="20" />
      <div class="actions"><button type="submit" class="primary">保存する</button></div>
    </form>
    <fieldset>
      <legend>画面の色</legend>
      <label v-for="(label, key) in themes" :key="key" class="check">
        <input v-model="theme" type="radio" name="theme" :value="key" /> {{ label }}
      </label>
    </fieldset>
    <div class="actions">
      <button type="button" @click="logout">ログアウト</button>
      <button type="button" class="danger" @click="withdraw">退会する</button>
    </div>
  </div>
</template>
