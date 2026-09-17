/**
 * WebSocket Relay Server for Edupia Classroom Games
 * "Tìm Bò - Let's Save the Cows!" Production Server Bridge
 * 
 * Usage:
 *   npm install ws
 *   node ws-server.js
 * Default Port: 3000 (configurable via PORT environment variable)
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Edupia Classroom Game WebSocket Relay Server is RUNNING.');
});

const wss = new WebSocketServer({ server });

// Room storage: roomCode -> Map of clientId -> { ws, playerId, role }
const rooms = new Map();

function getOrCreateRoom(roomCode) {
  const code = roomCode.toUpperCase().trim();
  if (!rooms.has(code)) {
    rooms.set(code, new Map());
  }
  return rooms.get(code);
}

function broadcastToRoom(roomCode, envelope, excludeWs = null) {
  const room = rooms.get(roomCode.toUpperCase().trim());
  if (!room) return;

  const msgStr = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);

  room.forEach((client) => {
    if (client.ws.readyState === 1 && client.ws !== excludeWs) {
      // Filter by recipientId if specified
      if (envelope.recipientId && envelope.recipientId !== 'all') {
        if (client.playerId === envelope.recipientId) {
          client.ws.send(msgStr);
        }
      } else {
        client.ws.send(msgStr);
      }
    }
  });
}

wss.on('connection', (ws) => {
  let clientRoom = null;
  let clientPlayerId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // 1. Handshake Action: Join Room
      if (msg.action === 'join' && msg.roomCode) {
        clientRoom = msg.roomCode.toUpperCase().trim();
        clientPlayerId = msg.player ? msg.player.id : ('client_' + Math.random().toString(36).substr(2, 6));

        const room = getOrCreateRoom(clientRoom);
        room.set(clientPlayerId, {
          ws,
          playerId: clientPlayerId,
          player: msg.player,
          joinedAt: Date.now()
        });

        console.log(`[WS] Client '${clientPlayerId}' joined room '${clientRoom}' (Total in room: ${room.size})`);
        return;
      }

      // 2. Standard Room Envelope Routing
      if (msg.roomCode) {
        const targetRoom = msg.roomCode.toUpperCase().trim();
        broadcastToRoom(targetRoom, msg, ws);
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    if (clientRoom && clientPlayerId) {
      const room = rooms.get(clientRoom);
      if (room) {
        room.delete(clientPlayerId);
        console.log(`[WS] Client '${clientPlayerId}' left room '${clientRoom}' (Remaining: ${room.size})`);

        // Notify room about player departure
        broadcastToRoom(clientRoom, {
          type: 'playerLeave',
          roomCode: clientRoom,
          senderId: clientPlayerId,
          timestamp: Date.now()
        });

        if (room.size === 0) {
          rooms.delete(clientRoom);
          console.log(`[WS] Room '${clientRoom}' is empty and cleaned up.`);
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.warn(`[WS] Client error (${clientPlayerId}):`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`=====================================================`);
  console.log(`🚀 Edupia Classroom Game WebSocket Server RUNNING`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 WS Endpoint: ws://localhost:${PORT}`);
  console.log(`=====================================================`);
});
