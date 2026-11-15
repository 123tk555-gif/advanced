/** ログインしていなければ、ログイン画面へ(ログイン画面と公開しおりは除く) */
export default defineNuxtRouteMiddleware((to) => {
  const isPublic = to.path === "/login" || to.path.startsWith("/p/");
  const { user } = useAuth();
  if (!user.value && !isPublic) {
    return navigateTo({ path: "/login", query: { returnTo: to.fullPath } });
  }
});
