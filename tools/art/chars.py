"""Slice each hero's walk sheet (tools/art/src/sheet_<hero>.png or .jpg) into the 12 walk frames of docs/assets.md 2b.

    /tmp/pxenv/bin/python tools/art/chars.py                     # every hero
    /tmp/pxenv/bin/python tools/art/chars.py body --preview /tmp/chars

A sheet is 3 rows (d, u, s) by 4 columns (walk frames 0-3) of figures on flat magenta. Each row is
scaled to the same height, outlined in INK, quantized to one palette per hero, and each frame is placed
with its feet at FOOT. Writes assets/sprites/tok_<hero>_<dir><n>.png,
tok_<hero>.png (= d0) and 4x copies in assets/sprites_x4. tools/art/out/tok_<hero>.png gets d0 too,
because pack.py rebuilds tok_<hero> from there.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT.parent.parent / 'assets'
HEROES = ('body', 'magic', 'sword', 'alch')
DIRS = 'dus'
STEPS = 4
FRAME = (48, 64)
FOOT = (24, 62)
COLOURS = 32
KEY_DISTANCE = 90
ALPHA_CUT = 128
MIN_GAP = 16
FOOT_ROWS = 0.06
TORSO = (0.3, 0.55)
INK = (30, 20, 26, 255)


def key_mask(rgb: np.ndarray) -> np.ndarray:
    """True where the sheet is background. Magenta drifts across a generated sheet, so key on chroma too."""
    f = rgb.astype(float)
    corners = np.concatenate([f[:24, :24], f[:24, -24:], f[-24:, :24], f[-24:, -24:]]).reshape(-1, 3)
    near_key = np.sqrt(((f - np.median(corners, axis=0)) ** 2).sum(-1)) < KEY_DISTANCE
    magenta = (np.minimum(f[..., 0], f[..., 2]) - f[..., 1] > 90) & (np.abs(f[..., 0] - f[..., 2]) < 110)
    return near_key | magenta


def despill(rgb: np.ndarray) -> np.ndarray:
    """Pull magenta out of edges the key blended into; no hero wears purple, so all of it is spill."""
    f = rgb.astype(float)
    spill = np.clip(np.minimum(f[..., 0], f[..., 2]) - f[..., 1], 0, None)
    f[..., 0] -= spill
    f[..., 2] -= spill
    return np.clip(f, 0, 255).astype(np.uint8)


def bands(profile: np.ndarray, want: int) -> list[tuple[int, int]]:
    """The `want` heaviest runs of a projection, after closing gaps narrower than MIN_GAP."""
    on = np.flatnonzero(profile > 2)
    runs, start = [], on[0]
    for a, b in zip(on, on[1:]):
        if b - a > MIN_GAP:
            runs.append((start, a + 1))
            start = b
    runs.append((start, on[-1] + 1))
    heavy = sorted(sorted(runs, key=lambda r: -profile[r[0]:r[1]].sum())[:want])
    if len(heavy) != want:
        raise ValueError(f'found {len(runs)} runs, need {want}: {runs}')
    return heavy


def cells(fg: np.ndarray) -> dict[str, list[tuple[int, int, int, int]]]:
    """Tight boxes (x0, y0, x1, y1) of the figures in each sheet row, left to right."""
    out = {}
    for d, (y0, y1) in zip(DIRS, bands(fg.sum(1), len(DIRS))):
        row = fg[y0:y1]
        boxes = []
        for x0, x1 in bands(row.sum(0), STEPS):
            ys = np.flatnonzero(row[:, x0:x1].any(1))
            boxes.append((x0, y0 + ys[0], x1, y0 + ys[-1] + 1))
        out[d] = boxes
    return out


def shrink(rgba: np.ndarray, scale: float) -> np.ndarray:
    """BOX-downsize with premultiplied alpha, so background never bleeds into edge colours."""
    h, w = rgba.shape[:2]
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    a = rgba[..., 3:].astype(float) / 255
    premul = Image.fromarray((rgba[..., :3] * a).astype(np.uint8)).resize(size, Image.BOX)
    small_a = np.asarray(Image.fromarray(rgba[..., 3]).resize(size, Image.BOX)).astype(float)
    rgb = np.asarray(premul).astype(float) * 255 / np.maximum(small_a[..., None], 1)
    return np.dstack([np.clip(rgb, 0, 255), np.where(small_a > ALPHA_CUT, 255, 0)]).astype(np.uint8)


def outline(small: np.ndarray) -> np.ndarray:
    """Ring the silhouette with a 1px INK border, one pixel outside the art on every side."""
    a = np.pad(small[..., 3] > 0, 1)
    near = np.zeros_like(a)
    near[1:] |= a[:-1]
    near[:-1] |= a[1:]
    near[:, 1:] |= a[:, :-1]
    near[:, :-1] |= a[:, 1:]
    out = np.pad(small, ((1, 1), (1, 1), (0, 0)))
    out[near & ~a] = INK
    return out


def band_x(img: np.ndarray, lo: float, hi: float) -> float:
    """Median x of the opaque pixels between fractions lo and hi of the figure's height, from the top."""
    ys, xs = np.nonzero(img[..., 3])
    rel = (ys - ys.min()) / (ys.max() - ys.min() + 1)
    return float(np.median(xs[(rel >= lo) & (rel < hi)])) + 0.5


