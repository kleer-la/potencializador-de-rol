import { useState } from 'react';
import { api, ApiError, type SignInOptions } from '../api/client.ts';
import { SignInPanel } from '../components/SignInPanel.tsx';
import { messages, passwordErrors, passwordMessages, signInErrors } from '../copy.ts';

type Props = {
  options: SignInOptions;
  /** Called once a session was opened. */
  onSignedIn: () => void;
};

const address = () => new URLSearchParams(window.location.search);

/** The provider callback reports a refusal as `?error=<code>` in the address. */
function errorFromAddress(): string | null {
  const code = address().get('error');
  return code === null ? null : (signInErrors[code] ?? signInErrors.sign_in_failed ?? null);
}

const explain = (error: unknown) =>
  (error instanceof ApiError ? passwordErrors[error.code] : undefined) ?? messages.requestFailed;

export function SignInPage({ options, onSignedIn }: Props) {
  // The mailed link opens `/?confirm=<token>`, where the person chooses the password. Only
  // submitting it uses the link, so a mail scanner that opens the link does not use it up.
  const [confirmToken, setConfirmToken] = useState(() => address().get('confirm'));
  const [error, setError] = useState<string | null>(errorFromAddress);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setBusy(false);
    }
  };

  const leaveConfirmation = () => {
    window.history.replaceState({}, '', '/');
    setConfirmToken(null);
  };

  return (
    <SignInPanel
      options={options}
      error={error}
      notice={notice}
      confirming={confirmToken !== null}
      busy={busy}
      onPasswordSignIn={(email, password) =>
        run(async () => {
          await api.passwordSignIn(email, password);
          onSignedIn();
        })
      }
      onRequestLink={(email) =>
        run(async () => {
          await api.requestPasswordLink(email);
          setNotice(passwordMessages.linkSent);
        })
      }
      onChoosePassword={(password) =>
        run(async () => {
          try {
            await api.confirmPassword(confirmToken ?? '', password);
          } catch (failure) {
            // A refused password keeps the link for another try; a used or expired link does not.
            if (!(failure instanceof ApiError && failure.code === 'invalid_password')) leaveConfirmation();
            throw failure;
          }
          leaveConfirmation();
          onSignedIn();
        })
      }
    />
  );
}
