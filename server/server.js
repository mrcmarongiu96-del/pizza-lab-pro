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
    if (!users.some((u) => u.socketId === socket.id)) {
      users.push({ socketId: socket.id, username });
    }

    socket.emit('room-users', { users });
    socket.to(roomId).emit('user-joined', { socketId: socket.id, username });
    console.log(`${username} joined ${roomId}`);
  });

  // ── WebRTC signaling ──────────────────────────────────────────
  socket.on('offer', ({ to, sdp }) => {
    io.to(to).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    io.to(to).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ── Messaggi di testo ─────────────────────────────────────────
  socket.on('group-message', ({ text }) => {
    if (!text?.trim() || !socket.data.roomId) return;
    socket.to(socket.data.roomId).emit('group-message', {
      from: socket.id,
      username: socket.data.username,
      text: text.trim(),
      timestamp: Date.now(),
    });
  });

  socket.on('direct-message', ({ to, text }) => {
    if (!text?.trim() || !to) return;
    io.to(to).emit('direct-message', {
      from: socket.id,
      username: socket.data.username,
      text: text.trim(),
      timestamp: Date.now(),
    });
  });

  // ── Indicatori di trasmissione PTT ───────────────────────────
  socket.on('talking-start', ({ to }) => {
    if (!socket.data.roomId) return;
    // Broadcast a tutta la stanza per aggiornare gli indicatori UI
    socket.to(socket.data.roomId).emit('talking-start', {
      from: socket.id,
      username: socket.data.username,
      to: to || null, // null = a tutti, socketId = diretto
    });
  });

  socket.on('talking-stop', () => {
    if (!socket.data.roomId) return;
    socket.to(socket.data.roomId).emit('talking-stop', { from: socket.id });
  });

  // ── Disconnessione ────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId, username } = socket.data;

    if (roomId && rooms.has(roomId)) {
      const filtered = rooms.get(roomId).filter((u) => u.socketId !== socket.id);
      if (filtered.length === 0) rooms.delete(roomId);
      else rooms.set(roomId, filtered);
      socket.to(roomId).emit('user-left', { socketId: socket.id, username });
    }

    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
