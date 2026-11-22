import type { Editor } from "@tritri/shared";

/** 「はなこさん、じろうさんが編集中」の形 */
export function editingText(editors: readonly Editor[]): string {
  return `${editors.map((e) => `${e.displayName}さん`).join("、")}が編集中`;
}
