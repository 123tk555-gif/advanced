<script setup lang="ts">
import type { JoinRequest, TripView } from "~/types/api";

/** メンバータブ: メンバーの一覧、招待リンク、参加申請(オーナーだけ) */
const props = defineProps<{ view: TripView; requests: JoinRequest[] }>();
const emit = defineEmits<{ changed: [] }>();
const api = useApi();
const { toast } = useToast();
const { confirm } = useConfirm();
const { user } = useAuth();

const tripId = computed(() => props.view.trip.tripId);
const owner = computed(() => props.view.myRole === "owner");
const ownerName = computed(
  () => props.view.members.find((m) => m.role === "owner")?.displayName ?? "",
);
const inviteLink = computed(() =>
  props.view.invite ? `${window.location.origin}/join/${props.view.invite.token}` : "",
);
const expired = computed(
  () => !!props.view.invite && Date.parse(props.view.invite.expiresAt) <= Date.now(),
);

async function copy() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    toast("招待リンクをコピーしました");
  } catch {
    (document.getElementById("invite-url") as HTMLInputElement | null)?.select();
    toast("リンクを選択しました。コピーしてください");
  }
}

async function reissue() {
  try {
    await api.post(`/trips/${tripId.value}/invite`);
    toast("新しい招待リンクを発行しました。前のリンクは使えなくなりました");
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}

async function stop() {
  const ok = await confirm({
    title: "招待リンクを止めますか?",
    message: "止めたリンクを開いた人には「見つかりません」と表示されます。",
    ok: "止める",
  });
  if (!ok) return;
  try {
    await api.del(`/trips/${tripId.value}/invite`);
    toast("招待リンクを止めました");
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}

async function approve(r: JoinRequest) {
  try {
    await api.post(`/trips/${tripId.value}/join-requests/${r.userId}/approve`);
    toast(`${r.displayName}さんの参加を承認しました`);
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}

async function reject(r: JoinRequest) {
  const ok = await confirm({
    title: "申請を却下しますか?",
    message: `${r.displayName}さんの参加申請を却下します。`,
    ok: "却下する",
  });
  if (!ok) return;
  try {
    await api.post(`/trips/${tripId.value}/join-requests/${r.userId}/reject`);
    toast(`${r.displayName}さんの申請を却下しました`);
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}
</script>

<template>
  <div class="two-col">
    <section aria-labelledby="mem-title">
      <h2 id="mem-title">メンバー({{ view.members.length }} 人)</h2>
      <ul class="list-plain">
        <li v-for="m in view.members" :key="m.userId" class="row">
          <span class="avatar" aria-hidden="true">{{ m.displayName.slice(0, 1) }}</span>
          <span class="grow"
            >{{ m.displayName }}{{ m.userId === user?.userId ? "(あなた)" : "" }}</span
          >
          <span v-if="m.role === 'owner'" class="badge owner">オーナー</span>
        </li>
      </ul>

      <h2>招待リンク</h2>
      <template v-if="view.invite">
        <div class="invite-box">
          <label for="invite-url" class="visually-hidden">招待リンク</label>
          <input id="invite-url" type="text" readonly :value="inviteLink" />
          <button type="button" :disabled="expired" @click="copy">コピー</button>
        </div>
        <p v-if="expired" class="notice warn">
          このリンクは期限が切れています({{ fmtDateTime(view.invite.expiresAt) }}まで)。
          {{ owner ? "「発行し直す」で新しいリンクを作れます。" : "オーナーに新しいリンクを頼んでください。" }}
        </p>
        <p v-else class="small muted">
          {{ fmtDateTime(view.invite.expiresAt) }}
          まで有効。リンクを開いた人は参加を申請し、オーナーが承認するとメンバーになります。
        </p>
      </template>
      <p v-else class="notice warn">
        招待リンクは止められています。{{ owner ? "" : "オーナーに頼んでください。" }}
      </p>
      <template v-if="owner">
        <div class="actions">
          <button type="button" @click="reissue">
            {{ view.invite ? "リンクを発行し直す" : "リンクを発行する" }}
          </button>
          <button v-if="view.invite" type="button" class="danger" @click="stop">
            リンクを止める
          </button>
        </div>
        <p class="small muted">発行し直すと、前のリンクはすぐに使えなくなります。</p>
      </template>
    </section>

    <section v-if="owner" class="card" aria-labelledby="req-title">
      <h2 id="req-title" style="margin-top: 0">参加申請({{ requests.length }} 件)</h2>
      <ul v-if="requests.length" class="list-plain">
        <li v-for="r in requests" :key="r.userId" class="row">
          <span class="grow"
            ><strong>{{ r.displayName }}</strong>
            <div class="muted small">{{ fmtDateTime(r.requestedAt) }} に申請</div></span
          >
          <button type="button" class="small primary" @click="approve(r)"
  :aria-label="`承認: ${r.displayName}`">
            承認
          </button>
          <button type="button" class="small danger" @click="reject(r)"
  :aria-label="`却下: ${r.displayName}`">
            却下
          </button>
        </li>
      </ul>
      <p v-else class="muted">未処理の申請はありません。</p>
      <p class="small muted">
        承認するまで、申請した人はしおりを見られません。メンバーは 50 人までです(今
        {{ view.members.length }} 人)。
      </p>
    </section>
    <p v-else class="small muted">参加申請は、オーナー({{ ownerName }}さん)が承認します。</p>
  </div>
</template>
