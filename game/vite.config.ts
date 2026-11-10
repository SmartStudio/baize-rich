import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(here, '../assets');
// The texture atlas is optional while art is in production. We check for it when the
// config is evaluated (dev-server start / build) so the game never requests a missing
// file (which would show up as a 404 console error). Restart `npm run dev` / rebuild
// after dropping atlas.png + atlas.json into ../assets.
// BAIZE_NO_ATLAS=1 forces placeholder art (to check the game still runs without the atlas).
const hasAtlas = !process.env.BAIZE_NO_ATLAS &&
  existsSync(resolve(assetsDir, 'atlas.png')) && existsSync(resolve(assetsDir, 'atlas.json'));

export default defineConfig({
  base: './',
  // Cloudflare Rocket Loader rewrites module scripts and can prevent startup when
  // its extra loader request fails. Apply the opt-out after Vite emits the entry.
  plugins: [{
    name: 'cloudflare-module-entry',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(
        /<script\b(?=[^>]*\btype=["']module["'])/g,
        '<script data-cfasync="false"',
      ),
    },
  }],
  // ../assets is served at the web root: atlas.png -> ./atlas.png
  publicDir: assetsDir,
  define: {
    __HAS_ATLAS__: JSON.stringify(hasAtlas),
  },
  server: { fs: { allow: [resolve(here, '..')] } },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'phaser', test: /[\\/]node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
