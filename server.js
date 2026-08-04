const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
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
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));

// Generates a QR code for a given URL entirely locally (no third-party
// image service involved) - used so a singer can scan their way straight
// into a session instead of typing a code.
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  if (!text) return res.status(400).json({ error: 'text is required.' });
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 240 });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

// ---------- Accounts ----------
// Keyboard players must have an account, so their songs/playlists/presets are
// private to them. Singers never need one, but can optionally create one just
// to save their own custom quick-reply presets across sessions.

const webSessions = new Map(); // token -> { id, username, role }

// ---------- Login rate limiting ----------
// Keyed by IP+username so a single attacker can't brute-force one account,
// without locking out other people trying that same username from
// elsewhere. In-memory is fine here - it resets on restart, same as the
// live session state below, and this app runs as a single process.
const loginAttempts = new Map(); // key -> { count, firstAttemptAt, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

function loginRateLimitKey(req, username) {
  return `${req.ip}:${username.toLowerCase()}`;
}

function checkLoginRateLimit(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return { blocked: false };
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
    return { blocked: true, retryAfterSec: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  if (entry.lockedUntil) loginAttempts.delete(key); // lockout expired
  return { blocked: false };
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, firstAttemptAt: now };
  if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.firstAttemptAt = now;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginAttempts.set(key, entry);
}

function recordLoginSuccess(key) {
  loginAttempts.delete(key);
}

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
  return { username: user.username, role: user.role, email: user.email || null };
}

function requireAuth() {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in.' });
    req.user = user;
    next();
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Password reset via email ----------
// Only active if SENDGRID_API_KEY/EMAIL_FROM are set - otherwise "Forgot
// password?" simply stays hidden on the frontend, same pattern as Google
// sign-in above. Requires a SendGrid account with a verified single sender
// (EMAIL_FROM) - see the README.
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const PASSWORD_RESET_ENABLED = Boolean(SENDGRID_API_KEY && EMAIL_FROM);

const passwordResetTokens = new Map(); // token -> { userId, expiresAt }
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Separate from the login limiter above - this guards against using the
// reset endpoint to spam someone's inbox, not against guessing a password.
const forgotPasswordAttempts = new Map(); // ip -> { count, firstAttemptAt }
const FORGOT_MAX_ATTEMPTS = 5;
const FORGOT_WINDOW_MS = 60 * 60 * 1000;

async function sendPasswordResetEmail(to, resetUrl) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: EMAIL_FROM, name: 'StageCue' },
      subject: 'Reset your StageCue password',
      content: [{
        type: 'text/plain',
        value: `Someone (hopefully you) requested a password reset for your StageCue account.\n\nReset it here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid ${res.status}: ${body}`);
  }
}

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = req.body.role === 'singer' ? 'singer' : 'player';

  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That doesn\'t look like a valid email address.' });

  const db = await store.load();
  db.users = db.users || [];
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const user = { id: store.newId('user'), username, passwordHash: hashPassword(password), role };
  if (email) user.email = email;
  if (role === 'singer') user.replies = [];
  db.users.push(user);
  await store.save(db);

  startWebSession(res, user);
  res.status(201).json({ ok: true, user: publicUser(user) });
});

