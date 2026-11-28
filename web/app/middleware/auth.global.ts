/** ログイン・会員登録の画面(ログインしていなくても開ける) */
const AUTH_PAGES = ["/login", "/signup", "/signup/confirm", "/password-reset"];

/**
 * ログインしていなければ、ログイン画面へ(ログイン・会員登録の画面と公開しおりは除く)。
 * 表示名がまだなら、表示名の登録の画面へ。
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuth();
  await auth.ready();
  const isPublicShiori = to.path.startsWith("/p/");
  const isAuthPage = AUTH_PAGES.includes(to.path);
  const user = auth.user.value;
  if (!user) {
    if (isAuthPage || isPublicShiori) return;
    return navigateTo({ path: "/login", query: { returnTo: to.fullPath } });
  }
  if (!user.displayName && to.path !== "/welcome" && !isPublicShiori) {
    return navigateTo({ path: "/welcome", query: { returnTo: to.fullPath } });
  }
});
