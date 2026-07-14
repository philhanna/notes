import type { AuthState } from "../auth/useAuth.ts";

interface SignInProps {
  auth: AuthState;
}

/** Device-flow sign-in screen (design.md 8): shows the code once requested. */
export function SignIn({ auth }: SignInProps) {
  if (auth.status === "authorizing") {
    return (
      <div className="sign-in">
        <p>
          Open{" "}
          <a
            href={auth.verificationUri ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            {auth.verificationUri}
          </a>{" "}
          and enter this code:
        </p>
        <p className="sign-in__code">{auth.userCode}</p>
        <p>Waiting for authorization…</p>
        <button type="button" onClick={auth.cancelSignIn}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="sign-in">
      <p>Sign in with GitHub to open your notes.</p>
      <button type="button" onClick={auth.signIn}>
        Sign in with GitHub
      </button>
    </div>
  );
}
