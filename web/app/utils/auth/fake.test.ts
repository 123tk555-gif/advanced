import { beforeEach, describe, expect, it } from "vitest";
import { createFakeAuth, FAKE_CODE } from "./fake";

/** localStorage の代わり */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const email = "taro@example.com";
const password = "password-123";

describe("試験用のログイン(Cognito の代わり)", () => {
  let accounts: ReturnType<typeof memoryStorage>;
  let session: ReturnType<typeof memoryStorage>;
  let auth: ReturnType<typeof createFakeAuth>;
  beforeEach(() => {
    accounts = memoryStorage();
    session = memoryStorage();
    auth = createFakeAuth({ accounts, session });
  });

  it("登録 → 確認コード → ログインで、利用者の ID とトークンが取れる", async () => {
    await auth.signUp(email, password);
    await expect(auth.signIn(email, password)).rejects.toMatchObject({
      name: "UserNotConfirmedException",
    });
    await auth.confirmSignUp(email, FAKE_CODE);
    await auth.signIn(email, password);
    const s = await auth.currentSession();
    expect(s?.userId).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(s?.token).toBe(s?.userId);
  });

  it("同じメールアドレスは大文字・小文字を区別せず、同じ利用者になる", async () => {
    await auth.signUp(email, password);
    await auth.confirmSignUp(email, FAKE_CODE);
    await auth.signIn("Taro@Example.com", password);
    const a = await auth.currentSession();
    await auth.signOut();
    await auth.signIn(email, password);
    expect((await auth.currentSession())?.userId).toBe(a?.userId);
  });

  it("違うパスワード・登録していないメールは、同じ誤り", async () => {
    await auth.signUp(email, password);
    await auth.confirmSignUp(email, FAKE_CODE);
    await expect(auth.signIn(email, "wrong-password")).rejects.toMatchObject({
      name: "NotAuthorizedException",
    });
    await expect(auth.signIn("hanako@example.com", password)).rejects.toMatchObject({
      name: "NotAuthorizedException",
    });
  });

  it("登録済みのメールでの登録・違う確認コードは断る", async () => {
    await auth.signUp(email, password);
    await expect(auth.signUp(email, password)).rejects.toMatchObject({
      name: "UsernameExistsException",
    });
    await expect(auth.confirmSignUp(email, "000000")).rejects.toMatchObject({
      name: "CodeMismatchException",
    });
  });

  it("パスワードを再設定すると、新しいパスワードでだけ入れる", async () => {
    await auth.signUp(email, password);
    await auth.confirmSignUp(email, FAKE_CODE);
    await auth.resetPassword(email);
    await auth.confirmResetPassword(email, FAKE_CODE, "new-password-1");
    await expect(auth.signIn(email, password)).rejects.toMatchObject({
      name: "NotAuthorizedException",
    });
    await auth.signIn(email, "new-password-1");
    expect(await auth.currentSession()).not.toBeNull();
  });

  it("ログアウトするとセッションが消える。利用者を消すと、もう入れない", async () => {
    await auth.signUp(email, password);
    await auth.confirmSignUp(email, FAKE_CODE);
    await auth.signIn(email, password);
    await auth.signOut();
    expect(await auth.currentSession()).toBeNull();
    await auth.signIn(email, password);
    await auth.deleteUser();
    expect(await auth.currentSession()).toBeNull();
    await expect(auth.signIn(email, password)).rejects.toMatchObject({
      name: "NotAuthorizedException",
    });
  });
});
