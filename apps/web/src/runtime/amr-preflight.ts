import { BUILT_IN_DAEMON_AGENT_IDS } from '@open-design/contracts';
import type { Dict } from '../i18n/types';
import type { AgentInfo, AppConfig } from '../types';

export type AmrSendPreflightIssueKind =
  | 'byok-incomplete'
  | 'agent-unselected'
  | 'agent-unavailable'
  | 'agent-auth-missing'
  | 'model-unavailable';

export type AmrByokField = 'apiKey' | 'baseUrl' | 'model';

export interface AmrSendPreflightIssue {
  kind: AmrSendPreflightIssueKind;
  agentId?: string | null;
  /** Set for `byok-incomplete`: the exact BYOK fields the user still has to fill in. */
  missingByokFields?: AmrByokField[];
}

export interface ResolveAmrSendPreflightOptions {
  agentsLoading?: boolean;
  /** True only after the agent registry request completes successfully. */
  agentsProbeSucceeded?: boolean;
}

const BUILT_IN_DAEMON_AGENT_ID_SET = new Set<string>(BUILT_IN_DAEMON_AGENT_IDS);

export function resolveAmrSendPreflightIssue(
  config: AppConfig | undefined,
  agents: readonly AgentInfo[] | undefined,
  options: ResolveAmrSendPreflightOptions = {},
): AmrSendPreflightIssue | null {
  if (!config) return null;

  if (config.mode === 'api') {
    const missingByokFields: AmrByokField[] = [];
    if (!config.apiKey.trim()) missingByokFields.push('apiKey');
    if (!config.baseUrl.trim()) missingByokFields.push('baseUrl');
    if (!config.model.trim()) missingByokFields.push('model');
    if (missingByokFields.length > 0) {
      return { kind: 'byok-incomplete', missingByokFields };
    }
    return null;
  }

  if (config.mode !== 'daemon') return null;

  const agentId = config.agentId;
  if (!agentId) return { kind: 'agent-unselected' };
  if (agentId === 'amr') return null;

  const selectedAgent = agents?.find((agent) => agent.id === agentId);
  if (!selectedAgent) {
    if (options.agentsLoading || !options.agentsProbeSucceeded) return null;
    if (BUILT_IN_DAEMON_AGENT_ID_SET.has(agentId)) {
      return { kind: 'agent-unavailable', agentId };
    }
    return null;
  }

  if (selectedAgent.authStatus === 'missing') {
    return { kind: 'agent-auth-missing', agentId };
  }

  if (!selectedAgent.available || hasBlockingAgentDiagnostic(selectedAgent)) {
    const authMissing = selectedAgent.diagnostics?.some(
      (diagnostic) => diagnostic.reason === 'auth-missing',
    );
    return {
      kind: authMissing ? 'agent-auth-missing' : 'agent-unavailable',
      agentId,
    };
  }

  const selectedModel = config.agentModels?.[agentId]?.model?.trim();
  if (
    selectedModel
    && selectedModel !== 'default'
    && selectedAgent.supportsCustomModel === false
    && Array.isArray(selectedAgent.models)
    && selectedAgent.models.length > 0
    && !selectedAgent.models.some((model) => model.id === selectedModel)
  ) {
    return { kind: 'model-unavailable', agentId };
  }

  return null;
}

// Shared by the preflight dialog and the avatar popover warning so both
// surfaces name the exact missing BYOK fields with identical wording.
export const BYOK_FIELD_LABEL_KEYS: Record<AmrByokField, keyof Dict> = {
  apiKey: 'settings.apiKey',
  baseUrl: 'settings.baseUrl',
  model: 'avatar.modelLabel',
};

export function formatByokFieldList(locale: string, labels: string[]): string {
  try {
    return new Intl.ListFormat(locale, {
      style: 'narrow',
      type: 'conjunction',
    }).format(labels);
  } catch {
    return labels.join(', ');
  }
}

function hasBlockingAgentDiagnostic(agent: AgentInfo): boolean {
  return (agent.diagnostics ?? []).some((diagnostic) =>
    diagnostic.severity === 'error'
    || diagnostic.reason === 'not-on-path'
    || diagnostic.reason === 'not-executable'
    || diagnostic.reason === 'shim-broken'
    || diagnostic.reason === 'configured-bin-invalid'
    || diagnostic.reason === 'auth-missing',
  );
}
