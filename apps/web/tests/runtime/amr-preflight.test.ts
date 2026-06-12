import { describe, expect, it } from 'vitest';
import { BUILT_IN_DAEMON_AGENT_IDS } from '@open-design/contracts';

import { resolveAmrSendPreflightIssue } from '../../src/runtime/amr-preflight';
import type { AgentInfo, AppConfig } from '../../src/types';

const baseConfig: AppConfig = {
  mode: 'daemon',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.test',
  model: 'gpt-test',
  agentId: 'claude',
  skillId: null,
  designSystemId: null,
};

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    available: true,
    authStatus: 'ok',
    ...overrides,
  };
}

const NON_AMR_BUILT_IN_AGENT_IDS = BUILT_IN_DAEMON_AGENT_IDS.filter((id) => id !== 'amr');

describe('resolveAmrSendPreflightIssue', () => {
  it('blocks incomplete BYOK config before a run is submitted', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          mode: 'api',
          apiKey: '',
        },
        [agent()],
      ),
    ).toEqual({ kind: 'byok-incomplete', missingByokFields: ['apiKey'] });
  });

  it('reports every missing BYOK field', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          mode: 'api',
          apiKey: ' ',
          baseUrl: '',
          model: '',
        },
        [agent()],
      ),
    ).toEqual({
      kind: 'byok-incomplete',
      missingByokFields: ['apiKey', 'baseUrl', 'model'],
    });
  });

  it('does not block a healthy local agent', () => {
    expect(resolveAmrSendPreflightIssue(baseConfig, [agent()])).toBeNull();
  });

  it('does not treat a loading empty agent probe as confirmed unavailable', () => {
    expect(
      resolveAmrSendPreflightIssue(baseConfig, [], { agentsLoading: true }),
    ).toBeNull();
  });

  it('does not treat a failed agent probe as confirmed unavailable', () => {
    expect(
      resolveAmrSendPreflightIssue(baseConfig, [], {
        agentsLoading: false,
        agentsProbeSucceeded: false,
      }),
    ).toBeNull();
  });

  it('blocks a missing built-in local agent after the agent probe has settled', () => {
    expect(
      resolveAmrSendPreflightIssue(baseConfig, [], {
        agentsProbeSucceeded: true,
      }),
    ).toEqual({
      kind: 'agent-unavailable',
      agentId: 'claude',
    });
    expect(
      resolveAmrSendPreflightIssue(baseConfig, [agent({ id: 'codex' })], {
        agentsProbeSucceeded: true,
      }),
    ).toEqual({ kind: 'agent-unavailable', agentId: 'claude' });
  });

  it.each(NON_AMR_BUILT_IN_AGENT_IDS)(
    'blocks missing built-in local agent %s after the agent probe has settled',
    (agentId) => {
      expect(
        resolveAmrSendPreflightIssue(
          {
            ...baseConfig,
            agentId,
          },
          [],
          { agentsProbeSucceeded: true },
        ),
      ).toEqual({ kind: 'agent-unavailable', agentId });
    },
  );

  it('does not treat an absent custom agent entry as confirmed unavailable', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          agentId: 'mock-agent',
        },
        [agent()],
        { agentsProbeSucceeded: true },
      ),
    ).toBeNull();
  });

  it('blocks when no local agent is selected', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          agentId: null,
        },
        [agent()],
      ),
    ).toEqual({ kind: 'agent-unselected' });
  });

  it('blocks unavailable or unauthenticated local agents', () => {
    expect(
      resolveAmrSendPreflightIssue(baseConfig, [
        agent({
          available: false,
          diagnostics: [{ reason: 'not-on-path', severity: 'error', message: 'Missing CLI' }],
        }),
      ]),
    ).toEqual({ kind: 'agent-unavailable', agentId: 'claude' });

    expect(
      resolveAmrSendPreflightIssue(baseConfig, [
        agent({
          authStatus: 'missing',
          diagnostics: [{ reason: 'auth-missing', severity: 'error', message: 'Sign in' }],
        }),
      ]),
    ).toEqual({ kind: 'agent-auth-missing', agentId: 'claude' });
  });

  it('blocks fixed-model agents when the selected model is no longer available', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          agentModels: { claude: { model: 'claude-opus-missing' } },
        },
        [
          agent({
            supportsCustomModel: false,
            models: [{ id: 'claude-sonnet', label: 'Claude Sonnet' }],
          }),
        ],
      ),
    ).toEqual({ kind: 'model-unavailable', agentId: 'claude' });
  });

  it('lets AMR itself fall through to the existing AMR auth and balance handling', () => {
    expect(
      resolveAmrSendPreflightIssue(
        {
          ...baseConfig,
          agentId: 'amr',
        },
        [agent({ id: 'amr', available: false, authStatus: 'missing' })],
      ),
    ).toBeNull();
  });
});
