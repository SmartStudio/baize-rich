"""Turn generated source art (tools/art/src/<id>.jpg, subject on a flat key colour) into game sprites.

    python3 tools/art/pixelize.py            # every asset in manifest.json
    python3 tools/art/pixelize.py tok_body   # just these ids

Needs Pillow and NumPy. The key colour is sampled from the image corners, so a magenta that drifted
pink in generation still keys out. Output: tools/art/out/<id>.png, cropped to the subject.
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


def key_mask(rgb: np.ndarray) -> np.ndarray:
    k = CORNER
    corners = np.concatenate([rgb[:k, :k], rgb[:k, -k:], rgb[-k:, :k], rgb[-k:, -k:]]).reshape(-1, 3)
    key = np.median(corners, axis=0)
    return np.sqrt(((rgb.astype(float) - key) ** 2).sum(-1)) < KEY_DISTANCE


def pixelize(src: Path, spec: dict) -> Image.Image:
    rgb = np.asarray(Image.open(src).convert('RGB'))
    alpha = Image.fromarray(np.where(key_mask(rgb), 0, 255).astype(np.uint8))
    # JPEG fringes around the subject still carry key colour; shave one source pixel off the edge.
    alpha = alpha.filter(ImageFilter.MinFilter(3))
    a = np.asarray(alpha)
    ys, xs = np.where(a > 0)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    crop = Image.fromarray(np.dstack([rgb, a]), 'RGBA').crop(box)
    w, h = crop.size
    if spec['fit'] == 'w':
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
        src = ROOT / 'src' / f'{asset_id}.jpg'
        if not src.exists():
            print(f'skip {asset_id}: no source yet')
            continue
        out = pixelize(src, manifest[asset_id])
        out.save(ROOT / 'out' / f'{asset_id}.png')
        print(f'{asset_id}: {out.size[0]}x{out.size[1]}')


if __name__ == '__main__':
    main(sys.argv[1:])
