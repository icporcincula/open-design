import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig, SkillSummary } from '../types';
import { useAnalytics } from '../analytics/provider';
import {
  trackIntegrationsConnectorsTabClick,
  trackIntegrationsTabClick,
  trackPageView,
  trackSettingsConnectorAuthResult,
} from '../analytics/events';
import { ConnectorSection } from './SettingsDialog';
import { Icon } from './Icon';
import { McpClientSection } from './McpClientSection';
import { SkillsSection } from './SkillsSection';
import { UseEverywhereGuidePanel } from './UseEverywhereModal';
import { useT } from '../i18n';

export type IntegrationTab = 'mcp' | 'connectors' | 'skills' | 'use-everywhere';

interface Props {
  config: AppConfig;
  initialTab?: IntegrationTab;
  composioConfigLoading?: boolean;
  onConfigChange: (next: AppConfig) => Promise<void> | void;
  onPersistComposioKey: (composio: AppConfig['composio']) => Promise<void> | void;
  onSkillsChange?: (skills: SkillSummary[]) => void;
}

const INTEGRATION_TABS: ReadonlyArray<{
  id: IntegrationTab;
}> = [
  { id: 'mcp' },
  { id: 'connectors' },
  { id: 'skills' },
  { id: 'use-everywhere' },
];

function integrationTabToTrackingElement(
  id: IntegrationTab,
): 'mcp' | 'connectors' | 'skills' | 'use_everywhere' {
  if (id === 'use-everywhere') return 'use_everywhere';
  return id;
}

export function IntegrationsView({
  config,
  initialTab = 'mcp',
  composioConfigLoading = false,
  onConfigChange,
  onPersistComposioKey,
  onSkillsChange,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const integrationsPageViewFiredRef = useRef(false);
  useEffect(() => {
    if (integrationsPageViewFiredRef.current) return;
    integrationsPageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'integrations' });
  }, [analytics.track]);
  const [activeTab, setActiveTab] = useState<IntegrationTab>(initialTab);
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const configRef = useRef<AppConfig>(config);
  const localConfigRef = useRef<AppConfig>(config);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    configRef.current = config;
    setLocalConfig((curr) => ({
      ...curr,
      composio: config.composio,
      disabledSkills: config.disabledSkills,
    }));
    localConfigRef.current = {
      ...localConfigRef.current,
      composio: config.composio,
      disabledSkills: config.disabledSkills,
    };
  }, [config.composio, config.disabledSkills]);

  useEffect(() => {
    localConfigRef.current = localConfig;
  }, [localConfig]);

  const setAndPersistConfig = useCallback<Dispatch<SetStateAction<AppConfig>>>(
    (action) => {
      const prev = localConfigRef.current;
      const next =
        typeof action === 'function'
          ? (action as (current: AppConfig) => AppConfig)(prev)
          : action;
      localConfigRef.current = next;
      setLocalConfig(next);
      void onConfigChange({
        ...configRef.current,
        disabledSkills: next.disabledSkills,
      });
    },
    [onConfigChange],
  );

  const liveDaemonUrl =
    typeof window !== 'undefined' ? window.location.origin : undefined;

  return (
    <section className="integrations-view" aria-labelledby="integrations-title">
      <header className="integrations-view__hero">
        <div>
          <p className="integrations-view__kicker">{t('integrations.kicker')}</p>
          <h1 id="integrations-title" className="entry-section__title">
            {t('entry.navIntegrations')}
          </h1>
          <p className="integrations-view__lede">
            {t('integrations.lede')}
          </p>
        </div>
        <div className="integrations-view__badge" aria-hidden="true">
          <Icon name="link" size={15} />
          <span>{t('integrations.agentReady')}</span>
        </div>
      </header>

      <nav
        className="integrations-view__tabs"
        role="tablist"
        aria-label={t('integrations.areasAria')}
      >
        {INTEGRATION_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`integrations-view__tab${active ? ' is-active' : ''}`}
              onClick={() => {
                trackIntegrationsTabClick(analytics.track, {
                  page_name: 'integrations',
                  area: 'integrations_tab',
                  element: integrationTabToTrackingElement(tab.id),
                });
                setActiveTab(tab.id);
              }}
              data-testid={`integrations-tab-${tab.id}`}
            >
              <span className="integrations-view__tab-label">{integrationTabLabel(tab.id, t)}</span>
              <span className="integrations-view__tab-hint">{integrationTabHint(tab.id, t)}</span>
            </button>
          );
        })}
      </nav>

      <div className="integrations-view__panel">
        {activeTab === 'mcp' ? <McpClientSection /> : null}

        {activeTab === 'connectors' ? (
          <ConnectorSection
            cfg={localConfig}
            setCfg={setLocalConfig}
            composioConfigLoading={composioConfigLoading}
            onPersistComposioKey={onPersistComposioKey}
            onConnectorsTabClick={(element) =>
              trackIntegrationsConnectorsTabClick(analytics.track, {
                page_name: 'integrations',
                area: 'connectors_tab',
                element,
              })
            }
            onConnectorAuthResult={({ connectorId, action, result, errorCode }) =>
              trackSettingsConnectorAuthResult(analytics.track, {
                page: 'settings',
                area: 'connectors',
                connector_id: connectorId,
                action,
                result,
                ...(errorCode ? { error_code: errorCode } : {}),
              })
            }
          />
        ) : null}

        {activeTab === 'skills' ? (
          <SkillsSection
            cfg={localConfig}
            setCfg={setAndPersistConfig}
            onSkillsChange={onSkillsChange}
          />
        ) : null}

        {activeTab === 'use-everywhere' ? (
          <div className="integrations-view__use-everywhere">
            <UseEverywhereGuidePanel
              onOpenSettings={() => setActiveTab('mcp')}
              {...(liveDaemonUrl ? { daemonUrl: liveDaemonUrl } : {})}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function integrationTabLabel(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return 'MCP';
    case 'connectors': return t('entry.tabConnectors');
    case 'skills': return t('homeHero.skills');
    case 'use-everywhere': return t('entry.useEverywhereTitle');
  }
}

function integrationTabHint(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return t('integrations.tabHint.mcp');
    case 'connectors': return t('integrations.tabHint.connectors');
    case 'skills': return 'Project skills';
    case 'use-everywhere': return 'CLI, HTTP, MCP';
  }
}
