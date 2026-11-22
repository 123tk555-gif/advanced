/**
 * 日付の入力欄の読み書き。画面では YYYY/MM/DD、データ(API)では YYYY-MM-DD。
 */

/**
 * 入力した文字を YYYY-MM-DD にする。日付として読めなければ null。
 * 2027/4/1・20270401・2027-04-01・全角の数字も受け付ける。
 */
export function parseDateInput(text: string): string | null {
  const s = text.normalize("NFKC").trim();
  const m = s.match(/^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/) ?? s.match(/^(\d{4})()(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, year = "", , month = "", day = ""] = m;
  if (Number(year) < 1000) return null;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  // 2/30 のように存在しない日は、Date が別の日に繰り上げるか、読めない
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** 入力欄に出す文字。日付として読めなければ、打ったままにする */
export function toDateText(value: string): string {
  return parseDateInput(value)?.replaceAll("-", "/") ?? value;
}
