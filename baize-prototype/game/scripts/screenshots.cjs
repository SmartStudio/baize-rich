// Smoke-test the production build in headless Chromium and save screenshots.
//   npm run build && node scripts/screenshots.cjs
// Uses the preinstalled `playwright` package (not a project dependency).
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/npm-tools/node_modules/playwright'); }

const root = path.resolve(__dirname, '..');
// DIST=dist-noatlas SHOT_PREFIX=noatlas- node scripts/screenshots.cjs  → test a placeholder-art build
const DIST = process.env.DIST || 'dist';
const PREFIX = process.env.SHOT_PREFIX || '';
// ONLY=choices captures just the choice screens and the breakthrough cutscene.
const ONLY = process.env.ONLY || '';
const outDir = path.join(root, 'screenshots');
const shot = (page, name) => page.screenshot({ path: path.join(outDir, PREFIX + name) });
const PORT = Number(process.env.PORT) || 4179;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const activeScenes = (page) => page.evaluate(() => window.__phaser.scene.getScenes(true).map((s) => s.sys.settings.key));
async function waitScene(page, key, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await activeScenes(page)).includes(key)) return;
    await sleep(100);
  }
  throw new Error(`scene ${key} never became active`);
}

// Take the first option on every prompt until the engine asks the human for `kind`.
async function answerUntil(page, kind, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await page.evaluate(() => {
      const q = window.__baize.pending;
      return q && q.player === 0 ? q.kind : null;
    });
    if (p === kind) return;
    if (p && p !== 'preRoll' && p !== 'action') await page.keyboard.press('Space');
    await sleep(300);
  }
  throw new Error(`never reached a human ${kind} prompt`);
}

// New game from a clean slate: 标题 → 选修士（默认第一位，作为「你」）→ 对阵 → 对局.
// The tutorial is marked seen, the in-game guide switched off and the autosave cleared so 空格 always means 开始游戏.
async function startQuickGame(page, url, shots = {}) {
  await page.goto(url);
  await page.evaluate(() => { localStorage.setItem('baize.tutorialSeen', '1'); localStorage.setItem('baize.coach', '{"armed":false,"seen":[]}'); localStorage.removeItem('baize.autosave'); });
  await page.goto(url);
  await waitScene(page, 'Title');
  await sleep(1500);
  if (shots.title) await shot(page, shots.title);
  await page.keyboard.press('x'); // skip the intro
  await sleep(1000);
  if (shots.menu) await shot(page, shots.menu);
  if (shots.tutorial) {
    await page.keyboard.press('h');
    await sleep(300);
    const pages = ['goal', 'turn', 'land', 'alchemy', 'breakthrough', 'duel', 'heroes', 'baize'];
    for (let i = 0; i < pages.length; i++) {
      await shot(page, `00c-how-${String(i + 1).padStart(2, '0')}-${pages[i]}.png`);
      if (i < pages.length - 1) {
        await page.keyboard.press('ArrowRight');
        await sleep(150);
      }
    }
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Space'); // 开始游戏
  await waitScene(page, 'HeroSelect');
  await sleep(700);
  if (shots.select) await shot(page, shots.select);
  await page.keyboard.press('Space'); // 开始对局
  await waitScene(page, 'Versus');
  await sleep(1400);
  if (shots.versus) await shot(page, shots.versus);
  await page.keyboard.press('Space'); // skip the versus splash
  await waitScene(page, 'Game');
}

// Saved games that stop on a human choice (scripts/choice-scenarios.ts), resumed through 继续上局.
function choiceScenarios() {
  const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  return JSON.parse(execFileSync(process.execPath, [tsx, path.join(root, 'scripts/choice-scenarios.ts')], { cwd: root, encoding: 'utf8' }));
}

async function resume(page, record) {
  await page.goto(BASE);
  await page.evaluate((r) => { localStorage.setItem('baize.tutorialSeen', '1'); localStorage.setItem('baize.coach', '{"armed":false,"seen":[]}'); localStorage.setItem('baize.autosave', JSON.stringify(r)); }, record);
  await page.goto(BASE);
  await waitScene(page, 'Title');
  await sleep(800);
  await page.keyboard.press('x'); // skip the intro
  await sleep(600);
  await page.keyboard.press('Space'); // 继续上局
  await waitScene(page, 'Game');
  await sleep(1500);
}

// 镇山 on the board: Esc must hand the engine its cancel, back to the action phase with no mountain.
async function roadblockShot(page, errors, record) {
  await resume(page, record);
  await shot(page, '16-roadblock-board.png');
  await page.keyboard.press('Escape');
  await sleep(500);
  const after = await page.evaluate(() => ({ kind: window.__baize.pending?.kind, roadblock: window.__baize.state.roadblock }));
  if (after.kind !== 'action' || after.roadblock) errors.push(`镇山 Esc: ${JSON.stringify(after)}`);
}

async function choiceShots(page, errors) {
  const sc = choiceScenarios();
  await resume(page, sc.stake.record);
  await shot(page, '09-stake.png');
  await page.keyboard.press(sc.stake.win);
  await sleep(1400);
  await shot(page, '09b-breakthrough-roll.png');
  await sleep(1800);
  await shot(page, '09c-breakthrough-success.png');
  await resume(page, sc.stake.record);
  await page.keyboard.press(sc.stake.lose);
  await sleep(3200);
  await shot(page, '09d-breakthrough-fail.png');
  const picks = [['fork', '14-fork-board.png'], ['forkClose', '14b-fork-board-zoom2.png'], ['adjust', '15-adjust-board.png']];
  for (const [name, file] of [['brew', '10-brew.png'], ['market', '11-market.png'], ['fortune', '12-fortune.png'], ['manifest', '13-manifest.png'], ...picks]) {
    await resume(page, sc[name].record);
    await shot(page, file);
  }
  await roadblockShot(page, errors, sc.roadblock.record);
}

// Point at a node's top face, k of the way from its centre to its left edge, and screenshot its popover.
// Fails the run unless that node is the one hovered and its popover is showing, so hit zones must match the art.
async function hoverNode(page, errors, id, k, file) {
  const at = await page.evaluate(([id, k]) => {
    const sc = window.__phaser.scene.getScene('Game');
    const w = sc.boardView.world;
    const c = w.centre(id);
    const r = w.rect(id);
    return sc.cam.toScreen({ x: c.x + (r.x - c.x) * k, y: c.y, w: 0, h: 0 });
  }, [id, k]);
  await page.mouse.move(at.x, at.y);
  await sleep(500);
  await shot(page, file);
  const seen = await page.evaluate(() => {
    const sc = window.__phaser.scene.getScene('Game');
    return { hovered: sc.hovered, shown: sc.tip.layer.visible, title: sc.tip.title.text };
  });
  console.log(`hover ${id}:`, JSON.stringify(seen));
  if (seen.hovered !== id || !seen.shown) errors.push(`hover ${id} at ${JSON.stringify(at)}: ${JSON.stringify(seen)}`);
}

// Zoom the following camera to 2× and shoot the moment a token is mid-step, then zoom back out.
async function walkCloseUp(page, errors, file) {
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -120);
  await sleep(600);
  const moving = () => window.__phaser.scene.getScene('Game').boardView.tokens.some((t) => t.moving);
  try {
    await page.waitForFunction(moving, null, { timeout: 15000, polling: 16 });
    await shot(page, file);
  } catch {
    errors.push(`${file}: no token walked within 15 s`);
  }
  await page.mouse.wheel(0, 120);
  await sleep(400);
}

