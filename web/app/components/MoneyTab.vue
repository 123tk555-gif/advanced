<script setup lang="ts">
import type { Expense, TripView } from "~/types/api";

/** 割り勘タブ: 支出の記録と、精算(誰が誰にいくら) */
const props = defineProps<{ view: TripView }>();
const emit = defineEmits<{ changed: [] }>();
const api = useApi();
const { toast } = useToast();
const { confirm } = useConfirm();
const { user } = useAuth();

const tripId = computed(() => props.view.trip.tripId);
const nameOf = (id: string) =>
  props.view.members.find((m) => m.userId === id)?.displayName ?? "元メンバー";
const total = computed(() => props.view.expenses.reduce((s, e) => s + e.amount, 0));

/** 一人ずつ: 立て替えた額と、差し引き(受け取る +、払う −) */
const people = computed(() => {
  const paid = new Map<string, number>();
  for (const e of props.view.expenses) paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.amount);
  const balance = new Map<string, number>();
  for (const t of props.view.settlement) {
    balance.set(t.from, (balance.get(t.from) ?? 0) - t.amount);
    balance.set(t.to, (balance.get(t.to) ?? 0) + t.amount);
  }
  const ids = new Set([
    ...props.view.members.map((m) => m.userId),
    ...paid.keys(),
    ...balance.keys(),
  ]);
  return [...ids].map((id) => ({ id, paid: paid.get(id) ?? 0, balance: balance.get(id) ?? 0 }));
});

// ---- 支出の記録 ----
const title = ref("");
const amount = ref<number | null>(null);
const paidBy = ref(user.value?.userId ?? "");
const splitWith = ref<string[]>(props.view.members.map((m) => m.userId));
const errors = ref<string[]>([]);
const recording = ref(false);
watch(
  () => props.view.members.map((m) => m.userId).join(","),
  (now, before) => {
    const ids = now.split(",");
    const previous = before.split(",");
    // 全員で割るつもりの入力なら、入力中に入った人も加える。人を選んでいたら、その選択は変えない
    const everyone = previous.every((id) => splitWith.value.includes(id));
    splitWith.value = ids.filter(
      (id) => splitWith.value.includes(id) || (everyone && !previous.includes(id)),
    );
    if (!ids.includes(paidBy.value)) paidBy.value = user.value?.userId ?? ids[0] ?? "";
  },
);

async function record() {
  const found: string[] = [];
  if (!title.value.trim()) found.push("内容を入力してください");
  if (title.value.trim().length > 50) found.push("内容は 50 文字までです");
  const n = Number(amount.value);
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) {
    found.push("金額は 1 円以上 1000 万円以下の整数にしてください");
  }
  if (!splitWith.value.length) found.push("分け合う人を 1 人以上選んでください");
  errors.value = found;
  if (found.length || recording.value) return;
  recording.value = true;
  try {
    await api.post(`/trips/${tripId.value}/expenses`, {
      title: title.value.trim(),
      amount: n,
      paidBy: paidBy.value,
      splitWith: splitWith.value,
    });
    toast(`「${title.value.trim()}」${yen(n)}を記録しました`);
    title.value = "";
    amount.value = null;
    emit("changed");
  } catch (error) {
    errors.value = [errorMessage(error)];
  } finally {
    recording.value = false;
  }
}

async function remove(e: Expense) {
  const ok = await confirm({
    title: "支出を削除しますか?",
    message: `「${e.title}」(${yen(e.amount)})を削除します。`,
    ok: "削除する",
  });
  if (!ok) return;
  try {
    await api.del(`/trips/${tripId.value}/expenses/${e.expenseId}`);
    toast("支出を削除しました");
  } catch (error) {
    toast(errorMessage(error));
  }
  emit("changed");
}
</script>

<template>
  <div class="two-col">
    <section aria-labelledby="exp-title">
      <h2 id="exp-title">支出(合計 {{ yen(total) }})</h2>
      <table v-if="view.expenses.length">
        <thead>
          <tr>
            <th scope="col">内容</th>
            <th scope="col">払った人</th>
            <th scope="col" class="money">金額</th>
            <th scope="col"><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in view.expenses" :key="e.expenseId">
            <td>
              {{ e.title }}
              <div class="muted small">{{ e.splitWith.map(nameOf).join("・") }}で割る</div>
            </td>
            <td>{{ nameOf(e.paidBy) }}</td>
            <td class="money">{{ yen(e.amount) }}</td>
            <td>
              <button type="button" class="small danger" @click="remove(e)"
  :aria-label="`削除: ${e.title}`">
                削除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">まだ支出がありません</p>

      <h2>支出を記録する</h2>
      <form class="card" novalidate @submit.prevent="record">
        <ErrorsBox :errors="errors" />
        <label for="ex-title">内容 <span class="hint">50 文字まで</span></label>
        <input id="ex-title" v-model="title" type="text" maxlength="50" />
        <div class="field-row">
          <div>
            <label for="ex-amount">金額(円)</label>
            <input
              id="ex-amount"
              v-model.number="amount"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
            />
          </div>
          <div>
            <label for="ex-paid">払った人</label>
            <select id="ex-paid" v-model="paidBy">
              <option v-for="m in view.members" :key="m.userId" :value="m.userId">
                {{ m.displayName }}
              </option>
            </select>
          </div>
        </div>
        <fieldset>
          <legend>分け合う人</legend>
          <label v-for="m in view.members" :key="m.userId" class="check">
            <input v-model="splitWith" type="checkbox" :value="m.userId" />
            {{ m.displayName }}
          </label>
        </fieldset>
        <div class="actions">
          <button type="submit" class="primary" :disabled="recording">記録する</button>
        </div>
      </form>
    </section>

    <section class="card" aria-labelledby="settle-title">
      <h2 id="settle-title" style="margin-top: 0">精算</h2>
      <template v-if="view.settlement.length">
        <ul class="list-plain">
          <li v-for="t in view.settlement" :key="`${t.from}-${t.to}`" class="row">
            <span class="grow"
              ><strong>{{ nameOf(t.from) }}</strong> → <strong>{{ nameOf(t.to) }}</strong></span
            >
            <span class="money">{{ yen(t.amount) }}</span>
          </li>
        </ul>
        <p class="small muted">
          送金は {{ view.settlement.length }} 回です(なるべく少なくなるように組み合わせています)。
        </p>
      </template>
      <p v-else>精算は必要ありません。</p>
      <h3>一人ずつの内訳</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">名前</th>
            <th scope="col" class="money">立て替え</th>
            <th scope="col" class="money">差し引き</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in people" :key="p.id">
            <td>{{ nameOf(p.id) }}</td>
            <td class="money">{{ yen(p.paid) }}</td>
            <td class="money">
              {{
                p.balance > 0 ? `受け取る ${yen(p.balance)}` : p.balance < 0 ? `払う ${yen(-p.balance)}` : "0 円"
              }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="small muted">
        1 人あたりの額は 1 円未満を切り捨て、端数は払った人の負担にしています。抜けたメンバーの支出も含みます。
      </p>
    </section>
  </div>
</template>
