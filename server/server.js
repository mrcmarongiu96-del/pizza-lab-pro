const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map();

app.get('/', (req, res) => {
  res.send('Walkie Talkie signaling server online');
});

function getRoomUsers(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, []);
  return rooms.get(roomId);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    const users = getRoomUsers(roomId);
    const exists = users.some((u) => u.socketId === socket.id);

    if (!exists) {
      users.push({ socketId: socket.id, username });
    }

    socket.emit('room-users', { users });

    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username,
    });

    console.log(`${username} joined ${roomId}`);
  });

  socket.on('offer', ({ to, sdp }) => {
    io.to(to).emit('offer', {
      from: socket.id,
      sdp,
    });
  });

  socket.on('answer', ({ to, sdp }) => {
    io.to(to).emit('answer', {
      from: socket.id,
      sdp,
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate,
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const username = socket.data.username;

    if (roomId && rooms.has(roomId)) {
      const filtered = rooms.get(roomId).filter((u) => u.socketId !== socket.id);

      if (filtered.length === 0) {
        rooms.delete(roomId);
      } else {
        rooms.set(roomId, filtered);
      }

      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        username,
      });
    }

    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
