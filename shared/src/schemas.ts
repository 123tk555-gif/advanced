import { z } from "zod";

/** 旅の日数の上限(開始日と終了日を含む) */
export const MAX_TRIP_DAYS = 30;
/** 1 つの旅のメンバーの上限(オーナーを含む) */
export const MAX_MEMBERS = 50;
/** 1 つの旅の、未処理の参加申請の上限 */
export const MAX_PENDING_JOIN_REQUESTS = 50;
/** 招待リンクの有効日数 */
export const INVITE_VALID_DAYS = 7;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const profileInput = z.object({
  displayName: trimmed(1, 20),
});
export type ProfileInput = z.infer<typeof profileInput>;

/** 開始日と終了日を含めた日数 */
export function tripDays(startDate: string, endDate: string): number {
  return (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
}

export const tripInput = z
  .object({
    title: trimmed(1, 50),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    destination: trimmed(0, 50).optional().default(""),
  })
  .refine((t) => t.endDate >= t.startDate, {
    message: "終了日は開始日以降にしてください",
    path: ["endDate"],
  })
  .refine((t) => tripDays(t.startDate, t.endDate) <= MAX_TRIP_DAYS, {
    message: `旅の日数は ${MAX_TRIP_DAYS} 日までです`,
    path: ["endDate"],
  });
export type TripInput = z.infer<typeof tripInput>;

/** オーナーの引き継ぎ先 */
export const transferInput = z.object({ userId: z.string().min(1) });
