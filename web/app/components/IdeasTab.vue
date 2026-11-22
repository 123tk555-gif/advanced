<script setup lang="ts">
import type { Idea, Place, TripView } from "~/types/api";
import { placeError } from "~/utils/geo/input";

/** 候補タブ: 行きたい場所の候補・投票・旅程に入れる */
const props = defineProps<{ view: TripView }>();
const emit = defineEmits<{ changed: [] }>();
const api = useApi();
const { toast } = useToast();
const { confirm } = useConfirm();
const { user } = useAuth();

const tripId = computed(() => props.view.trip.tripId);
const days = computed(() => daysOf(props.view.trip));
const maxVotes = computed(() => Math.max(1, ...props.view.ideas.map((i) => i.voteCount)));
const nameOf = (id: string) =>
  props.view.members.find((m) => m.userId === id)?.displayName ?? "元メンバー";
const adoptedDay = (idea: Idea) =>
  props.view.items.find((i) => i.itemId === idea.adoptedItemId)?.day;
const canDelete = (idea: Idea) =>
  idea.createdBy === user.value?.userId || props.view.myRole === "owner";

// ---- 候補を出す ----
const name = ref("");
const note = ref("");
const place = ref<Place | null>(null);
const placeText = ref("");
const errors = ref<string[]>([]);
async function propose() {
  const found: string[] = [];
  if (!name.value.trim()) found.push("候補の名前を入力してください");
  if (name.value.trim().length > 100) found.push("候補の名前は 100 文字までです");
  if (note.value.trim().length > 100) found.push("ひとことは 100 文字までです");
  const placeProblem = placeError(place.value, placeText.value);
  if (placeProblem) found.push(placeProblem);
  errors.value = found;
  if (found.length) return;
  try {
    await api.post(`/trips/${tripId.value}/ideas`, {
      name: name.value.trim(),
      place: place.value,
      note: note.value.trim(),
    });
    toast(`「${name.value.trim()}」を候補に出しました`);
    name.value = "";
    note.value = "";
    place.value = null;
    placeText.value = "";
    emit("changed");
  } catch (error) {
    errors.value = [errorMessage(error)];
  }
}

// ---- 投票 ----
async function toggleVote(idea: Idea) {
  try {
    const url = `/trips/${tripId.value}/ideas/${idea.ideaId}/vote`;
    if (idea.myVote) await api.del(url);
    else await api.put(url);
    emit("changed");
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function remove(idea: Idea) {
  const ok = await confirm({
    title: "候補を消しますか?",
    message: `「${idea.name}」と、その投票を消します。`,
    ok: "消す",
  });
  if (!ok) return;
  try {
    await api.del(`/trips/${tripId.value}/ideas/${idea.ideaId}`);
    toast(`「${idea.name}」を消しました`);
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}

// ---- 旅程に入れる ----
const adopting = ref<Idea | null>(null);
const adoptDay = ref(1);
function openAdopt(idea: Idea) {
  adopting.value = idea;
  adoptDay.value = 1;
}
async function adopt() {
  const idea = adopting.value;
  if (!idea) return;
  try {
    await api.post(`/trips/${tripId.value}/ideas/${idea.ideaId}/adopt`, {
      day: adoptDay.value,
      order: orderAtEnd(props.view.items, adoptDay.value),
    });
    toast(`「${idea.name}」を ${adoptDay.value}日目に入れました`);
  } catch (error) {
    toast(errorMessage(error));
  }
  adopting.value = null;
  emit("changed");
}
</script>

<template>
  <div class="two-col">
    <section aria-labelledby="ideas-title">
      <h2 id="ideas-title">行きたい場所の候補</h2>
      <ul v-if="view.ideas.length" class="list-plain">
        <li v-for="idea in view.ideas" :key="idea.ideaId" class="row">
          <div class="grow">
            <strong>{{ idea.name }}</strong>
            <span v-if="idea.adoptedItemId" class="badge owner">
              旅程に入れました({{ adoptedDay(idea) ?? "?" }}日目)
            </span>
            <div v-if="idea.note">{{ idea.note }}</div>
            <div class="muted small">
              提案: {{ nameOf(idea.createdBy) }}
              <template v-if="idea.voters.length">
                ・ 投票した人: {{ idea.voters.map(nameOf).join("、") }}
              </template>
            </div>
            <div class="bar" aria-hidden="true">
              <span :style="{ width: `${(idea.voteCount / maxVotes) * 100}%` }" />
            </div>
          </div>
          <span class="votes">{{ idea.voteCount }} 票</span>
          <button
            type="button"
            class="small"
            :aria-pressed="idea.myVote"
            :aria-label="`${idea.myVote ? '投票済み(取り消す)' : '行きたい!'}: ${idea.name}`"
            @click="toggleVote(idea)"
          >
            {{ idea.myVote ? "投票済み(取り消す)" : "行きたい!"
            }}
          </button>
          <button
            v-if="!idea.adoptedItemId"
            type="button"
            class="small"
            @click="openAdopt(idea)"
  :aria-label="`旅程に入れる: ${idea.name}`"
          >
            旅程に入れる
          </button>
          <button v-if="canDelete(idea)" type="button" class="small danger" @click="remove(idea)"
  :aria-label="`消す: ${idea.name}`">
            消す
          </button>
        </li>
      </ul>
      <p v-else class="empty">まだ候補がありません</p>
    </section>

    <section class="card" aria-labelledby="idea-form-title">
      <h2 id="idea-form-title" style="margin-top: 0">候補を出す</h2>
      <form novalidate @submit.prevent="propose">
        <ErrorsBox :errors="errors" />
        <label for="idea-name">候補の名前 <span class="hint">100 文字まで</span></label>
        <input id="idea-name" v-model="name" type="text" maxlength="100" autocomplete="off" />
        <label for="idea-place"
          >場所 <span class="hint">省略できます。地名を入れて候補から選ぶと、旅程に入れたとき地図に出ます</span></label
        >
        <PlaceInput v-model="place" v-model:text="placeText" input-id="idea-place" />
        <label for="idea-note">ひとこと <span class="hint">省略できます。100 文字まで</span></label>
        <input id="idea-note" v-model="note" type="text" maxlength="100" />
        <div class="actions"><button type="submit" class="primary">候補に出す</button></div>
      </form>
    </section>

    <AppDialog :open="adopting !== null" title-id="adopt-title" @close="adopting = null">
      <template v-if="adopting">
        <h2 id="adopt-title">「{{ adopting.name }}」を旅程に入れる</h2>
        <form @submit.prevent="adopt">
          <label for="adopt-day">どの日に入れますか(その日の最後に入ります)</label>
          <select id="adopt-day" v-model.number="adoptDay">
            <option v-for="d in days" :key="d" :value="d">
              {{ d }}日目 {{ fmtDay(dateOf(view.trip.startDate, d - 1)) }}
            </option>
          </select>
          <div class="actions">
            <button type="submit" class="primary">旅程に入れる</button>
            <button type="button" @click="adopting = null">やめる</button>
          </div>
        </form>
      </template>
    </AppDialog>
  </div>
</template>
