/**
 * 読み直しの前に、入力中の場所を控える。
 * 並びが変わって要素が動くと、ブラウザはフォーカスを外してしまうため、戻り値を呼んで戻す。
 */
export function keepFocus(): () => void {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return () => {};

  let range: [number, number] | null = null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // date・number などの欄では null になる
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      range = [el.selectionStart, el.selectionEnd];
    }
  }
  return () => {
    // 自分の並べ替えなどで、別の場所へ意図して移したフォーカスは奪わない
    if (!el.isConnected || document.activeElement !== document.body) return;
    el.focus({ preventScroll: true });
    if (range) (el as HTMLInputElement).setSelectionRange(...range);
  };
}
