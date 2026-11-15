<script setup lang="ts">
import type { TripFields } from "~/components/TripForm.vue";
import type { Trip } from "~/types/api";

useHead({ title: "旅を作る | Tri-Tri" });
const api = useApi();
const { toast } = useToast();
const form = ref<TripFields>({ title: "", startDate: "", endDate: "", destination: "" });
const errors = ref<string[]>([]);
const busy = ref(false);

async function submit() {
  errors.value = validateTrip(form.value);
  if (errors.value.length) return;
  busy.value = true;
  try {
    const res = await api.post<{ trip: Trip }>("/trips", form.value);
    toast("旅を作りました。メンバータブの招待リンクで友だちを誘えます");
    await navigateTo(`/trips/${res.trip.tripId}`);
  } catch (error) {
    errors.value = [errorMessage(error)];
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="narrow-page">
    <h1>旅を作る</h1>
    <form novalidate @submit.prevent="submit">
      <ErrorsBox :errors="errors" />
      <TripForm v-model="form" />
      <div class="actions">
        <button class="primary" type="submit" :disabled="busy">作る</button>
        <NuxtLink class="button" to="/trips">やめる</NuxtLink>
      </div>
    </form>
  </div>
</template>
