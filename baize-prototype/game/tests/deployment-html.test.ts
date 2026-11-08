import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('keeps the production entry executable without Cloudflare Rocket Loader', async () => {
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const htmlAsset = bundles.flatMap((bundle) => 'output' in bundle ? bundle.output : [])
    .find((asset) => asset.type === 'asset' && asset.fileName === 'index.html');
  if (!htmlAsset || htmlAsset.type !== 'asset') throw new Error('Missing production index.html');
  const html = typeof htmlAsset.source === 'string'
    ? htmlAsset.source : new TextDecoder().decode(htmlAsset.source);
  const moduleScripts = html.match(/<script\b[^>]*\btype="module"[^>]*>/g) ?? [];
  expect(moduleScripts.length).toBeGreaterThan(0);
  for (const script of moduleScripts) {
    expect(script).toMatch(/data-cfasync="false"[^>]*\bsrc=/);
  }
});
