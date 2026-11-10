"""Compose the front-tilt board from assets/sprites at the docs/assets.md 2b anchors, and check frame sizes.

    /tmp/pxenv/bin/python tools/art/mock_ft.py    # -> assets/mockups/ft_board.png (1280x720) + ft_board_x2.png

Uses data/board.json for the layout. Buildings and tokens stand on a fixed handful of land cells.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
SPRITES = ROOT / 'assets' / 'sprites'
OUT = ROOT / 'assets' / 'mockups'
CELL_W, CELL_H, FRONT = 64, 48, 16
SCREEN = (1280, 720)
BACKDROP = (22, 20, 31, 255)
STAND_DROP = 10
BUILDINGS = {'W4': 1, 'W12': 3, 'F5': 2, 'F13': 3, 'S4': 1, 'S12': 2, 'E4': 3, 'E12': 1}
TOKENS = {'W7': 'tok_body', 'F7': 'tok_magic', 'S7': 'tok_sword', 'E8': 'tok_alch'}
LIMITS = {'ft_land_': (64, 64, True), 'ft_jade': (64, 64, True), 'ft_altar': (192, 240, True),
          'lm_': (60, 80, False), 'bld_': (60, 72, False)}


def sprite(name: str) -> Image.Image:
    return Image.open(SPRITES / f'{name}.png').convert('RGBA')


def check_sizes() -> list[str]:
    problems = []
    for path in sorted(SPRITES.glob('*.png')):
        rule = next((v for k, v in LIMITS.items() if path.stem.startswith(k)), None)
        if rule is None:
            continue
        w, h, exact = rule
        size = Image.open(path).size
        ok = size == (w, h) if exact else size[0] <= w and size[1] <= h
        if not ok:
            problems.append(f'{path.stem} is {size[0]}x{size[1]}, contract {"=" if exact else "<="} {w}x{h}')
    return problems


def compose() -> Image.Image:
    board = json.loads((ROOT / 'data' / 'board.json').read_text())
    cols, rows = board['grid']['cols'], board['grid']['rows']
    ox = (SCREEN[0] - cols * CELL_W) // 2
    oy = (SCREEN[1] - rows * CELL_H - FRONT) // 2 + 24
    canvas = Image.new('RGBA', SCREEN, BACKDROP)

    def stand(name: str, c: int, r: int) -> None:
        im = sprite(name)
        foot_x, foot_y = ox + c * CELL_W + CELL_W // 2, oy + r * CELL_H + CELL_H // 2 + STAND_DROP
        canvas.alpha_composite(im, (foot_x - im.width // 2, foot_y - im.height))

    blocks, props = {}, {}
    for n in board['nodes']:
        c, r = n['pos']
        if n['type'] == 'altar':
            c0, r0, c1, r1 = n['rect']
            blocks.setdefault(r1, []).append(('ft_altar', ox + c0 * CELL_W, oy + (r1 + 1) * CELL_H + FRONT - 240))
            continue
        name = f"ft_land_{n['region']}" if n.get('region') else 'ft_jade'
        blocks.setdefault(r, []).append((name, ox + c * CELL_W, oy + r * CELL_H))
        if n['type'] != 'land':
            props.setdefault(r, []).append((f"lm_{n['type']}", c))
        elif n['id'] in BUILDINGS:
            props.setdefault(r, []).append((f"bld_{BUILDINGS[n['id']]}", c))
        elif n['id'] in TOKENS:
            props.setdefault(r, []).append((TOKENS[n['id']], c))
    for r in range(rows):
        for name, x, y in blocks.get(r, []):
            canvas.alpha_composite(sprite(name), (x, y))
        for name, c in props.get(r, []):
            stand(name, c, r)
    return canvas


def main() -> None:
    for problem in check_sizes():
        print('SIZE', problem)
    mock = compose()
    OUT.mkdir(exist_ok=True)
    mock.save(OUT / 'ft_board.png')
    corner = mock.crop((280, 360, 920, 720))
    corner.resize((corner.width * 2, corner.height * 2), Image.NEAREST).save(OUT / 'ft_board_x2.png')
    print(f"mock -> {OUT / 'ft_board.png'}")


if __name__ == '__main__':
    main()
