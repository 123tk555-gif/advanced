interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "tritri-pending-name";

/**
 * 会員登録で入れた表示名を、確認コードとログインが終わるまで持ち越す
 * (表示名は API に保存するので、ログインして API を呼べるようになるまで待つ)。
 */
export function createPendingName(store: Store) {
  const norm = (email: string) => email.trim().toLowerCase();
  return {
    save(email: string, displayName: string) {
      try {
        store.setItem(KEY, JSON.stringify({ email: norm(email), displayName }));
      } catch {
        // 保存できなければ、ログインの後に表示名の登録の画面で入れてもらう
      }
    },
    take(email: string): string | null {
      try {
        const saved = JSON.parse(store.getItem(KEY) ?? "null") as {
          email: string;
          displayName: string;
        } | null;
        if (!saved || saved.email !== norm(email)) return null;
        store.removeItem(KEY);
        return saved.displayName;
      } catch {
        return null;
      }
    },
  };
}