// Title → first human turn, an all-AI game and a 45 s human soak.
async function tourShots(page, errors) {
  // 1) title → 玩法说明 → hero select → versus (seed 2: 你's first roll lands on unowned land -> buy dialog)
  await startQuickGame(page, `${BASE}?seed=2`, {
    title: '00-title.png',
    menu: '00b-title-menu.png',
    tutorial: true,
    select: '01-hero-select.png',
    versus: '01b-versus.png',
  });

  // 2) human seat: roll once -> 购买灵田 dialog
  await sleep(1500);
  await shot(page, '02-human-turn.png');
  await page.keyboard.press('Space');
  await sleep(900);
  await shot(page, '02b-dice.png');
  await answerUntil(page, 'buy'); // a roll can pass a fork first
  await sleep(600);
  await shot(page, '03-human-buy-dialog.png');
  await page.keyboard.press('Space'); // buy
  await answerUntil(page, 'action');
  await page.waitForFunction(() => window.__phaser.scene.getScene('Game').shownPlan.end);
  await sleep(300);
  await shot(page, '04-human-action-phase.png');

  await page.keyboard.press('c'); // 出符 sub-menu
  await sleep(500);
  await shot(page, '04b-cast-menu.png');
  await page.keyboard.press('Escape');
  await sleep(300);

  const land = await page.evaluate(() => window.__baize.state.players[0].pos);
  await hoverNode(page, errors, land, 0.85, '04c-hover-land.png');
  await page.evaluate(() => { const sc = window.__phaser.scene.getScene('Game'); sc.cam.panTo(sc.boardView.world.centre('ALTAR')); });
  await sleep(1500);
  await hoverNode(page, errors, 'ALTAR', 0.9, '04d-hover-altar.png');

  // 3) 4-AI auto game
  await page.goto(`${BASE}?auto=1&seed=7&speed=2`);
  await sleep(15000);
  await shot(page, '06-midgame.png');
  await walkCloseUp(page, errors, '06b-walk-zoom2.png');
  const info = await page.evaluate(() => {
    const g = window.__baize;
    return g ? { round: g.state.round, over: g.state.over, events: g.log.length } : null;
  });
  console.log('auto game after 15 s:', JSON.stringify(info));
  await sleep(25000);
  await shot(page, '07-midgame-later.png');
  const info2 = await page.evaluate(() => { const g = window.__baize; return { round: g.state.round, over: g.state.over }; });
  console.log('auto game after 40 s:', JSON.stringify(info2));
  await showResult(page, '07b-result.png');

  // 4) human soak test: 1 human + 3 AI, keep confirming defaults with Space / Enter
  await startQuickGame(page, `${BASE}?seed=11`);
  await sleep(1200);
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
  await showResult(page, '08b-result-human.png');
}

// End the running game by the round cap where it stands and shoot the result screen.
async function showResult(page, file) {
  await page.evaluate(() => {
    const game = window.__baize;
    const scene = window.__phaser.scene.getScene('Game');
    game.state.over = true;
    game.state.winner = game.ranking()[0];
    game.state.endReason = 'roundCap';
    scene.scene.start('Result', scene.resultData());
  });
  await waitScene(page, 'Result');
  await sleep(500);
  await shot(page, file);
}

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

    if (ONLY !== 'choices') await tourShots(page, errors);

    await choiceShots(page, errors);
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