app.put('/api/auth/email', requireAuth(), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That doesn\'t look like a valid email address.' });
  const db = await store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  user.email = email || null;
  await store.save(db);
  res.json({ ok: true, email: user.email });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const generic = { ok: true, message: 'If that account has a recovery email on file, a reset link has been sent.' };
  if (!PASSWORD_RESET_ENABLED || !username) return res.json(generic);

  const now = Date.now();
  const attempt = forgotPasswordAttempts.get(req.ip) || { count: 0, firstAttemptAt: now };
  if (now - attempt.firstAttemptAt > FORGOT_WINDOW_MS) {
    attempt.count = 0;
    attempt.firstAttemptAt = now;
  }
  attempt.count += 1;
  forgotPasswordAttempts.set(req.ip, attempt);
  if (attempt.count > FORGOT_MAX_ATTEMPTS) return res.json(generic);

  const db = await store.load();
  const user = (db.users || []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (user && user.email) {
    const token = crypto.randomBytes(32).toString('hex');
    passwordResetTokens.set(token, { userId: user.id, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });
    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error('Failed to send password reset email:', err.message);
    }
  }
  res.json(generic);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const entry = passwordResetTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  }

  const db = await store.load();
  const user = db.users.find((u) => u.id === entry.userId);
  if (!user) return res.status(400).json({ error: 'Account no longer exists.' });

  user.passwordHash = hashPassword(password);
  await store.save(db);
  passwordResetTokens.delete(token);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const rateLimitKey = loginRateLimitKey(req, username);

  const limit = checkLoginRateLimit(rateLimitKey);
  if (limit.blocked) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).` });
  }

  const db = await store.load();
  const user = (db.users || []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(rateLimitKey);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  recordLoginSuccess(rateLimitKey);
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
  res.json({ googleEnabled: GOOGLE_ENABLED, passwordResetEnabled: PASSWORD_RESET_ENABLED });
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
      const db = await store.load();
      db.users = db.users || [];
      let user = db.users.find((u) => u.username.toLowerCase() === profile.email.toLowerCase());
      if (!user) {
        user = { id: store.newId('user'), username: profile.email, passwordHash: null, role: desiredRole, authProvider: 'google' };
        if (desiredRole === 'singer') user.replies = [];
        db.users.push(user);
        await store.save(db);
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

app.get('/api/singer/replies', requireRole('singer'), async (req, res) => {
  const db = await store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  res.json((user && user.replies) || []);
});

app.post('/api/singer/replies', requireRole('singer'), async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 40);
  if (!text) return res.status(400).json({ error: 'Reply text is required.' });
  const db = await store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  const reply = { id: store.newId('reply'), text };
  user.replies = user.replies || [];
  user.replies.push(reply);
  await store.save(db);
  res.status(201).json(reply);
});

app.delete('/api/singer/replies/:id', requireRole('singer'), async (req, res) => {
  const db = await store.load();
  const user = db.users.find((u) => u.id === req.user.id);
  user.replies = (user.replies || []).filter((r) => r.id !== req.params.id);
  await store.save(db);
  res.json({ ok: true });
});

// ---------- Events ----------
// Each event (e.g. "Sunday Service", "Youth Night") has its own completely
// separate songs, playlists, and presets - switching events switches your
// whole library, not just the live queue.

app.get('/api/events', requireRole('player'), async (req, res) => {
  const db = await store.load();
  db.events = db.events || [];
  res.json(db.events.filter((e) => e.ownerId === req.user.id));
});

app.post('/api/events', requireRole('player'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Event name is required.' });
  const db = await store.load();
  db.events = db.events || [];
  const event = { id: store.newId('event'), name, ownerId: req.user.id, createdAt: Date.now() };
  db.events.push(event);
  await store.save(db);
  res.status(201).json(event);
});

app.delete('/api/events/:id', requireRole('player'), async (req, res) => {
  const db = await store.load();
  db.events = db.events || [];
  const idx = db.events.findIndex((e) => e.id === req.params.id && e.ownerId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.events.splice(idx, 1);
  // Clean up everything that belonged only to this event.
  ['songs', 'playlists', 'presets'].forEach((resource) => {
    db[resource] = db[resource].filter((x) => x.eventId !== removed.id);
  });
  db.history = (db.history || []).filter((h) => h.eventId !== removed.id);
  await store.save(db);
  res.json(removed);
});

// ---------- Show history ----------
// A lightweight record of each finished session (songs played, in order,
// plus any singer reactions) so a player can look back at past shows.
// Captured client-side in real time (the server's live session state only
// ever holds the CURRENT song) and submitted once, when the player ends
// the session.

app.get('/api/events/:eventId/history', requireRole('player'), async (req, res) => {
  const db = await store.load();
  const event = (db.events || []).find((e) => e.id === req.params.eventId && e.ownerId === req.user.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const records = (db.history || [])
    .filter((h) => h.eventId === req.params.eventId && h.ownerId === req.user.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  res.json(records);
});

app.post('/api/events/:eventId/history', requireRole('player'), async (req, res) => {
  const db = await store.load();
  const event = (db.events || []).find((e) => e.id === req.params.eventId && e.ownerId === req.user.id);
  if (!event) return res.status(404).json({ error: 'Not found' });

  const record = {
    id: store.newId('history'),
    eventId: event.id,
    ownerId: req.user.id,
    startedAt: Number(req.body.startedAt) || Date.now(),
    endedAt: Number(req.body.endedAt) || Date.now(),
    songs: (Array.isArray(req.body.songs) ? req.body.songs : []).slice(0, 300).map((s) => ({
      title: String(s.title || '').slice(0, 200),
      artist: String(s.artist || '').slice(0, 200),
      at: Number(s.at) || Date.now(),
    })),
    reactions: (Array.isArray(req.body.reactions) ? req.body.reactions : []).slice(0, 300).map((r) => ({
      text: String(r.text || '').slice(0, 200),
      at: Number(r.at) || Date.now(),
    })),
  };
  db.history = db.history || [];
  db.history.push(record);
  await store.save(db);
  res.status(201).json(record);
});

// ---------- REST API: songs, playlists, presets (private to each player account AND event) ----------

function crudRoutes(resource) {
  const base = `/api/${resource}`;
  const auth = requireRole('player');

  app.get(base, auth, async (req, res) => {
    const eventId = String(req.query.eventId || '');
    const db = await store.load();
    res.json(db[resource].filter((x) => x.ownerId === req.user.id && x.eventId === eventId));
  });

  app.post(base, auth, async (req, res) => {
    const eventId = String(req.body.eventId || '');
    if (!eventId) return res.status(400).json({ error: 'eventId is required.' });
    const db = await store.load();
    const item = { ...req.body, id: store.newId(resource.slice(0, -1)), ownerId: req.user.id, eventId };
    db[resource].push(item);
    await store.save(db);
    res.status(201).json(item);
  });

  app.put(`${base}/:id`, auth, async (req, res) => {
    const db = await store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id && x.ownerId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // eventId is fixed at creation time - editing never moves an item to another event.
    db[resource][idx] = { ...db[resource][idx], ...req.body, id: req.params.id, ownerId: req.user.id, eventId: db[resource][idx].eventId };
    await store.save(db);
    res.json(db[resource][idx]);
  });

  app.delete(`${base}/:id`, auth, async (req, res) => {
    const db = await store.load();
    const idx = db[resource].findIndex((x) => x.id === req.params.id && x.ownerId === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const [removed] = db[resource].splice(idx, 1);
    await store.save(db);
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
  const chars = '0123456789';
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

  // A one-off attention cue, not part of the persisted live state - it
  // should never replay when a singer reconnects or joins mid-flash.
  socket.on('player:flash', () => {
    if (socket.data.role !== 'player' || !socket.data.code) return;
    socket.to(`session:${socket.data.code}`).emit('singer:flash');
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
