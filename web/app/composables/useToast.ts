/** 画面の下に出す短いお知らせ(読み上げソフトにも伝わる) */
export function useToast() {
  const toasts = useState<{ id: number; message: string }[]>("toasts", () => []);

  function toast(message: string) {
    const id = Date.now() + Math.random();
    // 画面を覆わないよう、新しい 2 件だけを残す
    toasts.value = [...toasts.value, { id, message }].slice(-2);
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 5000);
  }

  return { toasts, toast };
}

interface ConfirmRequest {
  title: string;
  message: string;
  ok: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

/** 「本当に〜しますか?」の確認(layouts/default.vue の ConfirmDialog が表示する) */
export function useConfirm() {
  const pending = useState<ConfirmRequest | null>("confirm", () => null);

  function confirm(options: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
    return new Promise((resolve) => {
      pending.value = { danger: true, ...options, resolve };
    });
  }

  function answer(ok: boolean) {
    pending.value?.resolve(ok);
    pending.value = null;
  }

  return { pending, confirm, answer };
}
