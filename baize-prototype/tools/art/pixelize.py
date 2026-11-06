"""Turn generated source art (tools/art/src/<id>.jpg, subject on a flat key colour) into game sprites.

    python3 tools/art/pixelize.py            # every asset in manifest.json
    python3 tools/art/pixelize.py tok_body   # just these ids

Needs Pillow and NumPy. The key colour is sampled from the image corners, so a magenta that drifted
pink in generation still keys out. Output: tools/art/out/<id>.png, cropped to the subject, or the whole
square for `"fit": "frame"` (portraits). An entry with `"src"` reuses another entry's source image.

`"fit": "quad"` keys the source, then maps the quadrilateral `quad` onto exactly `size`.
`"fit": "tile"` takes a full-bleed texture (no key colour), cuts `crop` (fractions of the source; default
a centred cut at the target aspect) and cross-fades the edges along the axes in `wrap` so it tiles.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
KEY_DISTANCE = 70
CORNER = 24
ALPHA_CUT = 140
WRAP = 0.15


def key_mask(rgb: np.ndarray, top_only: bool) -> np.ndarray:
    k = CORNER
    patches = [rgb[:k, :k], rgb[:k, -k:]] if top_only else [rgb[:k, :k], rgb[:k, -k:], rgb[-k:, :k], rgb[-k:, -k:]]
    corners = np.concatenate(patches).reshape(-1, 3)
    key = np.median(corners, axis=0)
    return np.sqrt(((rgb.astype(float) - key) ** 2).sum(-1)) < KEY_DISTANCE


def despill(rgb: np.ndarray) -> np.ndarray:
    """Pull the magenta tint out of edges the key blended into (blue lightning came out pink)."""
    f = rgb.astype(float)
    spill = np.clip(np.minimum(f[..., 0], f[..., 2]) - f[..., 1], 0, None)
    f[..., 0] -= spill
    f[..., 2] -= spill * 0.5
    return np.clip(f, 0, 255).astype(np.uint8)


def wrap_blend(f: np.ndarray, axis: int) -> np.ndarray:
    """Cross-fade the far edge band onto the near edge, so the result repeats seamlessly along `axis`."""
    n = f.shape[axis]
    k = int(n * WRAP)
    w = (np.arange(k) / k).reshape([-1 if a == axis else 1 for a in range(f.ndim)])
    head = np.take(f, range(k), axis) * w + np.take(f, range(n - k, n), axis) * (1 - w)
    return np.concatenate([head, np.take(f, range(k, n - k), axis)], axis)


def texture(src: Path, spec: dict) -> Image.Image:
    """A full-bleed texture (no key colour) cut to `size` and made to tile along the axes in `wrap`."""
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(float)
    tw, th = spec['size']
    wrap = spec.get('wrap', '')
    h, w = rgb.shape[:2]
    if 'crop' in spec:
        left, top, right, bottom = spec['crop']
        f = rgb[round(top * h):round(bottom * h), round(left * w):round(right * w)]
    else:
        keep_x, keep_y = (1 - WRAP if axis in wrap else 1 for axis in 'xy')
        aspect = tw / th * keep_y / keep_x
        cw, ch = (round(h * aspect), h) if w / h > aspect else (w, round(w / aspect))
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        f = rgb[y0:y0 + ch, x0:x0 + cw]
    if 'x' in wrap:
        f = wrap_blend(f, 1)
    if 'y' in wrap:
        f = wrap_blend(f, 0)
    small = Image.fromarray(f.astype(np.uint8)).resize((tw, th), Image.BOX)
    return small.quantize(colors=spec['colors'], method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')


def pixelize(src: Path, spec: dict) -> Image.Image:
    if spec['fit'] == 'tile':
        return texture(src, spec)
    rgb = np.asarray(Image.open(src).convert('RGB'))
    frame = spec['fit'] == 'frame'
    # A portrait's shoulders run off the bottom edge, so only the top corners are reliably background.
    alpha = Image.fromarray(np.where(key_mask(rgb, top_only=frame), 0, 255).astype(np.uint8))
    # JPEG fringes around the subject still carry key colour; shave one source pixel off the edge.
    alpha = alpha.filter(ImageFilter.MinFilter(3))
    a = np.asarray(alpha)
    ys, xs = np.where(a > 0)
    box = (0, 0, a.shape[1], a.shape[0]) if frame else (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    keyed = Image.fromarray(np.dstack([despill(rgb), a]), 'RGBA')
    crop = keyed.crop(box)
    w, h = crop.size
    if frame:
        size = (spec['size'], spec['size'])
    elif spec['fit'] == 'quad':
        # Straighten a perspective view: `quad` is the source's upper-left, lower-left, lower-right, upper-right.
        size = tuple(spec['size'])
        crop = keyed.transform((size[0] * 8, size[1] * 8), Image.QUAD, spec['quad'], Image.BILINEAR)
    elif spec['fit'] == 'w':
        size = (spec['size'], max(1, round(h * spec['size'] / w)))
    else:
        size = (max(1, round(w * spec['size'] / h)), spec['size'])
    small = crop.convert('RGB').resize(size, Image.BOX)
    small_a = np.asarray(crop.getchannel('A').resize(size, Image.BOX))
    pal = small.quantize(colors=spec['colors'], method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return Image.fromarray(np.dstack([np.asarray(pal.convert('RGB')), np.where(small_a > ALPHA_CUT, 255, 0).astype(np.uint8)]), 'RGBA')


def main(ids: list[str]) -> None:
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    (ROOT / 'out').mkdir(exist_ok=True)
    for asset_id in ids or manifest:
        spec = manifest[asset_id]
        src = ROOT / 'src' / f"{spec.get('src', asset_id)}.jpg"
        if not src.exists():
            print(f'skip {asset_id}: no source yet')
            continue
        out = pixelize(src, spec)
        out.save(ROOT / 'out' / f'{asset_id}.png')
        print(f'{asset_id}: {out.size[0]}x{out.size[1]}')


if __name__ == '__main__':
    main(sys.argv[1:])
