// @vitest-environment jsdom

// Static prompt-example cards must show the Send cue too.
//
// When a chip has no example plugins, HomeHero falls back to static
// prompt-example cards (`home-hero-prompt-example`) handled entirely
// inside the component. Seeding the composer through that path must
// trigger the same send-button attention sheen as the HomeView-routed
// plugin Use / preset flows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

const WEB_PROTOTYPE_PLUGIN = {
  id: 'example-web-prototype',
  title: 'Web Prototype',
  version: '0.1.0',
  trust: 'bundled' as const,
  sourceKind: 'bundled' as const,
  source: '/tmp/web-prototype',
  capabilitiesGranted: ['prompt:inject'],
  fsPath: '/tmp/web-prototype',
  installedAt: 0,
  updatedAt: 0,
  manifest: {
    name: 'example-web-prototype',
    title: 'Web Prototype',
    version: '0.1.0',
    description: 'General-purpose desktop web prototype.',
    od: { kind: 'scenario', taskKind: 'new-generation' },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
});

describe('static prompt-example send pulse', () => {
  it('pulses the send button after clicking a fallback prompt-example card', async () => {
    // Keep the first-run guide quiet so the sheen we assert on is the
    // send button's, not the guide trail's.
    writeHomeGuideStage('done');
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (typeof url === 'string' && url === '/api/plugins') {
        return new Response(JSON.stringify({ plugins: [WEB_PROTOTYPE_PLUGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    render(
      <I18nProvider initial="en">
        <HomeView
          projects={[]}
          onSubmit={() => undefined}
          onOpenProject={() => undefined}
          onViewAllProjects={() => undefined}
        />
      </I18nProvider>,
    );

    // The chip's default plugin exists (so the chip binds) but no plugin
    // matches the example filter → fallback static prompt-example cards.
    fireEvent.click(await screen.findByTestId('home-hero-rail-prototype'));
    const exampleCards = await screen.findAllByTestId('home-hero-prompt-example');
    expect(exampleCards.length).toBeGreaterThan(0);

    const submit = screen.getByTestId('home-hero-submit');
    expect(submit.className).not.toContain('home-hero__attention-sheen');

    fireEvent.click(exampleCards[0]);
    await waitFor(() => {
      expect(submit.className).toContain('home-hero__attention-sheen');
    });
  });
});
