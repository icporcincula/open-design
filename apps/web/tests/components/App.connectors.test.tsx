// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import {
  fetchDaemonConfig,
  fetchComposioConfigFromDaemon,
  loadConfig,
  mergeDaemonConfig,
  saveConfig,
  syncComposioConfigToDaemon,
  syncConfigToDaemon,
} from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgents,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { listProjects, listTemplates } from '../../src/state/projects';

const useRouteMock = vi.fn(() => ({ kind: 'home' as const, view: 'home' as const }));

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
  useRoute: () => useRouteMock(),
}));

vi.mock('../../src/components/EntryView', () => ({
  EntryView: ({
    config,
    currentWorkspaceId,
    onOpenSettings,
    onWorkspaceChange,
    onProjectsRefresh,
    onPersistComposioKey,
    projectsLoading,
  }: {
    config: AppConfig;
    currentWorkspaceId: string;
    onOpenSettings: (section?: 'composio') => void;
    onWorkspaceChange: (workspaceId: string) => Promise<void>;
    onProjectsRefresh: () => Promise<void>;
    onPersistComposioKey: (composio: AppConfig['composio']) => void;
    projectsLoading?: boolean;
  }) => (
    <div>
      <div>Current workspace: {currentWorkspaceId}</div>
      <div>Projects loading: {projectsLoading ? 'loading' : 'idle'}</div>
      <button type="button" onClick={() => { void onWorkspaceChange('team-ws').catch(() => {}); }}>
        Switch team workspace
      </button>
      <button type="button" onClick={() => { void onProjectsRefresh().catch(() => {}); }}>
        Refresh projects
      </button>
      <button type="button" onClick={() => onOpenSettings('composio')}>
        Open connectors settings
      </button>
      <button type="button" onClick={() => onOpenSettings()}>
        Open execution settings
      </button>
      <div>Composio tail: {config.composio?.apiKeyTail ?? 'none'}</div>
      <button
        type="button"
        onClick={() =>
          onPersistComposioKey({
            apiKey: 'cmp_secret_replacement',
            apiKeyConfigured: true,
            apiKeyTail: config.composio?.apiKeyTail ?? '',
          })
        }
      >
        Save connectors key
      </button>
      <button
        type="button"
        onClick={() =>
          onPersistComposioKey({
            apiKey: '',
            apiKeyConfigured: false,
            apiKeyTail: '',
          })
        }
      >
        Clear connectors key
      </button>
    </div>
  ),
}));

vi.mock('../../src/components/ProjectView', () => ({
  ProjectView: () => <div>Project view</div>,
}));

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));

vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/SettingsDialog', () => ({
  SettingsDialog: ({
    initial,
    initialSection,
    onPersistComposioKey,
  }: {
    initial: AppConfig;
    initialSection?: string;
    onPersistComposioKey: (composio: AppConfig['composio']) => void;
  }) => (
    <div role="dialog" aria-label="Settings dialog">
      <div>Section: {initialSection}</div>
      <div>Composio tail: {initial.composio?.apiKeyTail ?? 'none'}</div>
      <button
        type="button"
        onClick={() =>
          onPersistComposioKey({
            apiKey: 'cmp_secret_replacement',
            apiKeyConfigured: true,
            apiKeyTail: initial.composio?.apiKeyTail ?? '',
          })
        }
      >
        Save connectors key
      </button>
      <button
        type="button"
        onClick={() =>
          onPersistComposioKey({
            apiKey: '',
            apiKeyConfigured: false,
            apiKeyTail: '',
          })
        }
      >
        Clear connectors key
      </button>
    </div>
  ),
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgents: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    listProjects: vi.fn(),
    listTemplates: vi.fn(),
  };
});

vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    loadConfig: vi.fn(),
    mergeDaemonConfig: vi.fn(),
    saveConfig: vi.fn(),
    fetchDaemonConfig: vi.fn().mockResolvedValue({}),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgents = vi.mocked(fetchAgents);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);
const mockedFetchComposioConfigFromDaemon = vi.mocked(fetchComposioConfigFromDaemon);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedMergeDaemonConfig = vi.mocked(mergeDaemonConfig);
const mockedSaveConfig = vi.mocked(saveConfig);
const mockedSyncConfigToDaemon = vi.mocked(syncConfigToDaemon);
const mockedSyncComposioConfigToDaemon = vi.mocked(syncComposioConfigToDaemon);

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  composio: {},
  agentModels: {},
  agentCliEnv: {},
};

