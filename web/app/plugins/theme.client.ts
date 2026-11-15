/** 画面の色(ライト・ダーク)を、開いたときに反映する(アカウント設定で選んだもの) */
export default defineNuxtPlugin(() => {
  try {
    const saved = localStorage.getItem("tritri-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch {
    // 保存が使えなければ、端末の設定に合わせる
  }
});
