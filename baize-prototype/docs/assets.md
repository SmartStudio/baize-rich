# 白泽秘境大富翁 · 资产清单 v0.3

所有美术资产都是**程序绘制的风格样稿**，用于原型开发和美术外包参考，基准分辨率 1280×720。正式版需要画师精修，尤其是角色动画帧。

## 1. 目录

| 路径 | 内容 |
|---|---|
| `assets/atlas.png` + `atlas.json` | Phaser 纹理图集（JSON Hash 格式，1× 像素，104 帧），由 `tools/art/pack.py` 从 `sprites/` 重建 |
| `assets/sprites/*.png` | 每一帧的 1× 单图，文件名即帧名 |
| `assets/sprites_x4/*.png` | 4 倍最近邻放大的预览图，给美术和策划看 |
| `assets/mockups/` | 主界面效果图（1280×720 与 1080p）、地图路线图、3 个弹窗样稿 |

## 2b. 正面斜俯视棋盘帧（v1.0）

镜头从正前上方斜看，格子横平竖直，类似 HD-2D。网格 (c, r) 的格子在世界坐标里占 x ∈ [c·64, c·64+64)，顶面 y ∈ [r·48, r·48+48)，前侧面再往下 16px。行号越大越靠前，越晚画。镜头只停在 1 倍或 2 倍。

| 帧名 | 尺寸 | 锚点与摆放 |
|---|---|---|
| `ft_land_wood` / `_fire` / `_water` / `_earth` | 64×64 | 顶面在帧内 y 0–47，前侧面 y 48–63。帧左上角放在 (c·64, r·48) |
| `ft_jade` | 64×64 | 神道白玉地块，摆放同上 |
| `ft_altar` | 192×240 | 3×3 白泽灵台连同白泽像。底部 160px 是台基（顶面 144 + 前侧面 16），上方 80px 给白泽像。帧左下角放在 (c0·64, (r1+1)·48+16) |
| `lm_<type>`（start gate alchemy market secret spring beast ruins eye） | 宽 ≤ 60，高 ≤ 80 | 正面朝向镜头的地标。底部居中，脚点放在顶面中心再往下 10px |
| `bld_1` / `_2` / `_3` | 宽 ≤ 60，高 ≤ 72 | 药圃、洞府、灵脉福地，正面朝向镜头，摆放同地标 |
| `tok_<hero>_<dir><n>` | 48×64 | 修士行走帧。dir 为 `d`（朝下，面向镜头）、`u`（朝上，背对镜头）、`s`（侧面，面朝右；朝左时水平翻转）。n 为 0–3，0 是站立帧，0→1→2→3 循环为走路。脚点在帧内 (24, 62) |
| `tok_<hero>` | 48×64 | 等于 `tok_<hero>_d0`，给头像以外的界面用 |

## 2. 其他图集帧

| 帧名 | 尺寸 | 用途与摆放 |
|---|---|---|
| `decor_wood` / `_fire` / `_water` / `_earth` | 不定 | 棋盘外地面上的散布装饰，底部居中 |
| `baize` | 100×104 | 白泽单独形象（白泽现世横幅、突破过场） |
| `obj_furnace` | 40×40 | 炼丹小游戏里的丹炉，3× 显示 |
| `tok_body` `tok_magic` `tok_sword` `tok_alch` | 48×64 | 等于各自的 `_d0` 行走帧，给棋盘以外的界面用 |
| `por_body` … `por_alch` | 64×64 | 大头像，只按 1×/2×/3× 整数倍显示 |
| `por_body_s` … `por_alch_s` | 40×40 | 小头像（玩家卡、行动栏、高级设置），1× 显示 |
| `ic_stone` `ic_herb` `ic_pill` `ic_cult` `ic_mind` | 16×16 | 灵石、灵草、丹药、修为、心境（HD 像素，`tools/art`） |
| `ic_baize` `ic_demon` | 16×16 | 白泽、心魔图标 |
| `die_1`–`die_6` | 24×24 | 正面骰子，4px 点数，2× 显示 |
| `card_attack` `card_guard` `card_move` `card_wealth` | 88×120 | 符箓卡底（含插画，不含文字）；卡名约在 y=80，费用写在右上角 |
| `card_divine` `card_heaven` | 80×108 | 机缘卡、白泽现世卡的空白底框 |

## 3. 正式美术需要补的内容（首版）

| 类别 | 数量 | 说明 |
|---|---|---|
| 修士行走动画 | 4 人 × 4 方向 × 6 帧 | 现有的只是站立帧 |
| 修士施法动画 | 4 × 1 | 12 fps 逐帧 |
| 选角立绘 | 4 张 128×128 | |
| 白泽动画 | 待机、点化、现世 3 套 | |
| 洞府升级特效 | 1 套 | |
| 符箓施放特效 | 4 类各 1 套 | |
| 界面组件 | 9-slice 面板、按钮三态、绸带、图标约 40 个 | |
| 秘境主题皮肤 | 后续（商业化） | |

## 4. 音频清单

### 曲目（10 首）
标题、大厅、青木灵林、赤焰火域、玄冰寒渊、厚土瘴泽、天魔来袭、白泽灵台、白泽现世、飞升 / 落败短曲。四首灵域曲要同调、同速、同小节数，方便无缝切换。

### 音效（约 60 个，命名规则 `sfx_<类别>_<名称>.ogg`）
| 类别 | 示例 |
|---|---|
| board | dice_roll、dice_land、step、gate_choose、slide、mire、teleport |
| economy | stone_gain、stone_pay、buy、upgrade_1–4、vein_lord |
| cultivation | cult_up、realm_up、breakthrough、ascend |
| spell | cast_attack、cast_guard、cast_move、cast_wealth、counter |
| baize | altar_enter、manifest、blessing_pick |
| demon | demon_spawn、demon_step、demon_hit、demon_die |
| ui | click、hover、open、close、toast、turn_start |

格式：OGG（主）+ M4A（Safari 备用）；音乐带循环点；音效打包成音频图集。
