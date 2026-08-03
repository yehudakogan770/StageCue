const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const store = require('./lib/store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/singer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'singer.html')));

// ---------- REST API: songs, playlists, presets ----------

function crudRoutes(resource) {
  const base = `/api/${resource}`;

  app.get(base, (req, res) => {
    const db = store.load();
    res.json(db[resource]);
  });

  app.post(base, (req, res) => {
    const db = store.load();
    const item = { ...req.body, id: store.newId(resource.slice(0, -1)) };
    db[resource].push(item);
    store.save(db);
    res.status(201).json(item);
  });

  app.put(`${base}/:id`, (req, res) => {
    const db = store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    db[resource][idx] = { ...db[resource][idx], ...req.body, id: req.params.id };
    store.save(db);
    res.json(db[resource][idx]);
  });

  app.delete(`${base}/:id`, (req, res) => {
    const db = store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = db[resource].splice(idx, 1);
    store.save(db);
    res.json(removed);
  });
}

['songs', 'playlists', 'presets'].forEach(crudRoutes);

// ---------- Live sessions (Socket.IO) ----------
// A session connects one keyboard player to one or more singers via a short code.
// State lives only in memory - it is the "live show" state, not saved data.

const sessions = new Map(); // code -> { playerSocketId, singerSocketIds: Set, state, disconnectTimer }
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 45000; // how long a session survives a dropped player connection

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions.has(code));
  return code;
}

function defaultState() {
  return {
    // song and message are independent - either, both, or neither can be showing at once.
    message: '',
    song: null, // { title, artist, lines: [] }
    highlightLine: -1,
    fontScale: 'normal',
  };
}

io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.code = null;

  socket.on('player:create', (desiredCode, maybeAck) => {
    const ack = typeof desiredCode === 'function' ? desiredCode : maybeAck;
    const raw = typeof desiredCode === 'function' ? '' : desiredCode;
    const clean = String(raw || '').trim().toUpperCase();

    if (clean) {
      if (!/^[A-Z0-9]{3,12}$/.test(clean)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Use 3-12 letters/numbers only.' });
        return;
      }
      if (sessions.has(clean)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'That code is already in use. Try another.' });
        return;
      }
    }

    const code = clean || makeCode();
    sessions.set(code, { playerSocketId: socket.id, singerSocketIds: new Set(), state: defaultState(), disconnectTimer: null });
    socket.join(`session:${code}`);
    socket.data.role = 'player';
    socket.data.code = code;
    if (typeof ack === 'function') ack({ ok: true, code });
  });

  // Reclaims an existing session after a dropped connection (network blip, phone
  // sleep, etc). Socket.IO issues a new socket id on reconnect, so the player
  // has to re-associate with their code rather than automatically staying "in" it.
  socket.on('player:resume', (code, ack) => {
    const clean = String(code || '').trim().toUpperCase();
    const session = sessions.get(clean);
    if (!session) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    session.playerSocketId = socket.id;
    socket.join(`session:${clean}`);
    socket.data.role = 'player';
    socket.data.code = clean;
    if (typeof ack === 'function') ack({ ok: true, code: clean, state: session.state, singerCount: session.singerSocketIds.size });
    socket.to(`session:${clean}`).emit('player:reconnected');
  });

  socket.on('singer:join', (code, ack) => {
    const clean = String(code || '').trim().toUpperCase();
    const session = sessions.get(clean);
    if (!session) {
      if (typeof ack === 'function') ack({ ok: false, error: 'No session with that code. Check the code and try again.' });
      return;
    }
    session.singerSocketIds.add(socket.id);
    socket.join(`session:${clean}`);
    socket.data.role = 'singer';
    socket.data.code = clean;
    if (typeof ack === 'function') ack({ ok: true, state: session.state });
    io.to(session.playerSocketId).emit('singer:joined', { count: session.singerSocketIds.size });
  });

  socket.on('player:update', (partialState) => {
    if (socket.data.role !== 'player' || !socket.data.code) return;
    const session = sessions.get(socket.data.code);
    if (!session) return;
    session.state = { ...session.state, ...partialState };
    socket.to(`session:${socket.data.code}`).emit('state:update', session.state);
  });

  socket.on('singer:react', (text) => {
    if (socket.data.role !== 'singer' || !socket.data.code) return;
    const session = sessions.get(socket.data.code);
    if (!session) return;
    io.to(session.playerSocketId).emit('singer:reaction', { text, at: Date.now() });
  });

  socket.on('disconnect', () => {
    const { role, code } = socket.data;
    if (!code) return;
    const session = sessions.get(code);
    if (!session) return;

    if (role === 'player') {
      // Don't nuke the session on the first dropped packet - give the player a
      // window to reconnect (via player:resume) before telling the singer it's over.
      if (session.playerSocketId !== socket.id) return; // a newer connection already took over
      socket.to(`session:${code}`).emit('player:disconnected');
      session.disconnectTimer = setTimeout(() => {
        io.to(`session:${code}`).emit('session:ended');
        sessions.delete(code);
      }, RECONNECT_GRACE_MS);
    } else if (role === 'singer') {
      session.singerSocketIds.delete(socket.id);
      io.to(session.playerSocketId).emit('singer:joined', { count: session.singerSocketIds.size });
    }
  });
});

server.listen(PORT, () => {
  console.log(`StageCue running at http://localhost:${PORT}`);
});
