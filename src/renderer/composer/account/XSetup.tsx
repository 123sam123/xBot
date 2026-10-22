import { useState } from 'react';
import { CLIENT_ID_PATTERN } from '../../../shared/xRules';
import { setSetting, useSettings } from '../../common/useSettings';
import { ArrowUpRightIcon, FrostedButton, GhostButton, NumberField, StatusChip, TextField } from '../../design-system';
import { activeAccount } from './accountMenu';
import { connectX, useXState } from './useXState';

type Outcome = { tone: 'neutral' | 'warning'; text: string } | null;

export function XSetup({ variant }: { variant: 'settings' | 'onboarding' }) {
  const { values } = useSettings();
  const { state } = useXState(true);
  const savedClientId = values?.['x.clientId'] ?? '';
  const savedPort = values?.['x.callbackPort'];
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientIdError, setClientIdError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const commitClientId = (raw: string) => {
    const value = raw.trim();
    if (value === savedClientId) return setClientIdError(null);
    if (value !== '' && !CLIENT_ID_PATTERN.test(value)) {
      setClientIdError("That doesn't look like an OAuth 2.0 Client ID. Copy it from the app's Keys and tokens page.");
      return;
    }
    setClientIdError(null);
    setClientId(null);
    setSetting('x.clientId', value);
  };

  const connect = async (reconnectAccountId?: string) => {
    setOutcome(null);
    setOutcome(await connectX(reconnectAccountId));
  };

  const disconnect = async (accountId: string) => {
    const result = await window.xbot.x.disconnect(accountId);
    setOutcome(result.ok ? { tone: 'neutral', text: 'Disconnected. Its tokens were removed from this Mac.' } : { tone: 'warning', text: result.error.message });
  };

  const active = activeAccount(state);
  const connecting = state?.connecting ?? false;
  const canConnect = savedClientId !== '' && !connecting;
  const hasAccounts = state && state.accounts.length > 0;

  if (variant === 'settings') {
    return (
      <div className="x-setup" data-testid="x-setup-settings">
        {hasAccounts && (
          <ul className="x-setup-accounts" aria-label="Connected X accounts">
            {state.accounts.map((a) => (
              <li key={a.id} className="x-setup-account">
                <span className="x-setup-handle">
                  @{a.handle}
                  {a.active && <span className="badge">Posting</span>}
                  {a.reconnectRequired && <span className="badge badge-warning">Reconnect</span>}
                </span>
                {a.reconnectRequired && <GhostButton onClick={() => void connect(a.id)}>Reconnect</GhostButton>}
                <GhostButton onClick={() => void disconnect(a.id)}>Disconnect</GhostButton>
              </li>
            ))}
          </ul>
        )}

        <div className="x-setup-actions">
          {connecting ? (
            <>
              <StatusChip>Waiting for X in your browser...</StatusChip>
              <GhostButton onClick={() => void window.xbot.x.cancelConnect()}>Cancel</GhostButton>
            </>
          ) : (
            <FrostedButton disabled={!canConnect} onClick={() => void connect()} data-testid="x-connect">
              {active ? 'Connect another account' : 'Connect X account'}
            </FrostedButton>
          )}
        </div>

        {outcome && (
          <StatusChip tone={outcome.tone} className="publish-outcome">
            {outcome.text}
          </StatusChip>
        )}

        <details className="x-setup-details">
          <summary className="x-setup-summary">Developer app setup</summary>
          <p className="x-setup-text">
            Post straight to X with your own X developer app. X API usage may be billed to your own X developer account, separately from
            xBot{"'"}s free local AI. You can always copy the text and post it yourself instead.
          </p>
          <ol className="x-setup-steps">
            <li>
              Create an app in the{' '}
              <a href="https://console.x.com" target="_blank" rel="noreferrer">
                X Developer Console
                <ArrowUpRightIcon size={13} />
              </a>
              .
            </li>
            <li>In its User authentication settings, choose OAuth 2.0, type &quot;Native App&quot;, permissions &quot;Read and write&quot;.</li>
            <li>
              <TextField
                label="Register this callback URL"
                value={state?.callbackUrl ?? ''}
                onChange={() => {}}
                stacked
                readOnly
                selectOnFocus
                code
                description="Exactly as shown. Select it and press ⌘C."
                testId="x-callback-url"
              />
            </li>
            <li>
              <TextField
                label="Paste the app's OAuth 2.0 Client ID"
                stacked
                value={clientId ?? savedClientId}
                onChange={setClientId}
                onCommit={commitClientId}
                placeholder="e.g. M1M5R3BMVy13QmpScXkzTUt5OE46MTpjaQ"
                error={clientIdError}
                description="Not a secret: Native Apps have no Client Secret, and xBot never asks for one."
                code
                testId="x-client-id"
              />
            </li>
          </ol>

          {savedPort !== undefined && (
            <div className="x-setup-port">
              <NumberField label="Callback port" value={savedPort} min={1024} max={65535} onChange={(port) => setSetting('x.callbackPort', port)} testId="x-callback-port" />
              <p className="x-setup-note">Change it only if another app uses this port, and register the new callback URL too.</p>
            </div>
          )}
        </details>
      </div>
    );
  }

  return (
    <div className="x-setup" data-testid="x-setup-onboarding">
      <p className="x-setup-text">
        Post straight to X with your own X developer app. X API usage may be billed to your own X developer account, separately from
        xBot{"'"}s free local AI. You can always copy the text and post it yourself instead.
      </p>
      <ol className="x-setup-steps">
        <li>
          Create an app in the{' '}
          <a href="https://console.x.com" target="_blank" rel="noreferrer">
            X Developer Console
            <ArrowUpRightIcon size={13} />
          </a>
          .
        </li>
        <li>In its User authentication settings, choose OAuth 2.0, type &quot;Native App&quot;, permissions &quot;Read and write&quot;.</li>
        <li>
          <TextField
            label="Register this callback URL"
            value={state?.callbackUrl ?? ''}
            onChange={() => {}}
            stacked
            readOnly
            selectOnFocus
            code
            description="Exactly as shown. Select it and press ⌘C."
            testId="x-callback-url"
          />
        </li>
        <li>
          <TextField
            label="Paste the app's OAuth 2.0 Client ID"
            stacked
            value={clientId ?? savedClientId}
            onChange={setClientId}
            onCommit={commitClientId}
            placeholder="e.g. M1M5R3BMVy13QmpScXkzTUt5OE46MTpjaQ"
            error={clientIdError}
            description="Not a secret: Native Apps have no Client Secret, and xBot never asks for one."
            code
            testId="x-client-id"
          />
        </li>
      </ol>
      <div className="x-setup-actions">
        {connecting ? (
          <>
            <StatusChip>Waiting for X in your browser...</StatusChip>
            <GhostButton onClick={() => void window.xbot.x.cancelConnect()}>Cancel</GhostButton>
          </>
        ) : (
          <FrostedButton disabled={!canConnect} onClick={() => void connect()} data-testid="x-connect">
            {active ? 'Connect another account' : 'Connect X account'}
          </FrostedButton>
        )}
        {active && !connecting && <StatusChip>Connected as @{active.handle}</StatusChip>}
      </div>
      {outcome && (
        <StatusChip tone={outcome.tone} className="publish-outcome">
          {outcome.text}
        </StatusChip>
      )}
    </div>
  );
}
