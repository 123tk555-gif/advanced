import type { Editor, Viewer } from "@tritri/shared";
import { ApiError } from "~/composables/useApi";
import { createRefresher } from "~/utils/realtime/refresh";
import { createTripSocket, type SocketState } from "~/utils/realtime/socket";

/** つながっていない間の読み直し */
const OFFLINE_POLL_MS = 15_000;
/** つながっていても、合図の取りこぼしに備えて読み直す */
const ONLINE_POLL_MS = 120_000;
/** タブを隠してから、「今見ている人」から外れるまで */
const HIDDEN_LIMIT_MS = 60_000;

/**
 * 旅の画面のリアルタイム更新(WebSocket の接続と、読み直しの調整)。
 * 受け取るのは合図と「今見ている人」だけ。旅の中身は load(GET /trips/:tripId)で読む。
 */
export function useTripRealtime(
  tripId: string,
  options: { load: () => Promise<void>; onRevoked: () => void },
) {
  const api = useApi();
  const { user } = useAuth();
  const config = useRuntimeConfig().public;
  // 本番は API Gateway WebSocket の URL(wss://…/prod)。手元は開発用 API の /ws
  const wsUrl = config.wsUrl ? String(config.wsUrl) : `${config.apiBase.replace(/^http/, "ws")}/ws`;

  const state = ref<SocketState>("connecting");
  const people = ref<Viewer[]>([]);
  const everyEditor = ref<Editor[]>([]);
  /** ほかの人が編集中の予定(自分の分は出さない) */
  const editing = computed(() => everyEditor.value.filter((e) => e.userId !== user.value?.userId));

  let composing = false;
  const visible = () => document.visibilityState === "visible";
  const refresher = createRefresher(
    options.load,
    // 入力と衝突の検出を守るため、ダイアログ中と日本語の変換中は読み直さない
    () => composing || !!document.querySelector("dialog[open]"),
  );

  const socket = createTripSocket({
    getTicket: async () =>
      (await api.post<{ ticket: string }>(`/trips/${tripId}/ws-ticket`)).ticket,
    open: (ticket) =>
      new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`) as unknown as ReturnType<
        Parameters<typeof createTripSocket>[0]["open"]
      >,
    isGone: (error) => error instanceof ApiError && (error.status === 404 || error.status === 401),
    onState(next) {
      state.value = next;
      if (next === "online") return;
      people.value = [];
      everyEditor.value = [];
      if (next === "revoked") {
        refresher.stop();
        options.onRevoked();
      }
    },
    onPresence(presence) {
      people.value = presence.people;
      everyEditor.value = presence.editing;
    },
    onRefresh: refresher.request,
  });

  let lastPoll = Date.now();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

  function poll() {
    if (!visible() || state.value === "revoked") return;
    const every = state.value === "online" ? ONLINE_POLL_MS : OFFLINE_POLL_MS;
    if (Date.now() - lastPoll < every - 1000) return; // タイマーの誤差の分だけ余裕を持たせる
    lastPoll = Date.now();
    refresher.request();
  }

  function onVisibility() {
    clearTimeout(hiddenTimer);
    if (visible()) {
      socket.resume();
      refresher.request();
    } else {
      hiddenTimer = setTimeout(() => socket.pause(), HIDDEN_LIMIT_MS);
    }
  }
  function onOnline() {
    if (visible()) socket.resume();
  }
  function onFocus() {
    // つながっていれば合図が届くので、読み直すのは切れているときだけ
    if (state.value !== "online") refresher.request();
  }
  function onCompositionStart() {
    composing = true;
  }
  function onCompositionEnd() {
    composing = false;
    refresher.resume();
  }
  // <dialog> の close は伝播しないので、捕捉の段階で受ける
  function onDialogClose() {
    refresher.resume();
  }

  onMounted(() => {
    socket.start();
    pollTimer = setInterval(poll, OFFLINE_POLL_MS);
    if (!visible()) onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    // 変換中の欄が消えると compositionend が来ないので、欄を離れたときも解除する
    document.addEventListener("focusout", onCompositionEnd, true);
    document.addEventListener("close", onDialogClose, true);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => {
    socket.stop();
    refresher.stop();
    clearInterval(pollTimer);
    clearTimeout(hiddenTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("compositionstart", onCompositionStart, true);
    document.removeEventListener("compositionend", onCompositionEnd, true);
    document.removeEventListener("focusout", onCompositionEnd, true);
    document.removeEventListener("close", onDialogClose, true);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
  });

  return {
    state,
    people,
    editing,
    setEditing: socket.setEditing,
    /** 自分の変更の後の読み直し */
    reload: refresher.now,
  };
}
