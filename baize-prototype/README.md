# 白泽秘境大富翁 · 原型资料包 v0.3

像素风 · 东方修仙 · 大富翁式桌游。本资料包给开发团队使用，包含规则、数据、美术和一个可运行的 Phaser 原型。

```
baize-prototype/
├── docs/
│   ├── GDD.md        游戏设计文档：规则的唯一来源
│   ├── script.md     旁白、台词、新手引导、系统提示文案
│   └── assets.md     资产清单、图集帧名约定、音频清单
├── data/             数值与内容配置（原型直接读取）
│   ├── config.json     全局数值
│   ├── board.json      地图：41 个节点、坐标、灵域、地价
│   ├── heroes.json     4 名修士
│   ├── spells.json     12 种符箓
│   ├── events.json     宗门任务与机缘事件
│   └── blessings.json  境界、神通、天赐
├── assets/
│   ├── atlas.png / atlas.json   Phaser 图集（81 帧）
│   ├── sprites/  sprites_x4/    单帧 1× 与 4 倍预览
│   └── mockups/                 效果图、地图路线图、弹窗样稿
└── game/             Phaser 3 + TypeScript + Vite 原型工程（见 game/README.md）
```

## 快速开始

```bash
cd game
npm install
npm run dev                       # 浏览器打开提示的地址；加 ?auto=1 自动开一局 4 AI
npm test                          # 规则单元测试
npm run sim -- --games 500        # AI 批量自对弈，输出平衡数据
npm run build                     # 类型检查 + 生产构建
```

## 约定

- 规则以 `docs/GDD.md` 为准，数值以 `data/*.json` 为准；两者冲突时以 JSON 为准，并同步修正文档。
- `game/NOTES.md` 列出原型中简化或暂未实现的规则，以及发现的文档歧义。
- 题材借鉴「凡人修仙」类通用元素，不使用任何具体小说的人名、地名、宗门名。
- 字体：正式版使用缝合像素（Fusion Pixel，OFL）；原型暂用系统字体。
