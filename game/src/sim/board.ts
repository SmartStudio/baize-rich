// npm run board [path/to/board.json]: validate a board and print its ASCII render.
import fs from 'node:fs';
import { defaultData } from '../core/data';
import type { BoardData } from '../core/types';
import { checkBoard, renderBoard } from './boardcheck';

const file = process.argv[2];
const data: BoardData = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : defaultData.board;
const problems = checkBoard(data);
if (problems.length === 0) console.log(renderBoard(data));
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}` : '\nboard ok');
process.exit(problems.length ? 1 : 0);
