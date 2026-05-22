import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildCreateArtifactRequestBody, createProjectArtifactFile } from '../src/artifact-create.js';
import { listFiles, projectFileWriteTestHooks, writeProjectFile } from '../src/projects.js';

describe('normal artifact create helper', () => {
  it('builds the non-overwrite HTTP request body used by MCP and CLI', () => {
    expect(buildCreateArtifactRequestBody({
      name: 'index.html',
      content: '<!doctype html>',
    })).toEqual({
      name: 'index.html',
      content: '<!doctype html>',
      encoding: 'utf8',
      artifact: true,
      overwrite: false,
    });
  });

  it('infers an artifact manifest and writes with overwrite disabled', async () => {
    const writeProjectFile = vi.fn(async () => ({ name: 'deck.html' }));

    await createProjectArtifactFile({
      projectsRoot: '/tmp/projects',
      projectId: 'project-1',
      input: {
        name: 'deck.html',
        content: '<!doctype html><h1>Deck</h1>',
      },
      writeProjectFile,
    });

    expect(writeProjectFile).toHaveBeenCalledWith(
      '/tmp/projects',
      'project-1',
      'deck.html',
      Buffer.from('<!doctype html><h1>Deck</h1>', 'utf8'),
      {
        overwrite: false,
        artifactManifest: expect.objectContaining({
          kind: 'deck',
          renderer: 'deck-html',
          entry: 'deck.html',
        }),
      },
      undefined,
    );
  });

  it('passes existing target errors through to callers', async () => {
    const err = new Error('file already exists') as Error & { code?: string };
    err.code = 'EEXIST';
    const writeProjectFile = vi.fn(async () => {
      throw err;
    });

    await expect(createProjectArtifactFile({
      projectsRoot: '/tmp/projects',
      projectId: 'project-1',
      input: {
        name: 'index.html',
        content: '<!doctype html>',
      },
      writeProjectFile,
    })).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rejects artifact creation when no manifest can be inferred', async () => {
    const writeProjectFile = vi.fn(async () => ({ name: 'component.jsx' }));

    await expect(createProjectArtifactFile({
      projectsRoot: '/tmp/projects',
      projectId: 'project-1',
      input: {
        name: 'component.jsx',
        content: 'export function Component() { return <div />; }',
      },
      writeProjectFile,
    })).rejects.toMatchObject({
      code: 'ARTIFACT_MANIFEST_REQUIRED',
      message: expect.stringContaining('artifactManifest is required'),
    });
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('treats null artifactManifest as missing when inference is unavailable', async () => {
    const writeProjectFile = vi.fn(async () => ({ name: 'component.jsx' }));

    await expect(createProjectArtifactFile({
      projectsRoot: '/tmp/projects',
      projectId: 'project-1',
      input: {
        name: 'component.jsx',
        content: 'export function Component() { return <div />; }',
        artifactManifest: null,
      },
      writeProjectFile,
    })).rejects.toMatchObject({ code: 'ARTIFACT_MANIFEST_REQUIRED' });
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('rejects invalid explicit manifests before writing the entry file', async () => {
    const writeProjectFile = vi.fn(async () => ({ name: 'component.jsx' }));

    await expect(createProjectArtifactFile({
      projectsRoot: '/tmp/projects',
      projectId: 'project-1',
      input: {
        name: 'component.jsx',
        content: 'export function Component() { return <div />; }',
        artifactManifest: {
          kind: 'react-component',
          exports: ['jsx'],
        },
      },
      writeProjectFile,
    })).rejects.toMatchObject({
      code: 'ARTIFACT_MANIFEST_INVALID',
      message: expect.stringContaining('artifactManifest.renderer must be a string'),
    });
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('lists explicit manifests for nested artifact entry files', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-artifact-create-'));
    try {
      await createProjectArtifactFile({
        projectsRoot,
        projectId: 'project-1',
        input: {
          name: 'dry-run/deck.html',
          content: '<!doctype html><h1>Deck</h1>',
          artifactManifest: {
            kind: 'deck',
            renderer: 'deck-html',
            exports: ['html', 'pdf'],
            title: 'Nested Deck',
          },
        },
        writeProjectFile: writeProjectFile as any,
      });

      const files = await listFiles(projectsRoot, 'project-1');
      expect(files).toEqual([
        expect.objectContaining({
          name: 'dry-run/deck.html',
          artifactKind: 'deck',
          artifactManifest: expect.objectContaining({
            kind: 'deck',
            renderer: 'deck-html',
            title: 'Nested Deck',
            entry: 'dry-run/deck.html',
          }),
        }),
      ]);
    } finally {
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });

  it('exposes the explicit manifest during the entry-file visibility window for new artifacts', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-artifact-write-race-'));
    let snapshot: Awaited<ReturnType<typeof listFiles>> = [];
    try {
      projectFileWriteTestHooks.afterBodyWrite = async ({ hasArtifactManifest }) => {
        expect(hasArtifactManifest).toBe(true);
        snapshot = await listFiles(projectsRoot, 'project-1');
      };

      await (writeProjectFile as any)(
        projectsRoot,
        'project-1',
        'real-daemon-smoke.html',
        '<!doctype html><html><body><h1>Real Daemon Smoke</h1></body></html>',
        {
          artifactManifest: {
            kind: 'html',
            renderer: 'html',
            exports: ['html', 'pdf', 'zip'],
            title: 'Real Daemon Smoke',
          },
        },
      );

      expect(snapshot).toEqual([
        expect.objectContaining({
          name: 'real-daemon-smoke.html',
          artifactManifest: expect.objectContaining({
            entry: 'real-daemon-smoke.html',
            title: 'Real Daemon Smoke',
          }),
        }),
      ]);
    } finally {
      projectFileWriteTestHooks.afterBodyWrite = null;
      await rm(projectsRoot, { recursive: true, force: true });
    }
  });
});
