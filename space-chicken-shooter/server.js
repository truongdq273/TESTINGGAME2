const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Cấu hình lại ở production
    methods: ["GET", "POST"]
  }
});

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = null;

  socket.on('join', ({ roomCode }) => {
    if (currentRoom) {
      socket.leave(currentRoom);
    }
    const channelName = `classroom_game_room_${roomCode}`;
    socket.join(channelName);
    currentRoom = channelName;
    console.log(`Socket ${socket.id} joined room ${roomCode}`);
  });

  socket.on('message', (envelope) => {
    if (!envelope || !envelope.roomCode) return;
    const channelName = `classroom_game_room_${envelope.roomCode}`;
    
    // Broadcast message to everyone in the room EXCEPT the sender
    socket.to(channelName).emit('message', envelope);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Classroom Game Server is running on port ${PORT}`);
});
