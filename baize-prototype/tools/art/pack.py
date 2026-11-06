"""Turn pixelized art (tools/art/out) into game frames and rebuild the texture atlas.

    /tmp/pxenv/bin/python tools/art/pixelize.py   # source art -> tools/art/out
    /tmp/pxenv/bin/python tools/art/pack.py       # tools/art/out -> assets/sprites -> assets/atlas.*

assets/sprites/<frame>.png is the source of truth for the atlas: every frame there is packed, frames this
script does not produce are kept as they are. Needs Pillow and NumPy.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT.parent.parent / 'assets'
SPRITES = ASSETS / 'sprites'
HEROES = ['body', 'magic', 'sword', 'alch']
ATLAS_W = 1024
PAD = 2

# Portrait backdrops: dark field, mid disc behind the head, light core, in each hero's colour.
BACKDROP = {
    'body': ('#3A1E10', '#7A3A16', '#B85A1C'),
    'magic': ('#0F1830', '#1F3A6E', '#3A66AC'),
    'sword': ('#280C12', '#641822', '#9A2C36'),
    'alch': ('#0C2220', '#1A463C', '#2C725C'),
}

INK = (42, 34, 56, 255)
FACE = (244, 233, 208, 255)
FACE_LIGHT = (255, 250, 236, 255)
FACE_SHADE = (214, 196, 160, 255)
EDGE = (168, 146, 110, 255)
RED = (217, 67, 75, 255)
DIE = 24
PROPS = [f'lm_{t}' for t in ('start', 'gate', 'alchemy', 'market', 'secret', 'spring', 'beast', 'ruins', 'eye')] + [
    f'bld_{n}' for n in (1, 2, 3)] + [
    f'ic_{n}' for n in ('stone', 'herb', 'pill', 'cult', 'mind')]

# Front-tilt blocks (docs/assets.md 2b): a 48px top face over a 16px front face. Per block, how many rows the
# top surface may hang over the front edge (grass tufts, snow lips).
FT_BLOCKS = {'ft_land_wood': 2, 'ft_land_fire': 0, 'ft_land_water': 3, 'ft_land_earth': 1, 'ft_jade': 0}
FT_TOP = 48
# Each cell's top face is bevelled (lit upper-left edges, shaded lower-right) so the board reads as a grid
# while the texture still runs on across cells.
FT_BEVEL_LIT, FT_BEVEL_SHADE = 1.15, 0.72
FT_FRONT_SHADE = np.array([1.12] + [0.8] * 12 + [0.68, 0.6])
FT_BLOCK_COLOURS, FT_ALTAR_COLOURS = 32, 64
FT_ALTAR = (192, 240)
FT_ALTAR_STATUE_FOOT = (96, 168)


def rgb(hex_colour: str) -> tuple[int, int, int, int]:
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def backdrop(size: int, colours: tuple[str, str, str]) -> Image.Image:
    dark, mid, light = (np.array(rgb(c), np.uint8) for c in colours)
    ys, xs = np.mgrid[0:size, 0:size] + 0.5
    d = np.hypot(xs - size / 2, ys - size * 0.42) / size
    checker = (xs.astype(int) + ys.astype(int)) % 2 == 0
    out = np.empty((size, size, 4), np.uint8)
    out[:] = dark
    out[(d < 0.46) | ((d < 0.5) & checker)] = mid
    out[(d < 0.26) | ((d < 0.3) & checker)] = light
    return Image.fromarray(out, 'RGBA')


def portrait(hero: str, suffix: str) -> Image.Image:
    art = Image.open(ROOT / 'out' / f'por_{hero}{suffix}.png').convert('RGBA')
    bg = backdrop(art.width, BACKDROP[hero])
    bg.alpha_composite(art)
    return bg


def die(n: int) -> Image.Image:
    """Flat front-facing die: 24px with 4px pips, a lit top edge and a 2px base so it still reads as a cube."""
    a = np.zeros((DIE, DIE, 4), np.uint8)
    a[0:DIE, 0:DIE] = INK
    a[1:21, 1:23] = FACE
    a[1, 2:22] = FACE_LIGHT
    a[2:20, 1] = FACE_LIGHT
    a[2:21, 22] = FACE_SHADE
    a[21:23, 1:23] = EDGE
    for y, x in [(0, 0), (0, DIE - 1), (DIE - 1, 0), (DIE - 1, DIE - 1)]:
        a[y, x] = 0
    cols = {'l': 4, 'c': 10, 'r': 16}
    rows = {'t': 3, 'm': 9, 'b': 15}
    layout = {
        2: ['tl', 'br'], 3: ['tl', 'mc', 'br'], 4: ['tl', 'tr', 'bl', 'br'],
        5: ['tl', 'tr', 'mc', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
    }
    if n == 1:
        a[8:14, 9:15] = RED
        for y, x in [(8, 9), (8, 14), (13, 9), (13, 14)]:
            a[y, x] = FACE
    else:
        for r, c in layout[n]:
            y, x = rows[r], cols[c]
            a[y:y + 4, x:x + 4] = INK
            for cy, cx in [(y, x), (y, x + 3), (y + 3, x), (y + 3, x + 3)]:
                a[cy, cx] = FACE
    return Image.fromarray(a, 'RGBA')


def out_rgba(name: str) -> np.ndarray:
    return np.asarray(Image.open(ROOT / 'out' / f'{name}.png').convert('RGBA')).astype(float)


def limit_palette(im: Image.Image, colours: int) -> Image.Image:
    """Shading and compositing multiply the colour count; fold the frame back to one small palette."""
    rgb = im.convert('RGB').quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return Image.fromarray(np.dstack([np.asarray(rgb.convert('RGB')), np.asarray(im.getchannel('A'))]), 'RGBA')


def ft_block(name: str, overhang: int) -> Image.Image:
    """Stack a tiling top texture over its shaded front face, with an ink bottom edge and a ragged top lip."""
    kind = name.rsplit('_', 1)[1]
    top, front = out_rgba(f'ft_top_{kind}'), out_rgba(f'ft_front_{kind}')
    top[0, :, :3] *= FT_BEVEL_LIT
    top[:, 0, :3] *= FT_BEVEL_LIT
    top[-1, :, :3] *= FT_BEVEL_SHADE
    top[:, -1, :3] *= FT_BEVEL_SHADE
    front[:-1, :, :3] *= FT_FRONT_SHADE[:, None, None]
    front[-1] = INK
    lengths = np.random.default_rng(0).integers(0, overhang + 1, top.shape[1])
    for x, n in enumerate(lengths):
        front[:n, x, :3] = top[FT_TOP - 1, x, :3] * 0.85
    block = Image.fromarray(np.clip(np.concatenate([top, front]), 0, 255).astype(np.uint8), 'RGBA')
    return limit_palette(block, FT_BLOCK_COLOURS)


def ft_altar() -> Image.Image:
    """The 3x3 platform (top face, then front face) at the bottom of the frame, the Baize statue standing on it."""
    frame = Image.new('RGBA', FT_ALTAR, (0, 0, 0, 0))
    top = Image.open(ROOT / 'out' / 'ft_altar_top.png').convert('RGBA')
    front = Image.open(ROOT / 'out' / 'ft_altar_front.png').convert('RGBA')
    frame.alpha_composite(top, (0, FT_ALTAR[1] - front.height - top.height))
    frame.alpha_composite(front, (0, FT_ALTAR[1] - front.height))
    statue = Image.open(ROOT / 'out' / 'ft_altar_statue.png').convert('RGBA')
    fx, fy = FT_ALTAR_STATUE_FOOT
    frame.alpha_composite(statue, (fx - statue.width // 2, fy - statue.height))
    return limit_palette(frame, FT_ALTAR_COLOURS)


def frames() -> dict[str, Image.Image]:
    made: dict[str, Image.Image] = {name: ft_block(name, overhang) for name, overhang in FT_BLOCKS.items()}
    made['ft_altar'] = ft_altar()
    for name in PROPS:
        made[name] = Image.open(ROOT / 'out' / f'{name}.png').convert('RGBA')
    for h in HEROES:
        made[f'por_{h}'] = portrait(h, '')
        made[f'por_{h}_s'] = portrait(h, '_s')
        made[f'tok_{h}'] = Image.open(ROOT / 'out' / f'tok_{h}.png').convert('RGBA')
    for n in range(1, 7):
        made[f'die_{n}'] = die(n)
    return made


def pack(images: dict[str, Image.Image]) -> tuple[Image.Image, dict]:
    order = sorted(images, key=lambda k: (-images[k].height, k))
    x = y = shelf = 0
    place = {}
    for k in order:
        w, h = images[k].size
        if x + w > ATLAS_W:
            x, y, shelf = 0, y + shelf + PAD, 0
        place[k] = (x, y)
        x += w + PAD
        shelf = max(shelf, h)
    atlas = Image.new('RGBA', (ATLAS_W, y + shelf), (0, 0, 0, 0))
    meta = {}
    for k in sorted(images):
        im = images[k]
        px, py = place[k]
        atlas.paste(im, (px, py))
        meta[k] = {
            'frame': {'x': px, 'y': py, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': im.width, 'h': im.height},
            'sourceSize': {'w': im.width, 'h': im.height},
        }
    return atlas, meta


def save_if_changed(im: Image.Image, path: Path) -> None:
    """Re-encoding an unchanged PNG still changes its bytes; skip it so git only shows real edits."""
    if path.exists():
        old = Image.open(path).convert('RGBA')
        if old.size == im.size and np.array_equal(np.asarray(old), np.asarray(im.convert('RGBA'))):
            return
    im.save(path)


def main() -> None:
    for name, im in frames().items():
        save_if_changed(im, SPRITES / f'{name}.png')
    images = {p.stem: Image.open(p).convert('RGBA') for p in sorted(SPRITES.glob('*.png'))}
    for name, im in images.items():
        save_if_changed(im.resize((im.width * 4, im.height * 4), Image.NEAREST), ASSETS / 'sprites_x4' / f'{name}.png')
    atlas, meta = pack(images)
    atlas.save(ASSETS / 'atlas.png')
    doc = {
        'frames': meta,
        'meta': {'app': 'baize-art', 'version': '0.4', 'image': 'atlas.png', 'format': 'RGBA8888',
                 'size': {'w': atlas.width, 'h': atlas.height}, 'scale': '1'},
    }
    (ASSETS / 'atlas.json').write_text(json.dumps(doc, indent=1) + '\n')
    print(f'{len(images)} frames -> atlas {atlas.width}x{atlas.height}')


if __name__ == '__main__':
    main()
