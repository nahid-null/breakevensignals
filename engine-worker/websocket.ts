import WebSocket from 'ws';

// Keep Bun's functioning native transport. HTTP upgrade status is inspected
// independently on errors because its unexpected-response callback is unsupported.
export default WebSocket;