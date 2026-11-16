import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type WebSocketType from 'ws';

// Bun substitutes its incomplete native implementation for the bare "ws" import.
// Load the installed package entry so rejection HTTP status remains observable.
const require = createRequire(import.meta.url);
const WebSocket: typeof WebSocketType = require(join(dirname(require.resolve('ws/package.json')), 'index.js'));
export default WebSocket;