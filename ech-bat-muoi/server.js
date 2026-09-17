const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static frontend files from the current directory
app.use(express.static(path.join(__dirname, '')));

// Manage rooms and connections
const rooms = new Map(); // roomCode -> Set of ws clients

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      // The message is expected to be stringified JSON
      const envelope = JSON.parse(message);
      
      // Handle internal transport logic for joining rooms
      if (envelope.type === 'transport:join') {
        const roomCode = envelope.roomCode;
        ws.roomCode = roomCode;
        ws.playerId = envelope.senderId; // Store who this socket belongs to
        
        if (!rooms.has(roomCode)) {
          rooms.set(roomCode, new Set());
        }
        rooms.get(roomCode).add(ws);
        return;
      }
      
      if (envelope.type === 'transport:leave') {
        leaveRoom(ws);
        return;
      }

      // Handle standard game messages
      const roomCode = envelope.roomCode;
      if (roomCode && rooms.has(roomCode)) {
        // Send the raw message buffer directly to save re-stringifying
        rooms.get(roomCode).forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            // Private messaging
            if (envelope.recipientId) {
              if (client.playerId === envelope.recipientId) {
                client.send(message);
              }
            } else {
              // Broadcast to everyone else in the room
              if (client !== ws) {
                client.send(message);
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('Invalid JSON message', e);
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
  });
});

function leaveRoom(ws) {
  if (ws.roomCode && rooms.has(ws.roomCode)) {
    rooms.get(ws.roomCode).delete(ws);
    if (rooms.get(ws.roomCode).size === 0) {
      rooms.delete(ws.roomCode);
    }
  }
}

// Heartbeat to keep connections alive
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  console.log(`WebSocket server đang lắng nghe trên cổng ${PORT}`);
});
