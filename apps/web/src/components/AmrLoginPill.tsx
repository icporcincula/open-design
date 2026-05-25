import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  cancelVelaLogin,
  fetchVelaLoginStatus,
  startVelaLogin,
  velaLogout,
  type VelaLoginStatus,
} from '../providers/daemon';
import { useI18n } from '../i18n';
import {
  AMR_LOGIN_STATUS_EVENT,
  AMR_LOGIN_POLL_INTERVAL_MS,
  AMR_LOGIN_STARTUP_SETTLE_MS,
  amrLoginPollOutcome,
  amrLoginStatusEventReason,
  notifyAmrLoginStatusChanged,
} from './amrLoginPolling';

interface AmrLoginPillProps {
  className?: string;
  hideSignedOutStatus?: boolean;
}

export type AmrAccountControlStatus =
  | 'signed-out'
  | 'signing-in'
  | 'signed-in'
  | 'error';

export interface AmrAccountControlProps {
  status: AmrAccountControlStatus;
  className?: string;
  compact?: boolean;
  email?: string;
  errorMessage?: string | null;
  profile?: string;
  showProfileBadge?: boolean;
  showSignInAction?: boolean;
  hideSignedOutStatus?: boolean;
  onSignIn?: (event: MouseEvent<HTMLButtonElement>) => void;
  onSignOut?: (event: MouseEvent<HTMLButtonElement>) => void;
  signInDisabled?: boolean;
  signOutDisabled?: boolean;
}

function profileBadgeLabel(profile: string | undefined): string | null {
  if (profile === 'test') return 'TEST';
  if (profile === 'local') return 'LOCAL';
  return null;
}

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export function AmrAccountControl({
  status,
  className,
  compact = false,
  email = '',
  profile,
  showProfileBadge = false,
  showSignInAction = true,
  hideSignedOutStatus = false,
  onSignIn,
  onSignOut,
  signInDisabled = false,
  signOutDisabled = false,
}: AmrAccountControlProps) {
  const { t } = useI18n();
  const badgeLabel = showProfileBadge ? profileBadgeLabel(profile) : null;
  const isSignedIn = status === 'signed-in';
  const isSigningIn = status === 'signing-in';
  const hasError = status === 'error';
  const statusText = isSignedIn
    ? email || t('settings.amrSignedIn')
    : isSigningIn
      ? t('settings.amrSigningIn')
      : hideSignedOutStatus
        ? ''
        : t('settings.amrNotSignedIn');
  const canSignIn = showSignInAction && (status === 'signed-out' || hasError);

  return (
    <div
      className={classNames(
        'amr-account-control',
        compact && 'amr-account-control--compact',
        `amr-account-control--${status}`,
        className,
      )}
      role="group"
      aria-label={t('settings.amrAccountStatus')}
    >
      {statusText ? (
        <span className="amr-account-control__status">{statusText}</span>
      ) : null}
      {isSignedIn && onSignOut ? (
        <button
          type="button"
          className="amr-account-control__action"
          disabled={signOutDisabled}
          onClick={onSignOut}
          title={email || undefined}
          aria-label={t('settings.amrLogout')}
        >
          {signOutDisabled ? t('settings.amrLoggingOut') : t('settings.amrLogout')}
        </button>
      ) : null}
      {canSignIn ? (
        <button
          type="button"
          className="amr-account-control__action"
          disabled={signInDisabled}
          onClick={onSignIn}
        >
          {t('settings.amrSignIn')}
        </button>
      ) : null}
      {badgeLabel ? (
        <span className="amr-login-pill-badge">{badgeLabel}</span>
      ) : null}
      {hasError ? (
        <span className="amr-account-control__error" role="alert">
          {t('settings.amrLoginErrorCompact')}
        </span>
      ) : null}
    </div>
  );
}

