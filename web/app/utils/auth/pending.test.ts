import { describe, expect, it } from "vitest";
import { createPendingName } from "./pending";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("会員登録で入れた表示名を、ログインまで持ち越す", () => {
  it("同じメールアドレスでログインしたら取り出せる(大文字・小文字と前後の空白は区別しない)", () => {
    const pending = createPendingName(memoryStorage());
    pending.save(" Taro@Example.com ", "たろう");
    expect(pending.take("taro@example.com")).toBe("たろう");
  });

  it("取り出したら消える。別のメールアドレスでは取り出せない", () => {
    const pending = createPendingName(memoryStorage());
    pending.save("taro@example.com", "たろう");
    expect(pending.take("hanako@example.com")).toBeNull();
    expect(pending.take("taro@example.com")).toBe("たろう");
    expect(pending.take("taro@example.com")).toBeNull();
  });

  it("保存が使えない・壊れていても、止まらない", () => {
    const broken = {
      getItem: () => "{壊れた",
      setItem: () => {
        throw new Error("使えない");
      },
      removeItem: () => {},
    };
    const pending = createPendingName(broken);
    expect(() => pending.save("taro@example.com", "たろう")).not.toThrow();
    expect(pending.take("taro@example.com")).toBeNull();
  });
});