def feet_x(img: np.ndarray) -> float:
    """A median, so a sword tip that reaches the foot rows does not pull it."""
    return band_x(img, 1 - FOOT_ROWS, 1)


def torso_x(img: np.ndarray) -> float:
    return band_x(img, *TORSO)


def align(row: list[np.ndarray]) -> list[np.ndarray]:
    """Stand frame 0 with its feet on FOOT. A stride's feet midpoint is not under the hips, so the
    walk frames instead keep the torso where frame 0 has it, which stops the body swaying."""
    dx0 = round(FOOT[0] - feet_x(row[0]))
    torso = torso_x(row[0]) + dx0
    return [place(s, dx0 if n == 0 else round(torso - torso_x(s))) for n, s in enumerate(row)]


def place(small: np.ndarray, dx: int) -> np.ndarray:
    """Put a figure in a FRAME shifted dx to the right, with its lowest row on FOOT[1]."""
    ys, xs = np.nonzero(small[..., 3])
    fy, fx = ys + FOOT[1] - ys.max(), xs + dx
    if fy.min() < 0 or fx.min() < 0 or fx.max() >= FRAME[0]:
        raise ValueError(f'figure spans x {fx.min()}..{fx.max()}, y {fy.min()}.. and overflows the {FRAME} frame')
    frame = np.zeros((FRAME[1], FRAME[0], 4), np.uint8)
    frame[fy, fx] = small[ys, xs]
    return frame


