import config from './lib/game-config.js';
document.getElementById('mode-note').hidden = config.transport !== 'local';
