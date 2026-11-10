// Wall-clock seconds per full round (你 + 3 AI) in headless Chromium, the human answering every prompt at once.
//   npx vite build && PORT=4197 node scripts/round-time.cjs
//   DIST=/tmp/other-dist ROUNDS=4 SEED=11 SPEED=1 node scripts/round-time.cjs   → time another build the same way
// Same seed + same answers replay the same game, so two builds are timed on identical rounds.
const { spawn } = require('node:child_process');
const path = require('node:path');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const root = path.resolve(__dirname, '..');
const DIST = process.env.DIST || 'dist';
const PORT = Number(process.env.PORT) || 4197;
const ROUNDS = Number(process.env.ROUNDS) || 4;
const SEED = Number(process.env.SEED) || 11;
const SPEED = Number(process.env.SPEED) || 1;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('preview server did not start');
}

async function waitScene(page, key) {
  await page.waitForFunction((k) => window.__phaser?.scene.getScenes(true).some((s) => s.sys.settings.key === k), key, { timeout: 10000 });
}

async function startGame(page) {
  const url = `${BASE}?seed=${SEED}&speed=${SPEED}`;
  await page.goto(url);
  await page.evaluate(() => { localStorage.setItem('baize.tutorialSeen', '1'); localStorage.setItem('baize.coach', '{"armed":false,"seen":[]}'); localStorage.removeItem('baize.autosave'); });
  await page.goto(url);
  await waitScene(page, 'Title');
  await sleep(800);
  await page.keyboard.press('x');
  await sleep(600);
  await page.keyboard.press('Space');
  await waitScene(page, 'HeroSelect');
  await sleep(500);
  await page.keyboard.press('Space');
  await waitScene(page, 'Versus');
  await sleep(800);
  await page.keyboard.press('Space');
  await waitScene(page, 'Game');
}

/** What the human is being asked right now, as the screen shows it: the dock, a modal, or nothing. */
function humanPrompt(page) {
  return page.evaluate(() => {
    const sc = window.__phaser.scene.getScene('Game');
    const p = window.__baize.pending;
    const shown = sc.shownState.round;
    const seat = sc.shownState.current;
    if (!p || p.player !== 0) return { shown, seat, ask: null };
    if (sc.modal.isOpen) return { shown, seat, ask: 'modal' };
    if (sc.mainChoice) return { shown, seat, ask: p.kind };
    if (sc.picking) return { shown, seat, ask: 'pick' };
    return { shown, seat, ask: p.kind === 'miniGame' ? 'miniGame' : null };
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: root, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer(BASE);
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await startGame(page);
    await page.evaluate(() => {
      const sc = window.__phaser.scene.getScene('Game');
      const play = sc.playEvent.bind(sc);
      window.__beats = {};
      sc.playEvent = async (e) => {
        const t0 = performance.now();
        await play(e);
        const round = e.snap ? e.snap.round : 0;
        const key = `${e.snap && e.snap.current === 0 ? 'human' : 'ai'}:${e.type}`;
        if (round >= 2) (window.__beats[round] ??= {})[key] = ((window.__beats[round] ?? {})[key] ?? 0) + performance.now() - t0;
      };
    });
    const starts = new Map();
    const bySeat = [0, 0, 0, 0];
    let last = { at: Date.now(), seat: 0, round: 1 };
    const deadline = Date.now() + 60000 * ROUNDS;
    while (Date.now() < deadline) {
      const { shown, seat, ask } = await humanPrompt(page);
      const now = Date.now();
      if (last.round >= 2 && last.round <= ROUNDS + 1) bySeat[last.seat] += now - last.at;
      last = { at: now, seat, round: shown };
      if (!starts.has(shown)) starts.set(shown, now);
      if (starts.has(ROUNDS + 2)) break;
      if (ask === 'preRoll' || ask === 'modal' || ask === 'pick') await page.keyboard.press('Space');
      else if (ask === 'action') await page.keyboard.press('Enter');
      else if (ask === 'miniGame') await page.keyboard.press('Space');
      await sleep(ask ? 120 : 40);
    }
    const rounds = [];
    for (let r = 2; r <= ROUNDS + 1; r++) {
      if (starts.has(r) && starts.has(r + 1)) rounds.push({ round: r, seconds: (starts.get(r + 1) - starts.get(r)) / 1000 });
    }
    const mean = rounds.reduce((a, r) => a + r.seconds, 0) / Math.max(1, rounds.length);
    const perSeat = bySeat.map((ms) => Number((ms / 1000 / Math.max(1, rounds.length)).toFixed(2)));
    const beats = await page.evaluate((last) => {
      const sum = {};
      for (const [r, byKey] of Object.entries(window.__beats)) {
        if (Number(r) > last) continue;
        for (const [k, ms] of Object.entries(byKey)) sum[k] = (sum[k] ?? 0) + ms;
      }
      return Object.fromEntries(Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => [k, Math.round(ms)]));
    }, ROUNDS + 1);
    console.log(JSON.stringify({ dist: DIST, seed: SEED, speed: SPEED, rounds, mean: Number(mean.toFixed(2)), perSeat, beatsMs: beats, errors }));
    if (rounds.length < ROUNDS) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
