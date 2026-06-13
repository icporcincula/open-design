// Brand engine — public API consumed by brand-routes.ts.
//
// A "brand" = brand metadata (brand.json + meta.json under
// `<brandsRoot>/<id>/`) PLUS a generated user design system. Extraction is a
// deterministic pipeline:
//   1. prefetch  — fetch the site, measure colors/fonts, download logos
//   2. preview   — brandFromMaterial → a usable provisional Brand
//   3. system    — brandToDesignMd → createUserDesignSystem, storing the
//                  resulting `user:<id>` design-system id in brand meta so
//                  selecting the brand in the composer reuses the EXISTING
//                  designSystemId apply flow (no parallel brandId path).
//
// Every step streams a BrandExtractEvent. extractBrand never throws out of the
// function: any failure emits `{ event: 'error' }` and marks meta failed.

import fs from 'node:fs';
import path from 'node:path';

import type {
  Brand,
  BrandDetailResponse,
  BrandExtractEvent,
  BrandMeta,
  BrandSummary,
} from '@open-design/contracts';

import { createUserDesignSystem, deleteUserDesignSystem } from '../design-systems.js';
import { brandGuideMd, brandToDesignMd } from './design-md.js';
import { prefetchBrand } from './prefetch.js';
import { brandFromMaterial } from './provisional.js';
import {
  createBrandDir,
  deleteBrandDir,
  listBrandIds,
  newBrandId,
  patchMeta,
  readBrand,
  readBrandGuide,
  readMeta,
  resolveBrandFile,
  writeBrand,
  writeBrandGuide,
} from './store.js';

export type {
  ColorCandidate,
  FontCandidate,
  LogoCandidate,
  PrefetchResult,
} from './prefetch.js';
export { brandFromMaterial } from './provisional.js';
export { brandToDesignMd, brandGuideMd } from './design-md.js';
export { extractJsonBlock, validateBrand } from './validate.js';

export type ExtractBrandOptions = {
  url: string;
  brandsRoot: string;
  userDesignSystemsRoot: string;
  onEvent: (e: BrandExtractEvent) => void;
  signal?: AbortSignal;
};

/** Normalize a user-typed URL: prepend https:// when no scheme is present;
 *  reject anything that isn't http(s). Returns null when unusable. */
function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

/**
 * Extract a brand from a URL, streaming progress events. Never throws —
 * failures emit `{ event: 'error' }` and mark the brand meta `failed`.
 */