describe('App connectors settings flows', () => {
  beforeEach(() => {
    mockedDaemonIsLive.mockResolvedValue(true);
    mockedFetchAgents.mockResolvedValue([]);
    mockedFetchSkills.mockResolvedValue([]);
    mockedFetchDesignSystems.mockResolvedValue([]);
    mockedFetchPromptTemplates.mockResolvedValue([]);
    mockedFetchAppVersionInfo.mockResolvedValue(null);
    mockedListProjects.mockResolvedValue([]);
    mockedListTemplates.mockResolvedValue([]);
    mockedFetchDaemonConfig.mockResolvedValue({});
    mockedFetchComposioConfigFromDaemon.mockResolvedValue(null);
    mockedMergeDaemonConfig.mockImplementation((local) => local);
    mockedLoadConfig.mockReturnValue({ ...baseConfig });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === '/api/workspaces') {
          return new Response(JSON.stringify({
            workspaces: [{
              id: 'local-personal',
              name: 'Personal Workspace',
              kind: 'local',
              currentUserRole: 'owner',
              createdAt: 1,
              updatedAt: 1,
            }],
            currentWorkspaceId: 'local-personal',
            currentUserId: 'local-user',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('hydrates a daemon-saved Composio key into settings when local state does not have a pending edit', async () => {
    mockedFetchComposioConfigFromDaemon.mockResolvedValue({
      apiKey: '',
      apiKeyConfigured: true,
      apiKeyTail: 'uQEg',
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Composio tail: uQEg')).toBeTruthy();
    });
  });

  it('shows a retryable workspace load failure instead of anonymous workspace state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === '/api/workspaces') {
          return new Response(JSON.stringify({
            error: { message: 'workspace store unavailable' },
          }), { status: 500 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<App />);

    expect(await screen.findByText('Could not load workspaces')).toBeTruthy();
    expect(screen.getByText('workspace store unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows a retryable workspace load failure when scoped project loading fails', async () => {
    mockedListProjects.mockRejectedValueOnce(new Error('project index unavailable'));

    render(<App />);

    expect(await screen.findByText('Could not load workspaces')).toBeTruthy();
    expect(screen.getByText('project index unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await waitFor(() => {
      expect(mockedListProjects).toHaveBeenCalledWith('local-personal');
      expect(mockedListTemplates).toHaveBeenCalledWith('local-personal');
    });
  });

  it('clears project loading after a later scoped project refresh fails', async () => {
    render(<App />);

    expect(await screen.findByText('Projects loading: idle')).toBeTruthy();

    mockedListProjects.mockRejectedValueOnce(new Error('project refresh unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh projects' }));

    await waitFor(() => {
      expect(mockedListProjects).toHaveBeenLastCalledWith('local-personal');
    });
    await waitFor(() => {
      expect(screen.getByText('Projects loading: idle')).toBeTruthy();
    });
  });

  it('keeps workspace selection atomic when switch-scoped project loading fails', async () => {
    const workspaceResponse = {
      workspaces: [
        {
          id: 'local-personal',
          name: 'Personal Workspace',
          kind: 'local',
          currentUserRole: 'owner',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'team-ws',
          name: 'Team Workspace',
          kind: 'team',
          currentUserRole: 'admin',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      currentWorkspaceId: 'local-personal',
      currentUserId: 'local-user',
    };
    const workspaceSwitches: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url === '/api/workspaces' && (!init || init.method == null || init.method === 'GET')) {
          return new Response(JSON.stringify(workspaceResponse), { status: 200 });
        }
        if (url === '/api/workspaces/current') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { workspaceId?: string };
          workspaceSwitches.push(body.workspaceId ?? '');
          return new Response(JSON.stringify({
            ...workspaceResponse,
            currentWorkspaceId: body.workspaceId ?? 'local-personal',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<App />);

    expect(await screen.findByText('Current workspace: local-personal')).toBeTruthy();

    mockedListProjects.mockRejectedValueOnce(new Error('team projects unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch team workspace' }));

    await waitFor(() => {
      expect(mockedListProjects).toHaveBeenLastCalledWith('team-ws');
    });
    await waitFor(() => {
      expect(screen.getByText('Current workspace: local-personal')).toBeTruthy();
      expect(screen.getByText('Projects loading: idle')).toBeTruthy();
      expect(screen.getByText('team projects unavailable')).toBeTruthy();
    });
    expect(workspaceSwitches).toEqual(['team-ws', 'local-personal']);
  });

  it('does not show first-run privacy consent until daemon config hydration finishes', async () => {
    let resolveDaemonConfig: (value: Record<string, never>) => void = () => {};
    mockedFetchDaemonConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveDaemonConfig = resolve;
      }),
    );

    const { container } = render(<App />);

    await waitFor(() => {
      expect(mockedFetchDaemonConfig).toHaveBeenCalled();
    });
    expect(container.querySelector('.privacy-consent-banner')).toBeNull();

    resolveDaemonConfig({});

    await waitFor(() => {
      expect(container.querySelector('.privacy-consent-banner')).toBeTruthy();
    });
    const banner = container.querySelector('.privacy-consent-banner');
    expect(banner?.querySelector('.seg-control')).toBeNull();
    expect(banner?.querySelector('.seg-btn.active')).toBeNull();
    expect(screen.getByRole('button', { name: 'I get it' }).className).toContain(
      'privacy-consent-action',
    );
  });

  it('keeps the first-run privacy banner mounted while settings is open', async () => {
    // The banner and Settings have independent lifecycles. The banner's
    // z-index in index.css sits above the modal backdrop, so opening
    // Settings (or any other modal) must not unmount the banner — the
    // user has to be able to acknowledge the disclosure from any view.
    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelector('.privacy-consent-banner')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open execution settings' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Settings dialog' })).toBeTruthy();
    });
    expect(container.querySelector('.privacy-consent-banner')).toBeTruthy();
  });

  it('withholds the privacy banner until onboarding completes', async () => {
    // First-run users should land on the welcome panel without the
    // privacy disclosure layered on top. The banner appears only after
    // onboardingCompleted flips to true (Skip and finish both flip it).
    mockedLoadConfig.mockReturnValue({ ...baseConfig, onboardingCompleted: false });
    mockedFetchDaemonConfig.mockResolvedValue({ onboardingCompleted: false });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(mockedFetchDaemonConfig).toHaveBeenCalled();
    });
    // Give the bootstrap microtasks a turn to settle; banner must still
    // be absent because onboardingCompleted is false.
    await waitFor(() => {
      expect(container.querySelector('.privacy-consent-banner')).toBeNull();
    });
  });

  it('shows the privacy banner on non-home routes once onboarding completes', async () => {
    // The design-system finish path drops the user into a project view
    // (the first generation runs there). Product wants the disclosure to
    // appear in that view too — the user is already waiting for output,
    // so there is no benefit to delaying the banner until they navigate
    // back to home.
    useRouteMock.mockReturnValue({
      kind: 'project',
      projectId: 'proj-1',
      conversationId: null,
      fileName: null,
    } as never);

    try {
      const { container } = render(<App />);

      await waitFor(() => {
        expect(container.querySelector('.privacy-consent-banner')).toBeTruthy();
      });
    } finally {
      useRouteMock.mockReturnValue({
        kind: 'home' as const,
        view: 'home' as const,
      } as never);
    }
  });

  it('normalizes local persistence but sends the raw replacement key to the daemon on save', async () => {
    mockedLoadConfig.mockReturnValue({
      ...baseConfig,
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: 'uQEg',
      },
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save connectors key' }));

    await waitFor(() => {
      expect(mockedSyncComposioConfigToDaemon).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'cmp_secret_replacement',
          apiKeyConfigured: true,
        }),
      );
    });

    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingCompleted: true,
        composio: {
          apiKey: '',
          apiKeyConfigured: true,
          apiKeyTail: 'ment',
        },
      }),
    );
    expect(mockedSyncConfigToDaemon).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingCompleted: true,
      }),
    );
    expect(mockedSaveConfig.mock.calls.at(-1)?.[0]).toMatchObject({
      onboardingCompleted: true,
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: 'ment',
      },
    });
  });

  it('sends a cleared Composio config to the daemon when the saved key is removed', async () => {
    mockedLoadConfig.mockReturnValue({
      ...baseConfig,
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: 'uQEg',
      },
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear connectors key' }));

    await waitFor(() => {
      expect(mockedSyncComposioConfigToDaemon).toHaveBeenCalledWith({
        apiKey: '',
        apiKeyConfigured: false,
        apiKeyTail: '',
      });
    });

    expect(mockedSaveConfig.mock.calls.at(-1)?.[0]).toMatchObject({
      composio: {
        apiKey: '',
        apiKeyConfigured: false,
        apiKeyTail: '',
      },
    });
  });
});
