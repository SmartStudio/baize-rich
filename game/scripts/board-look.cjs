// Shoot the board's readability marks on a fixed, staged state, at zoom 1 and zoom 2: every seat owning land at
// every level, one seat holding a whole street, the cells a player can pick, and a token behind a landmark.
//   npx vite build && PORT=4195 node scripts/board-look.cjs   → screenshots/look-*.png
const { spawn } = require('node:child_process');
const path = require('node:path');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4179;
const BASE = `http://localhost:${PORT}/`;
const outDir = path.join(root, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('preview server did not start');
}

// Lands go round the seats and the levels; the first street all belongs to seat 3. Seat 2 stands on the land
// right behind a landmark, and the lands seat 1 owns are lit as pickable. Returns that land, for the close-up.
function stage() {
  const g = window.__baize;
  const sc = window.__phaser.scene.getScene('Game');
  const w = sc.boardView.world;
  const lands = Object.keys(g.state.tiles).filter((id) => g.board.node(id).type === 'land');
  lands.forEach((id, i) => Object.assign(g.state.tiles[id], i % 5 === 4 ? { owner: null, level: 0 } : { owner: i % 4, level: Math.floor(i / 5) % 4 }));
  const street = g.board.streetOf(lands[0]);
  for (const id of street) Object.assign(g.state.tiles[id], { owner: 2, level: 1 });
  const behind = lands.find((id) => {
    const f = w.footprint(id);
    const front = w.nodeAtCell(f.c0, f.r1 + 1);
    return front && g.board.node(front).type !== 'land';
  });
  sc.boardView.render(g.state);
  sc.boardView.placeToken(1, behind);
  sc.boardView.setClickable(lands.filter((id) => g.state.tiles[id].owner === 0));
  return behind;
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer(BASE);
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}?seed=2`);
    await page.evaluate(() => { localStorage.setItem('baize.tutorialSeen', '1'); localStorage.setItem('baize.coach', '{"armed":false,"seen":[]}'); localStorage.removeItem('baize.autosave'); });
    await page.goto(`${BASE}?seed=2`);
    await sleep(1500);
    await page.keyboard.press('x');
    await sleep(1000);
    for (const next of ['HeroSelect', 'Versus', 'Game']) {
      await page.keyboard.press('Space');
      await page.waitForFunction((key) => window.__phaser.scene.isActive(key), next, { timeout: 8000 });
      await sleep(1400);
    }
    await page.waitForFunction(() => window.__baize?.pending?.kind === 'preRoll', null, { timeout: 15000 });
    await sleep(1500);
    const behind = await page.evaluate(stage);
    await sleep(600);
    await page.screenshot({ path: path.join(outDir, 'look-zoom1.png') });
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -120);
    await sleep(300);
    await page.evaluate((id) => { const sc = window.__phaser.scene.getScene('Game'); sc.cam.panTo(sc.boardView.world.centre(id)); }, behind);
    await sleep(1500);
    await page.screenshot({ path: path.join(outDir, 'look-zoom2.png') });
    console.log(`token behind a landmark on ${behind}; shots in ${outDir}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
