import { Amplify } from "aws-amplify";
import {
  confirmResetPassword,
  confirmSignUp,
  deleteUser,
  fetchAuthSession,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from "aws-amplify/auth";
import { type AuthProvider, authError } from "./types";

/**
 * 本番のログイン(Amazon Cognito)。パスワードは SRP で確かめ、そのものは送らない。
 * トークンはこのブラウザに保存され、期限が近づくと Amplify が更新する。
 */
export function createCognitoAuth(config: { userPoolId: string; clientId: string }): AuthProvider {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.clientId,
        loginWith: { email: true },
      },
    },
  });

  return {
    async signUp(email, password) {
      await signUp({
        username: email.trim(),
        password,
        options: { userAttributes: { email: email.trim() } },
      });
    },
    async confirmSignUp(email, code) {
      await confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
    },
    async resendSignUpCode(email) {
      await resendSignUpCode({ username: email.trim() });
    },
    async signIn(email, password) {
      // 前のログインが残っていると Amplify は断るので、先に出る
      await signOut().catch(() => {});
      const result = await signIn({ username: email.trim(), password });
      if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        throw authError("UserNotConfirmedException");
      }
      if (result.nextStep.signInStep !== "DONE") {
        // 多要素認証などは使っていない。想定外の手順は誤りにする
        throw authError("UnsupportedSignInStep", result.nextStep.signInStep);
      }
    },
    async signOut() {
      await signOut();
    },
    async resetPassword(email) {
      await resetPassword({ username: email.trim() });
    },
    async confirmResetPassword(email, code, newPassword) {
      await confirmResetPassword({
        username: email.trim(),
        confirmationCode: code.trim(),
        newPassword,
      });
    },
    async currentSession(force = false) {
      const session = await fetchAuthSession({ forceRefresh: force });
      const access = session.tokens?.accessToken;
      const sub = access?.payload.sub;
      if (!access || typeof sub !== "string") return null;
      return { userId: sub, token: access.toString() };
    },
    async deleteUser() {
      await deleteUser();
    },
  };
}