def quantize(frames: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Map every frame onto one median-cut palette taken from all of the hero's opaque pixels."""
    opaque = np.concatenate([f[f[..., 3] > 0][:, :3] for f in frames.values()])
    pal = Image.fromarray(opaque[None]).quantize(COLOURS, Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = {}
    for name, f in frames.items():
        mapped = Image.fromarray(np.ascontiguousarray(f[..., :3])).quantize(palette=pal, dither=Image.Dither.NONE)
        out[name] = np.dstack([np.asarray(mapped.convert('RGB')), f[..., 3]])
    return out


def hero_frames(hero: str) -> dict[str, np.ndarray]:
    src = next(ROOT.glob(f'src/sheet_{hero}.*'), None)
    if src is None:
        raise FileNotFoundError(f'no tools/art/src/sheet_{hero}.png or .jpg')
    rgb = np.asarray(Image.open(src).convert('RGB'))
    fg = ~key_mask(rgb)
    # JPEG fringes still carry key colour; shave one source pixel off the silhouette.
    core = np.asarray(Image.fromarray(np.where(fg, 255, 0).astype(np.uint8)).filter(ImageFilter.MinFilter(3)))
    rgba = np.dstack([despill(rgb), core])
    frames = {}
    for d, row in cells(fg).items():
        # Generated rows draw the same hero at different heights; one scale per row evens them out
        # and keeps the bob within a cycle. The outline adds a pixel above and below.
        scale = (FOOT[1] - 1) / max(y1 - y0 for _, y0, _, y1 in row)
        smalls = [outline(shrink(rgba[y0:y1, x0:x1], scale)) for x0, y0, x1, y1 in row]
        frames.update({f'{d}{n}': f for n, f in enumerate(align(smalls))})
    return quantize(frames)


def save(im: Image.Image, path: Path) -> None:
    im.save(path)
    if path.parent.name == 'sprites':
        im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(ASSETS / 'sprites_x4' / path.name)


def write(hero: str, frames: dict[str, np.ndarray]) -> None:
    for name, f in frames.items():
        save(Image.fromarray(f, 'RGBA'), ASSETS / 'sprites' / f'tok_{hero}_{name}.png')
    stand = Image.fromarray(frames['d0'], 'RGBA')
    save(stand, ASSETS / 'sprites' / f'tok_{hero}.png')
    save(stand, ROOT / 'out' / f'tok_{hero}.png')


def preview(hero: str, frames: dict[str, np.ndarray], out: Path) -> None:
    """4x walk GIFs per direction (s also mirrored) and a contact sheet of all 12 frames on a mid grey."""
    out.mkdir(parents=True, exist_ok=True)
    big = {k: on_grey(Image.fromarray(f, 'RGBA').resize((FRAME[0] * 4, FRAME[1] * 4), Image.NEAREST))
           for k, f in frames.items()}
    for d in DIRS + 'l':
        seq = [big[f'{d}{n}'] if d != 'l' else big[f's{n}'].transpose(Image.FLIP_LEFT_RIGHT) for n in range(STEPS)]
        seq[0].save(out / f'{hero}_{d}.gif', save_all=True, append_images=seq[1:], duration=160, loop=0)
    sheet = Image.new('RGB', (FRAME[0] * 4 * STEPS, FRAME[1] * 4 * len(DIRS)))
    for r, d in enumerate(DIRS):
        for n in range(STEPS):
            sheet.paste(big[f'{d}{n}'], (n * FRAME[0] * 4, r * FRAME[1] * 4))
    sheet.save(out / f'{hero}_sheet.png')
    print(hero, jitter(frames))


def on_grey(im: Image.Image) -> Image.Image:
    return Image.alpha_composite(Image.new('RGBA', im.size, (96, 104, 96, 255)), im).convert('RGB')


def contact(out: Path, heroes: list[str]) -> None:
    sheets = [Image.open(out / f'{h}_sheet.png') for h in heroes]
    board = Image.new('RGB', (sum(s.width + 16 for s in sheets) - 16, sheets[0].height), (40, 40, 40))
    for i, s in enumerate(sheets):
        board.paste(s, (i * (s.width + 16), 0))
    board.save(out / 'contact.png')


def jitter(frames: dict[str, np.ndarray]) -> dict[str, str]:
    """Per direction: head-top rows, lowest row, frame 0's feet centre and torso x across the walk cycle."""
    report = {}
    for d in DIRS:
        row = [frames[f'{d}{n}'] for n in range(STEPS)]
        tops = [int(np.nonzero(f[..., 3])[0].min()) for f in row]
        bottoms = [int(np.nonzero(f[..., 3])[0].max()) for f in row]
        torsos = [torso_x(f) for f in row]
        report[d] = f'top {tops} foot {bottoms} feet0 x {feet_x(row[0])} torso x {torsos}'
    return report


def main(args: list[str]) -> None:
    out = Path(args[args.index('--preview') + 1]) if '--preview' in args else None
    heroes = [a for a in args if a in HEROES] or HEROES
    for hero in heroes:
        frames = hero_frames(hero)
        write(hero, frames)
        if out:
            preview(hero, frames, out)
        print(f'{hero}: {len(frames)} frames')
    if out:
        contact(out, heroes)


if __name__ == '__main__':
    main(sys.argv[1:])
