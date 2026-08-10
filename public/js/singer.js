(function () {
  const socket = io();

  const REPLIES = ["Got it", "Repeat please", "Can't hear you", "Slower please", "Louder please", "One more minute"];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const joinScreen = document.getElementById('joinScreen');
  const liveScreen = document.getElementById('liveScreen');
  const joinForm = document.getElementById('joinForm');
  const codeInput = document.getElementById('codeInput');
  const joinError = document.getElementById('joinError');
  const leaveBtn = document.getElementById('leaveBtn');
  const display = document.getElementById('display');
  const replyBar = document.getElementById('replyBar');
  const replyBarWrap = document.getElementById('replyBarWrap');
  const playerStatusBanner = document.getElementById('playerStatusBanner');
  const flashOverlay = document.getElementById('flashOverlay');
  const singerFontUpBtn = document.getElementById('singerFontUpBtn');
  const singerFontDownBtn = document.getElementById('singerFontDownBtn');
  const openQueueBtn = document.getElementById('openQueueBtn');
  const closeQueueBtn = document.getElementById('closeQueueBtn');
  const queueModal = document.getElementById('queueModal');
  const singerQueueList = document.getElementById('singerQueueList');

  const singerToggleAuthBtn = document.getElementById('singerToggleAuthBtn');
  const singerGoogleLoginBtn = document.getElementById('singerGoogleLoginBtn');
  const singerAuthForms = document.getElementById('singerAuthForms');
  const singerLoggedOutBox = document.getElementById('singerLoggedOutBox');
  const singerLoggedInBox = document.getElementById('singerLoggedInBox');
  const singerLoggedInAs = document.getElementById('singerLoggedInAs');
  const singerLoginForm = document.getElementById('singerLoginForm');
  const singerLoginUsername = document.getElementById('singerLoginUsername');
  const singerLoginPassword = document.getElementById('singerLoginPassword');
  const singerAuthError = document.getElementById('singerAuthError');
  const singerShowRegisterBtn = document.getElementById('singerShowRegisterBtn');
  const singerForgotPasswordBtn = document.getElementById('singerForgotPasswordBtn');
  const singerForgotPasswordBox = document.getElementById('singerForgotPasswordBox');
  const singerForgotPasswordForm = document.getElementById('singerForgotPasswordForm');
  const singerForgotUsername = document.getElementById('singerForgotUsername');
  const singerForgotPasswordMsg = document.getElementById('singerForgotPasswordMsg');
  const singerRegisterForm = document.getElementById('singerRegisterForm');
  const singerRegisterUsername = document.getElementById('singerRegisterUsername');
  const singerRegisterPassword = document.getElementById('singerRegisterPassword');
  const singerRegisterEmail = document.getElementById('singerRegisterEmail');
  const singerRegisterError = document.getElementById('singerRegisterError');
  const singerLogoutBtn = document.getElementById('singerLogoutBtn');
  const singerAccountEmailInput = document.getElementById('singerAccountEmailInput');
  const singerSaveEmailBtn = document.getElementById('singerSaveEmailBtn');
  const singerEmailSettingsMsg = document.getElementById('singerEmailSettingsMsg');
  const singerCustomRepliesList = document.getElementById('singerCustomRepliesList');
  const newReplyText = document.getElementById('newReplyText');
  const addReplyBtn = document.getElementById('addReplyBtn');

  const SESSION_KEY = 'stagecue_singer_code';

  // Text size is local to this screen only - the keyboard player has no say in
  // it, and it's never sent anywhere. Persisted so it survives a refresh.
  const FONT_SCALES = ['small', 'normal', 'large', 'xlarge'];
  let fontScale = localStorage.getItem('stagecue_singer_font_scale') || 'normal';

  function applyFontScale() {
    FONT_SCALES.forEach((s) => display.classList.remove('scale-' + s));
    display.classList.add('scale-' + fontScale);
  }

  singerFontUpBtn.addEventListener('click', () => {
    const i = Math.min(FONT_SCALES.length - 1, FONT_SCALES.indexOf(fontScale) + 1);
    fontScale = FONT_SCALES[i];
    localStorage.setItem('stagecue_singer_font_scale', fontScale);
    applyFontScale();
  });
  singerFontDownBtn.addEventListener('click', () => {
    const i = Math.max(0, FONT_SCALES.indexOf(fontScale) - 1);
    fontScale = FONT_SCALES[i];
    localStorage.setItem('stagecue_singer_font_scale', fontScale);
    applyFontScale();
  });
  applyFontScale();

  function flashReplySent(btn) {
    btn.classList.add('btn-primary');
    setTimeout(() => btn.classList.remove('btn-primary'), 400);
  }

  // An account is entirely optional here - it only exists so a singer can save
  // their own quick replies (shown alongside the fixed defaults) across sessions.
  let singerUser = null;
  let customReplies = [];

  async function apiCall(url, opts) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    return { ok: res.ok, data: await res.json() };
  }

  function renderReplyBar() {
    replyBar.innerHTML = '';
    [...REPLIES, ...customReplies.map((r) => r.text)].forEach((text) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        socket.emit('singer:react', text);
        flashReplySent(btn);
      });
      replyBar.appendChild(btn);
    });
    updateReplyScrollFade();
  }
  renderReplyBar();

  // Shows a fade at the bottom of the reply bar whenever it's scrolled
  // somewhere other than the end, hinting that more replies exist below.
  function updateReplyScrollFade() {
    const atEnd = replyBar.scrollTop + replyBar.clientHeight >= replyBar.scrollHeight - 2;
    replyBarWrap.classList.toggle('at-end', atEnd);
  }
  replyBar.addEventListener('scroll', updateReplyScrollFade);

  function renderCustomRepliesList() {
    singerCustomRepliesList.innerHTML = '';
    if (customReplies.length === 0) {
      singerCustomRepliesList.innerHTML = '<li class="muted">None yet.</li>';
      return;
    }
    customReplies.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `<div class="info"><strong>${escapeHtml(r.text)}</strong></div>
        <div class="actions"><button class="btn btn-small btn-danger" data-act="del">Del</button></div>`;
      li.querySelector('[data-act="del"]').addEventListener('click', async () => {
        await apiCall(`/api/singer/replies/${r.id}`, { method: 'DELETE' });
        customReplies = customReplies.filter((x) => x.id !== r.id);
        renderCustomRepliesList();
        renderReplyBar();
      });
      singerCustomRepliesList.appendChild(li);
    });
  }

  function showSingerLoggedIn(user) {
    singerUser = user;
    singerLoggedInAs.textContent = user.username;
    singerAccountEmailInput.value = user.email || '';
    singerLoggedOutBox.classList.add('hidden');
    singerLoggedInBox.classList.remove('hidden');
  }

  async function loadCustomReplies() {
    const { ok, data } = await apiCall('/api/singer/replies');
    if (ok) {
      customReplies = data;
      renderCustomRepliesList();
      renderReplyBar();
    }
  }

  singerToggleAuthBtn.addEventListener('click', () => singerAuthForms.classList.toggle('hidden'));
  singerShowRegisterBtn.addEventListener('click', () => {
    singerLoginForm.classList.add('hidden');
    singerRegisterForm.classList.remove('hidden');
  });

  singerLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    singerAuthError.classList.add('hidden');
    const { ok, data } = await apiCall('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: singerLoginUsername.value.trim(), password: singerLoginPassword.value }),
    });
    if (!ok) {
      singerAuthError.textContent = data.error || 'Could not log in.';
      singerAuthError.classList.remove('hidden');
      return;
    }
    showSingerLoggedIn(data.user);
    await loadCustomReplies();
  });

  singerRegisterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    singerRegisterError.classList.add('hidden');
    const { ok, data } = await apiCall('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: singerRegisterUsername.value.trim(), password: singerRegisterPassword.value, email: singerRegisterEmail.value.trim(), role: 'singer' }),
    });
    if (!ok) {
      singerRegisterError.textContent = data.error || 'Could not register.';
      singerRegisterError.classList.remove('hidden');
      return;
    }
    showSingerLoggedIn(data.user);
    await loadCustomReplies();
  });

  singerLogoutBtn.addEventListener('click', async () => {
    await apiCall('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  singerForgotPasswordBtn.addEventListener('click', () => {
    singerForgotPasswordBox.classList.toggle('hidden');
  });

  singerForgotPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    singerForgotPasswordMsg.classList.add('hidden');
    const { data } = await apiCall('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: singerForgotUsername.value.trim() }),
    });
    singerForgotPasswordMsg.textContent = (data && data.message) || 'If that account has a recovery email on file, a reset link has been sent.';
    singerForgotPasswordMsg.classList.remove('hidden');
    singerForgotUsername.value = '';
  });

  singerSaveEmailBtn.addEventListener('click', async () => {
    singerEmailSettingsMsg.classList.add('hidden');
    const { ok, data } = await apiCall('/api/auth/email', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: singerAccountEmailInput.value.trim() }),
    });
    singerEmailSettingsMsg.textContent = ok ? 'Saved.' : ((data && data.error) || 'Could not save email.');
    singerEmailSettingsMsg.classList.remove('hidden');
  });

  addReplyBtn.addEventListener('click', async () => {
    const text = newReplyText.value.trim();
    if (!text) return;
    const { ok, data } = await apiCall('/api/singer/replies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (!ok) return;
    customReplies.push(data);
    newReplyText.value = '';
    renderCustomRepliesList();
    renderReplyBar();
  });

  fetch('/api/config', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.googleEnabled) singerGoogleLoginBtn.classList.remove('hidden');
      if (cfg.passwordResetEnabled) singerForgotPasswordBtn.classList.remove('hidden');
    })
    .catch(() => {});

  (async () => {
    const { data } = await apiCall('/api/auth/me');
    if (data.user && data.user.role === 'singer') {
      showSingerLoggedIn(data.user);
      await loadCustomReplies();
    }
  })();

  function showLive(state) {
    joinScreen.classList.add('hidden');
    liveScreen.classList.remove('hidden');
    applyState(state);
  }

  function joinWithCode(code, onFail) {
    socket.emit('singer:join', code, (ack) => {
      if (!ack || !ack.ok) {
        onFail(ack && ack.error);
        return;
      }
      localStorage.setItem(SESSION_KEY, code);
      showLive(ack.state);
    });
  }

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return;
    joinError.classList.add('hidden');
    joinWithCode(code, (error) => {
      joinError.textContent = error || 'Could not connect.';
      joinError.classList.remove('hidden');
    });
  });

  leaveBtn.addEventListener('click', () => {
    if (!confirm('Leave the session?')) return;
    localStorage.removeItem(SESSION_KEY);
    socket.disconnect();
    location.reload();
  });

  socket.on('state:update', (state) => {
    playerStatusBanner.classList.add('hidden');
    applyState(state);
  });

  socket.on('session:ended', () => {
    localStorage.removeItem(SESSION_KEY);
    alert('The keyboard player ended the session.');
    location.reload();
  });

  socket.on('player:disconnected', () => playerStatusBanner.classList.remove('hidden'));
  socket.on('player:reconnected', () => playerStatusBanner.classList.add('hidden'));

  socket.on('singer:flash', () => {
    flashOverlay.classList.remove('flashing');
    void flashOverlay.offsetWidth; // restart the animation if triggered again quickly
    flashOverlay.classList.add('flashing');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  });

  // A code in the URL (from a scanned QR code) takes priority over any
  // saved session - it's a deliberate fresh join. Read once and strip it
  // from the URL so a later page refresh falls back to the normal
  // saved-session resume instead of re-trying a possibly stale code.
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) history.replaceState(null, '', location.pathname);

  // Runs on first connect AND every automatic reconnect after a dropped
  // connection - rejoins the session we were already in instead of getting stuck.
  socket.on('connect', () => {
    const dot = document.querySelector('#connStatus .status-dot');
    if (dot) dot.classList.add('online');

    if (urlCode && liveScreen.classList.contains('hidden')) {
      joinWithCode(urlCode.toUpperCase(), (error) => {
        joinError.textContent = error || 'Could not connect.';
        joinError.classList.remove('hidden');
      });
      return;
    }

    const saved = localStorage.getItem(SESSION_KEY);
    if (saved && liveScreen.classList.contains('hidden')) {
      joinWithCode(saved, () => localStorage.removeItem(SESSION_KEY));
    }
  });

  socket.on('disconnect', () => {
    const dot = document.querySelector('#connStatus .status-dot');
    if (dot) dot.classList.remove('online');
  });

  function applyState(state) {
    if (!state) return;

    applyFontScale();
    display.innerHTML = '';
    let shownSomething = false;

    if (state.message) {
      const banner = document.createElement('div');
      banner.className = 'message-banner';
      const p = document.createElement('p');
      p.className = 'message-text';
      p.textContent = state.message;
      banner.appendChild(p);
      display.appendChild(banner);
      shownSomething = true;
    }

    if (state.song) {
      const wrap = document.createElement('div');
      wrap.className = 'lyrics-block';

      const title = document.createElement('div');
      title.className = 'song-title';
      title.textContent = state.song.title;
      wrap.appendChild(title);

      if (state.song.artist) {
        const artist = document.createElement('div');
        artist.className = 'song-artist';
        artist.textContent = state.song.artist;
        wrap.appendChild(artist);
      }

      const metaParts = [];
      if (state.song.key) metaParts.push(`Key: ${state.song.key}`);
      if (state.song.bpm) metaParts.push(`${state.song.bpm} BPM`);
      if (metaParts.length) {
        const meta = document.createElement('div');
        meta.className = 'song-meta';
        meta.textContent = metaParts.join(' · ');
        wrap.appendChild(meta);
      }

      state.song.lines.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = 'lyric-line' + (idx === state.highlightLine ? ' active' : '');
        div.textContent = line || ' ';
        wrap.appendChild(div);
      });

      display.appendChild(wrap);
      shownSomething = true;

      const active = wrap.querySelector('.lyric-line.active');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (!shownSomething) {
      const p = document.createElement('p');
      p.className = 'waiting';
      p.textContent = 'Waiting for the keyboard player...';
      display.appendChild(p);
    }

    renderSingerQueue(state.queue);
  }

  // The player stays the source of truth - these buttons just ask it to
  // jump/reorder, and the resulting state:update is what actually updates
  // this list (including for every other singer watching the same show).
  function renderSingerQueue(queueData) {
    singerQueueList.innerHTML = '';
    if (!queueData || queueData.length === 0) {
      singerQueueList.innerHTML = '<li class="muted">Queue is empty.</li>';
      return;
    }
    queueData.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'entity-item queue-item' + (item.current ? ' current' : '');
      li.innerHTML = `
        <div class="info"><strong>${idx + 1}. ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist || '')}</span></div>
        <div class="actions">
          ${idx > 0 ? '<button class="btn btn-small" data-act="top">Top</button>' : ''}
          <button class="btn btn-small btn-primary" data-act="jump">Play</button>
        </div>`;
      const topBtn = li.querySelector('[data-act="top"]');
      if (topBtn) topBtn.addEventListener('click', () => socket.emit('singer:queueMoveTop', item.id));
      li.querySelector('[data-act="jump"]').addEventListener('click', () => socket.emit('singer:queueJump', item.id));
      singerQueueList.appendChild(li);
    });
  }

  openQueueBtn.addEventListener('click', () => queueModal.classList.remove('hidden'));
  closeQueueBtn.addEventListener('click', () => queueModal.classList.add('hidden'));
})();