export async function extractBrand(opts: ExtractBrandOptions): Promise<void> {
  const { brandsRoot, userDesignSystemsRoot, onEvent, signal } = opts;

  const url = normalizeUrl(opts.url);
  if (!url) {
    onEvent({ event: 'error', message: 'Enter a valid http(s) website URL.' });
    return;
  }

  const id = newBrandId(url);
  let created = false;
  try {
    const now = Date.now();
    const meta: BrandMeta = {
      id,
      sourceUrl: url,
      createdAt: now,
      updatedAt: now,
      status: 'extracting',
    };
    createBrandDir(brandsRoot, id, meta);
    created = true;
    onEvent({ event: 'created', id });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 1: prefetch ──
    onEvent({ event: 'phase', phase: 'prefetch' });
    const dir = resolveBrandFile(brandsRoot, id, []);
    if (!dir) throw new Error('could not resolve brand directory');
    const material = await prefetchBrand(url, dir, (step, detail) => {
      onEvent(detail === undefined ? { event: 'prefetch', step } : { event: 'prefetch', step, detail });
    });
    if (!material) {
      patchMeta(brandsRoot, id, { status: 'failed', error: 'Could not fetch the site.' });
      onEvent({ event: 'error', message: 'Could not fetch the site.' });
      return;
    }
    onEvent({
      event: 'prefetch-done',
      colors: material.colors.length,
      fonts: material.fonts.length,
      logos: material.logos.length,
      thin: material.thin,
    });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 2: preview (deterministic provisional brand) ──
    onEvent({ event: 'phase', phase: 'preview' });
    const brand = brandFromMaterial(material, url);
    writeBrand(brandsRoot, id, brand);
    writeBrandGuide(brandsRoot, id, brandGuideMd(brand));
    onEvent({ event: 'preview', brand });

    if (signal?.aborted) throw new Error('aborted');

    // ── phase 3: register the user design system ──
    onEvent({ event: 'phase', phase: 'system' });
    let designSystemId: string | undefined;
    try {
      const body = brandToDesignMd(brand);
      const summary = await createUserDesignSystem(userDesignSystemsRoot, {
        title: brand.name,
        category: 'Brands',
        surface: 'web',
        status: 'published',
        body,
        provenance: {
          ...(brand.description ? { companyBlurb: brand.description } : {}),
          sourceNotes: `Extracted from ${url}`,
        },
      });
      designSystemId = summary.id;
      patchMeta(brandsRoot, id, { designSystemId });
      onEvent({ event: 'system', ok: true, designSystemId });
    } catch (err) {
      // The provisional brand stays usable even when design-system
      // registration fails; surface it but keep going to a ready state.
      onEvent({ event: 'system', ok: false, error: errorMessage(err) });
    }

    patchMeta(brandsRoot, id, { status: 'ready' });
    onEvent({ event: 'brand', id, brand });
    onEvent({ event: 'phase', phase: 'done' });
  } catch (err) {
    const message = errorMessage(err);
    if (created) patchMeta(brandsRoot, id, { status: 'failed', error: message });
    onEvent({ event: 'error', message });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** List every stored brand as a summary (meta + provisional brand). */
export function listBrandSummaries(brandsRoot: string): BrandSummary[] {
  const out: BrandSummary[] = [];
  for (const id of listBrandIds(brandsRoot)) {
    const meta = readMeta(brandsRoot, id);
    if (!meta) continue;
    out.push({ meta, brand: readBrand(brandsRoot, id) });
  }
  return out;
}

/** Full detail for one brand, or null when it is missing. */
export function readBrandDetail(brandsRoot: string, id: string): BrandDetailResponse | null {
  const meta = readMeta(brandsRoot, id);
  if (!meta) return null;
  return {
    meta,
    brand: readBrand(brandsRoot, id),
    guide: readBrandGuide(brandsRoot, id),
  };
}

/**
 * Remove a brand and its registered user design system. Returns false when the
 * brand dir did not exist.
 */
export async function removeBrand(
  brandsRoot: string,
  userDesignSystemsRoot: string,
  id: string,
): Promise<boolean> {
  const meta = readMeta(brandsRoot, id);
  if (meta?.designSystemId) {
    try {
      await deleteUserDesignSystem(userDesignSystemsRoot, meta.designSystemId);
    } catch {
      // Best-effort — still remove the brand dir below.
    }
  }
  return deleteBrandDir(brandsRoot, id);
}

const LOGO_EXT_PRIORITY = ['.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico'];

/**
 * Absolute path to the brand's primary logo file, or null when none exists.
 * Prefers brand.logo.primary, then the first logo in `logos/` by extension
 * priority (vector/raster before icon).
 */
export function resolveBrandLogoPath(brandsRoot: string, id: string): string | null {
  const brand = readBrand(brandsRoot, id);
  const primary = brand?.logo?.primary;
  if (primary) {
    const rel = primary.replace(/^\.?\/+/, '').split('/').filter(Boolean);
    const abs = resolveBrandFile(brandsRoot, id, rel);
    if (abs && isFile(abs)) return abs;
  }

  const logosDir = resolveBrandFile(brandsRoot, id, ['logos']);
  if (!logosDir) return null;
  let names: string[];
  try {
    names = fs.readdirSync(logosDir);
  } catch {
    return null;
  }
  const ranked = names
    .filter((n) => isFile(path.join(logosDir, n)))
    .sort((a, b) => extRank(a) - extRank(b) || a.localeCompare(b));
  const pick = ranked[0];
  return pick ? path.join(logosDir, pick) : null;
}

function extRank(name: string): number {
  const i = LOGO_EXT_PRIORITY.indexOf(path.extname(name).toLowerCase());
  return i === -1 ? LOGO_EXT_PRIORITY.length : i;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
