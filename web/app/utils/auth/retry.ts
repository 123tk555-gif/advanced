/**
 * トークンを付けて送る。401 が返ったら、トークンを取り直して 1 回だけ送り直す
 * (期限切れの直後など。取り直しても 401 なら、そのまま返す)。
 */
export async function sendWithToken(
  send: (token: string | null) => Promise<Response>,
  getToken: (force: boolean) => Promise<string | null>,
): Promise<Response> {
  const token = await getToken(false);
  const first = await send(token);
  if (first.status !== 401 || token === null) return first;
  let fresh: string | null;
  try {
    fresh = await getToken(true);
  } catch {
    return first;
  }
  if (fresh === null) return first;
  return send(fresh);
}
