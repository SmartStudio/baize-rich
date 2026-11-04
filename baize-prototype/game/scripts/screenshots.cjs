// Smoke-test the production build in headless Chromium and save screenshots.
//   npm run build && node scripts/screenshots.cjs
// Uses the preinstalled `playwright` package (not a project dependency).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const root = path.resolve(__dirname, '..');
// DIST=dist-noatlas SHOT_PREFIX=noatlas- node scripts/screenshots.cjs  → test a placeholder-art build
const DIST = process.env.DIST || 'dist';
const PREFIX = process.env.SHOT_PREFIX || '';
const outDir = path.join(root, 'screenshots');
const shot = (page, name) => page.screenshot({ path: path.join(outDir, PREFIX + name) });
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('preview server did not start');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: root, stdio: 'ignore' });
  const errors = [];
  let browser;
  try {
    await waitForServer(BASE);
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    // 1) setup screen (seed 2: P1's first roll lands on unowned land -> buy dialog)
    await page.goto(`${BASE}?seed=2`);
    await sleep(1500);
    await shot(page, '01-setup.png');

    // 2) human seat: start, roll once -> 购买灵田 dialog
    await page.keyboard.press('Space');
    await sleep(1500);
    await shot(page, '02-human-turn.png');
    await page.keyboard.press('Space');
    await sleep(3000);
    await shot(page, '03-human-buy-dialog.png');
    await page.keyboard.press('Space'); // buy
    await sleep(1200);
    await shot(page, '04-human-action-phase.png');

    await page.keyboard.press('c'); // 出符 sub-menu
    await sleep(500);
    await shot(page, '04b-cast-menu.png');
    await page.keyboard.press('Escape');
    await sleep(300);

    // 3) card-style pick dialog (opened directly on the scene's modal, for layout review)
    await page.evaluate(() => {
      const sc = window.__phaser.scene.getScene('Game');
      sc.modal.open({
        title: '选择神通', desc: '选 1 张永久生效', layout: 'cards', cardFrame: 'card_divine', cardLabel: '神通',
        options: [
          { id: 'swift', label: '身轻如燕', hint: '每次移动总点数可 +1 或 −1', icon: 'div_swift' },
          { id: 'gather', label: '聚灵', hint: '每回合首次收到租金时 +1 灵丹', icon: 'div_gather' },
          { id: 'midas', label: '点石成金', hint: '收租 +20%', icon: 'div_midas' },
        ],
        defaultId: 'midas',
      });
    });
    await sleep(500);
    await shot(page, '05-divine-pick-dialog.png');

    // 4) 4-AI auto game
    await page.goto(`${BASE}?auto=1&seed=7&speed=2`);
    await sleep(15000);
    await shot(page, '06-midgame.png');
    const info = await page.evaluate(() => {
      const g = window.__baize;
      return g ? { round: g.state.round, over: g.state.over, events: g.log.length } : null;
    });
    console.log('auto game after 15 s:', JSON.stringify(info));
    await sleep(25000);
    await shot(page, '07-midgame-later.png');
    const info2 = await page.evaluate(() => { const g = window.__baize; return { round: g.state.round, over: g.state.over }; });
    console.log('auto game after 40 s:', JSON.stringify(info2));

    // 5) human soak test: 1 human + 3 AI, keep confirming defaults with Space / Enter
    await page.goto(`${BASE}?seed=11`);
    await sleep(1200);
    await page.keyboard.press('Space');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      await page.keyboard.press('Space');
      await sleep(250);
      await page.keyboard.press('Enter');
      await sleep(250);
    }
    await shot(page, '08-human-soak.png');
    const info3 = await page.evaluate(() => { const g = window.__baize; return { round: g.state.round, over: g.state.over, answers: g.history.length }; });
    console.log('human soak after 45 s:', JSON.stringify(info3));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  if (errors.length) {
    console.error(`console errors (${errors.length}):\n` + errors.join('\n'));
    process.exit(1);
  }
  console.log('no console errors; screenshots in', outDir);
})().catch((e) => { console.error(e); process.exit(1); });
