import { tripDays } from "@tritri/shared";

/** 旅の開始日から offset 日後の日付 */
export function dateOf(startDate: string, offset: number): Date {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d;
}

/** 4/1(木) の形 */
export function fmtDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`;
}

/** 2027年 4/1(木) 〜 4/3(土) の形 */
export function fmtRange(trip: { startDate: string; endDate: string }): string {
  const s = dateOf(trip.startDate, 0);
  return `${s.getFullYear()}年 ${fmtDay(s)} 〜 ${fmtDay(dateOf(trip.endDate, 0))}`;
}

/** 11/14 16:10 の形 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 1,500 円 の形 */
export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")} 円`;
}

/** 旅の日数(開始日と終了日を含む) */
export function daysOf(trip: { startDate: string; endDate: string }): number {
  return tripDays(trip.startDate, trip.endDate);
}
