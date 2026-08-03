const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const store = require('./lib/store');
const { hashPassword, verifyPassword, parseCookies } = require('./lib/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'stagecue_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Needed so req.protocol correctly reports "https" when running behind
// Render's (or any) reverse proxy - matters for building the Google OAuth
// redirect URI correctly.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/singer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'singer.html')));

// ---------- Accounts ----------
// Keyboard players must have an account, so their songs/playlists/presets are
// private to them. Singers never need one, but can optionally create one just
// to save their own custom quick-reply presets across sessions.

const webSessions = new Map(); // token -> { id, username, role }

function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return webSessions.get(token) || null;
}

function startWebSession(res, user) {
  const token = crypto.randomBytes(24).toString('hex');
  webSessions.set(token, { id: user.id, username: user.username, role: user.role });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_MAX_AGE_MS });
}

function requireRole(role) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in.' });
    if (user.role !== role) return res.status(403).json({ error: 'Not authorized.' });
    req.user = user;
    next();
  };
}

function publicUser(user) {
  return { username: user.username, role: user.role };
}

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'singer' ? 'singer' : 'player';

  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const db = store.load();
  db.users = db.users || [];
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const user = { id: store.newId('user'), username, passwordHash: hashPassword(password), role };
  if (role === 'singer') user.replies = [];
  db.users.push(user);
  store.save(db);

  startWebSession(res, user);
  res.status(201).json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const db = store.load();
  const user = (db.users || []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  startWebSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) webSessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

// ---------- Optional Google sign-in ----------
// Only active if GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are set as environment
// variables - otherwise the frontend simply hides the "Continue with Google"
// button and username/password keeps working exactly as before.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const GOOGLE_NONCE_COOKIE = 'stagecue_google_nonce';

app.get('/api/config', (req, res) => {
  res.json({ googleEnabled: GOOGLE_ENABLED });
});

if (GOOGLE_ENABLED) {
  function redirectUriFor(req) {
    return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  }

  app.get('/api/auth/google', (req, res) => {
    const role = req.query.role === 'singer' ? 'singer' : 'player';
    const nonce = crypto.randomBytes(16).toString('hex');
    res.cookie(GOOGLE_NONCE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUriFor(req),
      response_type: 'code',
      scope: 'openid email profile',
      state: `${role}:${nonce}`,
      prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      const [role, nonce] = String(state || '').split(':');
      const cookieNonce = parseCookies(req)[GOOGLE_NONCE_COOKIE];
      res.clearCookie(GOOGLE_NONCE_COOKIE);
      if (!code || !nonce || nonce !== cookieNonce) {
        return res.status(400).send('Google sign-in failed (could not verify the request). Please try again.');
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUriFor(req),
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Google token exchange failed');

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();
      if (!profile.email) throw new Error('Google did not return an email address');

      const desiredRole = role === 'singer' ? 'singer' : 'player';
      const db = store.load();
      db.users = db.users || [];
      let user = db.users.find((u) => u.username.toLowerCase() === profile.email.toLowerCase());
      if (!user) {
        user = { id: store.newId('user'), username: profile.email, passwordHash: null, role: desiredRole, authProvider: 'google' };
        if (desiredRole === 'singer') user.replies = [];
        db.users.push(user);
        store.save(db);
      }

      startWebSession(res, user);
      res.redirect(user.role === 'singer' ? '/singer' : '/player');
    } catch (err) {
      console.error('Google OAuth error:', err.message);
      res.status(500).send('Google sign-in failed. Please try again, or use username/password instead.');
    }
  });
}

// ---------- Singer's optional saved quick replies ----------

app.get('/api/singer/replies', requireRole('singer'), (req, res) => {
  const db = store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  res.json((user && user.replies) || []);
});

app.post('/api/singer/replies', requireRole('singer'), (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 40);
  if (!text) return res.status(400).json({ error: 'Reply text is required.' });
  const db = store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  const reply = { id: store.newId('reply'), text };
  user.replies = user.replies || [];
  user.replies.push(reply);
  store.save(db);
  res.status(201).json(reply);
});

app.delete('/api/singer/replies/:id', requireRole('singer'), (req, res) => {
  const db = store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  user.replies = (user.replies || []).filter((r) => r.id !== req.params.id);
  store.save(db);
  res.json({ ok: true });
});

// ---------- Events ----------
// Each event (e.g. "Sunday Service", "Youth Night") has its own completely
// separate songs, playlists, and presets - switching events switches your
// whole library, not just the live queue.

app.get('/api/events', requireRole('player'), (req, res) => {
  const db = store.load();
  db.events = db.events || [];
  res.json(db.events.filter((e) => e.ownerId === req.user.id));
});

app.post('/api/events', requireRole('player'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Event name is required.' });
  const db = store.load();
  db.events = db.events || [];
  const event = { id: store.newId('event'), name, ownerId: req.user.id, createdAt: Date.now() };
  db.events.push(event);
  store.save(db);
  res.status(201).json(event);
});

app.delete('/api/events/:id', requireRole('player'), (req, res) => {
  const db = store.load();
  db.events = db.events || [];
  const idx = db.events.findIndex((e) => e.id === req.params.id && e.ownerId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.events.splice(idx, 1);
  // Clean up everything that belonged only to this event.
  ['songs', 'playlists', 'presets'].forEach((resource) => {
    db[resource] = db[resource].filter((x) => x.eventId !== removed.id);
  });
  store.save(db);
  res.json(removed);
});

// ---------- REST API: songs, playlists, presets (private to each player account AND event) ----------

function crudRoutes(resource) {
  const base = `/api/${resource}`;
  const auth = requireRole('player');

  app.get(base, auth, (req, res) => {
    const eventId = String(req.query.eventId || '');
    const db = store.load();
    res.json(db[resource].filter((x) => x.ownerId === req.user.id && x.eventId === eventId));
  });

  app.post(base, auth, (req, res) => {
    const eventId = String(req.body.eventId || '');
    if (!eventId) return res.status(400).json({ error: 'eventId is required.' });
    const db = store.load();
    const item = { ...req.body, id: store.newId(resource.slice(0, -1)), ownerId: req.user.id, eventId };
    db[resource].push(item);
    store.save(db);
    res.status(201).json(item);
  });

  app.put(`${base}/:id`, auth, (req, res) => {
    const db = store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id && x.ownerId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // eventId is fixed at creation time - editing never moves an item to another event.
    db[resource][idx] = { ...db[resource][idx], ...req.body, id: req.params.id, ownerId: req.user.id, eventId: db[resource][idx].eventId };
    store.save(db);
    res.json(db[resource][idx]);
  });

  app.delete(`${base}/:id`, auth, (req, res) => {
    const db = store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id && x.ownerId === req.user.id);
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
    // Text size is NOT part of this shared state - each side controls its own locally.
    message: '',
    song: null, // { title, artist, lines: [] }
    highlightLine: -1,
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
