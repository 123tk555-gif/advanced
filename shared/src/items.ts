import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { MAX_TRIP_DAYS } from "./schemas.js";

/** 1 つの旅の予定の上限 */
export const MAX_ITEMS_PER_TRIP = 300;

/**
 * 並び順のキーとして正しい形か。
 * キーは画面側で generateKeyBetween(前の予定のキー, 後ろの予定のキー) で作る。
 * 並べ替えでは、動かした予定のキーだけを書き換えればよい。
 */
export function isValidOrderKey(key: string): boolean {
  if (key.length === 0 || key.length > 64) return false;
  try {
    generateKeyBetween(key, null); // 形が正しくなければ例外になる
    return true;
  } catch {
    return false;
  }
}

/** 並び順のキーの比べ方(文字コードの順。localeCompare は使わない) */
export function compareOrderKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 場所。保存するのは Google の場所の ID と、利用者が入力した表示名だけ。
 * 座標と Google の名前は、Google の規約でずっとは保存できないので受け取らない(表示のたびに ID から取る)。
 */
const placeSchema = z.strictObject({
  placeId: z.string().min(1).max(300),
  label: z.string().trim().min(1).max(200),
});
export type Place = z.infer<typeof placeSchema>;

const fields = {
  day: z.number().int().min(1).max(MAX_TRIP_DAYS),
  order: z.string().refine(isValidOrderKey, "並び順の形が正しくありません"),
  time: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),
  title: z.string().trim().min(1).max(100),
  place: placeSchema.nullable(),
  memo: z.string().max(1000),
};

export const itemCreate = z.object({
  day: fields.day,
  order: fields.order,
  title: fields.title,
  time: fields.time.optional().default(""),
  place: fields.place.optional().default(null),
  memo: fields.memo.optional().default(""),
});
export type ItemCreate = z.infer<typeof itemCreate>;

const patchFields = {
  day: fields.day.optional(),
  order: fields.order.optional(),
  title: fields.title.optional(),
  time: fields.time.optional(),
  place: fields.place.optional(),
  memo: fields.memo.optional(),
};

/** 予定の更新。version は、編集を始めたときに読んだ版(楽観ロック) */
export const itemPatch = z
  .object({ version: z.number().int().min(1), ...patchFields })
  .refine((p) => Object.keys(patchFields).some((k) => p[k as keyof typeof p] !== undefined), {
    message: "変える項目がありません",
  });
export type ItemPatch = z.infer<typeof itemPatch>;

// ---- 行きたい場所の候補 ----

/** 1 つの旅の候補の上限 */
export const MAX_IDEAS_PER_TRIP = 100;

export const ideaCreate = z.object({
  name: z.string().trim().min(1).max(100),
  place: placeSchema.nullable().optional().default(null),
  note: z.string().trim().max(100).optional().default(""),
});
export type IdeaCreate = z.infer<typeof ideaCreate>;

/** 候補を旅程に入れるとき: どの日の、どの並び位置に入れるか */
export const ideaAdopt = z.object({ day: fields.day, order: fields.order });
export type IdeaAdopt = z.infer<typeof ideaAdopt>;

// ---- コメント ----

/** 1 つの予定のコメントの上限 */
export const MAX_COMMENTS_PER_ITEM = 200;
/** 1 つの旅のコメントの上限(旅の画面の応答を AWS Lambda の上限 6MB に収めるため) */
export const MAX_COMMENTS_PER_TRIP = 2000;

export const commentCreate = z.object({ body: z.string().trim().min(1).max(200) });
export type CommentCreate = z.infer<typeof commentCreate>;
