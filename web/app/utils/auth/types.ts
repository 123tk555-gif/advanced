/** ログイン中の利用者を API に伝えるためのもの */
export interface AuthSession {
  /** 利用者の ID(Cognito なら sub) */
  userId: string;
  /** API へ送るトークン(Cognito ならアクセストークン) */
  token: string;
}

/**
 * メールアドレスとパスワードのログインの仕組み。本番は Cognito、自動テストは試験用(fake.ts)。
 * 失敗したら、Cognito と同じ name(NotAuthorizedException など)の Error を投げる。
 */
export interface AuthProvider {
  signUp(email: string, password: string): Promise<void>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendSignUpCode(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  confirmResetPassword(email: string, code: string, newPassword: string): Promise<void>;
  /** 今のセッション。期限が近ければ更新する。force なら必ず取り直す。ログインしていなければ null */
  currentSession(force?: boolean): Promise<AuthSession | null>;
  /** ログイン中の利用者を消す(退会) */
  deleteUser(): Promise<void>;
}

/** 名前つきの誤り(Cognito と同じ形) */
export function authError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}
