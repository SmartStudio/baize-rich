"""Turn generated source art (tools/art/src/<id>.jpg, subject on a flat key colour) into game sprites.

    python3 tools/art/pixelize.py            # every asset in manifest.json
    python3 tools/art/pixelize.py tok_body   # just these ids

Needs Pillow and NumPy. The key colour is sampled from the image corners, so a magenta that drifted
pink in generation still keys out. Output: tools/art/out/<id>.png, cropped to the subject, or the whole
square for `"fit": "frame"` (portraits). An entry with `"src"` reuses another entry's source image.
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


def pixelize(src: Path, spec: dict) -> Image.Image:
    rgb = np.asarray(Image.open(src).convert('RGB'))
    frame = spec['fit'] == 'frame'
    # A portrait's shoulders run off the bottom edge, so only the top corners are reliably background.
    alpha = Image.fromarray(np.where(key_mask(rgb, top_only=frame), 0, 255).astype(np.uint8))
    # JPEG fringes around the subject still carry key colour; shave one source pixel off the edge.
    alpha = alpha.filter(ImageFilter.MinFilter(3))
    a = np.asarray(alpha)
    ys, xs = np.where(a > 0)
    box = (0, 0, a.shape[1], a.shape[0]) if frame else (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    crop = Image.fromarray(np.dstack([despill(rgb), a]), 'RGBA').crop(box)
    w, h = crop.size
    if frame:
        size = (spec['size'], spec['size'])
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
