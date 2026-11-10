"""Contact sheet of the landmark frames, each standing on a board block at the docs/assets.md 2b anchor.

    /tmp/pxenv/bin/python tools/art/contact.py   # -> assets/mockups/landmarks.png (3x, nearest)

One column per node type, each on its own block so silhouettes and colour accents compare side by side.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
SPRITES = ROOT / 'assets' / 'sprites'
OUT = ROOT / 'assets' / 'mockups' / 'landmarks.png'
CELL_W, CELL_H, STAND_DROP, HEADROOM, LABEL = 64, 48, 10, 80, 14
SCALE = 3
GAP = 8
BACKDROP = (22, 20, 31, 255)


def main() -> None:
    board = json.loads((ROOT / 'data' / 'board.json').read_text())
    types = sorted(p.stem[3:] for p in SPRITES.glob('lm_*.png'))
    counts = {t: sum(n['type'] == t for n in board['nodes']) for t in types}
    block = Image.open(SPRITES / 'ft_jade.png').convert('RGBA')
    col_w = CELL_W + GAP
    sheet = Image.new('RGBA', (len(types) * col_w + GAP, HEADROOM + block.height + LABEL + GAP), BACKDROP)
    draw = ImageDraw.Draw(sheet)
    for i, t in enumerate(types):
        x = GAP + i * col_w
        sheet.alpha_composite(block, (x, HEADROOM))
        lm = Image.open(SPRITES / f'lm_{t}.png').convert('RGBA')
        foot = (x + CELL_W // 2, HEADROOM + CELL_H // 2 + STAND_DROP)
        sheet.alpha_composite(lm, (foot[0] - lm.width // 2, foot[1] - lm.height))
        draw.text((x, HEADROOM + block.height + 2), f'{t} x{counts[t]}', fill=(244, 233, 208, 255))
    OUT.parent.mkdir(exist_ok=True)
    sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST).save(OUT)
    print(f'{len(types)} landmarks -> {OUT}')


if __name__ == '__main__':
    main()
