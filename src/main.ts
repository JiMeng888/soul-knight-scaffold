import { Game } from './core/Game';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('找不到 #game canvas');
}

const game = new Game(canvas);
game.startLoop();

// 控制台里可以直接看状态：__game.level.plan / __game.run / __game.room
(window as unknown as { __game: Game }).__game = game;
