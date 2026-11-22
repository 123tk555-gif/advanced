import { MAX_TRIP_DAYS, tripDays } from "@tritri/shared";
import { parseDateInput } from "./date";

/** 旅の入力の確認(画面で先に確かめる。最終的な確認はサーバーが行う) */
export function validateTrip(v: {
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
}): string[] {
  const errors: string[] = [];
  const title = v.title.trim();
  if (!title) errors.push("タイトルを入力してください");
  if (title.length > 50) errors.push("タイトルは 50 文字までです");
  if (!v.startDate || !v.endDate) errors.push("開始日と終了日を入力してください");
  else if (parseDateInput(v.startDate) !== v.startDate)
    errors.push("開始日は正しい日付を YYYY/MM/DD の形で入力してください");
  else if (parseDateInput(v.endDate) !== v.endDate)
    errors.push("終了日は正しい日付を YYYY/MM/DD の形で入力してください");
  else if (v.endDate < v.startDate) errors.push("終了日は開始日以降にしてください");
  else if (tripDays(v.startDate, v.endDate) > MAX_TRIP_DAYS) {
    errors.push(`旅の日数は ${MAX_TRIP_DAYS} 日までです`);
  }
  if (v.destination.trim().length > 50) errors.push("行き先は 50 文字までです");
  return errors;
}