// AMR-specific login pill that lives as a sibling inside the installed
// agent card (next to the Test button). The pill polls
// `/api/integrations/vela/status` after a Sign-in click until the daemon
// reports loggedIn=true — vela CLI handles the device-authorization URL /
// code / browser open itself (see apps/cli/internal/commands/login.go in
// nexu-io/vela), so Open Design's UI only needs to kick the subprocess
// off and surface the result.
export function AmrLoginPill({
  className,
  hideSignedOutStatus = false,
}: AmrLoginPillProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<VelaLoginStatus | null>(null);
  const [pending, setPending] = useState<null | 'login' | 'logout'>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const loginStartedAtRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchVelaLoginStatus();
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    return () => stopPolling();
  }, [refresh, stopPolling]);

  const startPolling = useCallback((startedAt = Date.now()) => {
    stopPolling();
    loginStartedAtRef.current = startedAt;
    const tick = async () => {
      const next = await refresh();
      const outcome = amrLoginPollOutcome(next, startedAt);
      if (outcome === 'signed-in') {
        stopPolling();
        loginStartedAtRef.current = null;
        setPending(null);
        return;
      }
      if (outcome === 'stopped' || outcome === 'timed-out') {
        stopPolling();
        if (outcome === 'timed-out') {
          void cancelVelaLogin().then(() =>
            notifyAmrLoginStatusChanged('login-canceled'),
          );
        }
        loginStartedAtRef.current = null;
        setPending(null);
        setErrorMessage(t('settings.amrLoginErrorCompact'));
      }
    };
    pollRef.current = window.setInterval(() => {
      void tick();
    }, AMR_LOGIN_POLL_INTERVAL_MS);
  }, [refresh, stopPolling, t]);

  useEffect(() => {
    const onStatusChange = (event: Event) => {
      const reason = amrLoginStatusEventReason(event);
      if (reason === 'login-started') {
        const startedAt = Date.now();
        loginStartedAtRef.current = startedAt;
        setErrorMessage(null);
        setPending('login');
        startPolling(startedAt);
      } else if (reason === 'login-canceled') {
        loginStartedAtRef.current = null;
        stopPolling();
        setPending(null);
      }
      void refresh().then((next) => {
        if (!next) return;
        if (next.loggedIn) {
          stopPolling();
          loginStartedAtRef.current = null;
          setPending(null);
          setErrorMessage(null);
          return;
        }
        if (next.loginInFlight) {
          setErrorMessage(null);
          setPending('login');
          startPolling();
          return;
        }
        const pendingStartup =
          loginStartedAtRef.current !== null &&
          Date.now() - loginStartedAtRef.current < AMR_LOGIN_STARTUP_SETTLE_MS;
        if (!pendingStartup) {
          loginStartedAtRef.current = null;
          setPending(null);
        }
      });
    };
    window.addEventListener(AMR_LOGIN_STATUS_EVENT, onStatusChange);
    return () => {
      window.removeEventListener(AMR_LOGIN_STATUS_EVENT, onStatusChange);
    };
  }, [refresh, startPolling, stopPolling]);

  const handleLogin = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const startedAt = Date.now();
      loginStartedAtRef.current = startedAt;
      setErrorMessage(null);
      setPending('login');
      const result = await startVelaLogin();
      if (!result.ok && !result.alreadyRunning) {
        loginStartedAtRef.current = null;
        setPending(null);
        setErrorMessage(result.error || t('settings.amrLoginErrorCompact'));
        return;
      }
      notifyAmrLoginStatusChanged('login-started');
      startPolling(startedAt);
    },
    [startPolling, t],
  );

  const handleLogout = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setErrorMessage(null);
      setPending('logout');
      const result = await velaLogout();
      loginStartedAtRef.current = null;
      setPending(null);
      if (!result.ok) {
        setErrorMessage(t('settings.amrLoginErrorCompact'));
        return;
      }
      await refresh();
      notifyAmrLoginStatusChanged('status-changed');
    },
    [refresh, t],
  );

  const loggedIn = status?.loggedIn === true;
  const userEmail = status?.user?.email ?? '';
  const loginInFlight =
    pending === 'login' || (status?.loggedIn !== true && status?.loginInFlight === true);
  const logoutInFlight = pending === 'logout';
  const accountStatus: AmrAccountControlStatus = errorMessage
    ? 'error'
    : loggedIn
      ? 'signed-in'
      : loginInFlight
        ? 'signing-in'
        : 'signed-out';

  return (
    <div
      className={'amr-login-pill' + (className ? ' ' + className : '')}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <AmrAccountControl
        status={accountStatus}
        compact
        email={userEmail}
        profile={status?.profile}
        showProfileBadge
        hideSignedOutStatus={hideSignedOutStatus}
        signInDisabled={loginInFlight}
        signOutDisabled={logoutInFlight}
        onSignIn={handleLogin}
        onSignOut={handleLogout}
        className={loggedIn ? 'amr-login-pill-status' : undefined}
      />
    </div>
  );
}
