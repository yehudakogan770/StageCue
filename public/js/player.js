(function () {
  const socket = io();

  let songs = [];
  let playlists = [];
  let presets = [];
  let queue = []; // array of song ids
  let currentIndex = -1;
  let sessionCode = null;
  let singerCount = 0;
  let currentUser = null;
  let currentEventId = null;
  let currentEventName = null;
  let allowSingerLibrary = true;
  let singerLibrarySongs = []; // songs the connected singer shared, if any

  // song and message are independent - either, both, or neither can be showing at once.
  let liveState = { message: '', song: null, highlightLine: -1 };
  // Text size is a local, per-person preference - never sent to the singer.
  const FONT_SCALES = ['small', 'normal', 'large', 'xlarge'];

  // ---------- API helpers ----------
  async function apiGet(url) { return (await fetch(url, { credentials: 'same-origin' })).json(); }
  async function apiPost(url, body) {
    return (await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }
  async function apiPut(url, body) {
    return (await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }
  async function apiDelete(url) {
    return (await fetch(url, { method: 'DELETE', credentials: 'same-origin' })).json();
  }

  // Queue items can come from either the player's own library or a song the
  // singer shared - both resolve through here so the rest of the queue code
  // (sendSongToSinger, findSong-based lookups, etc.) doesn't need to care.
  function findSong(id) { return songs.find((s) => s.id === id) || singerLibrarySongs.find((s) => s.id === id); }

  function songKeyBpmLine(song) {
    const parts = [];
    if (song.key) parts.push(`Key: ${song.key}`);
    if (song.bpm) parts.push(`${song.bpm} BPM`);
    return parts.join(' · ');
  }

  // ---------- Undo toast ----------
  // Deletes are soft on the server (a restore endpoint just clears
  // deletedAt), so this is a real undo, not a "recreate a lookalike" hack.
  // Only one toast at a time - a second delete just replaces it.
  let undoToastTimeout = null;
  let undoToastHandler = null;
  function showUndoToast(message, onUndo) {
    clearTimeout(undoToastTimeout);
    if (undoToastHandler) undoToastBtn.removeEventListener('click', undoToastHandler);
    undoToastMsg.textContent = message;
    undoToast.classList.remove('hidden');
    undoToastHandler = async () => {
      undoToast.classList.add('hidden');
      undoToastBtn.removeEventListener('click', undoToastHandler);
      undoToastHandler = null;
      await onUndo();
    };
    undoToastBtn.addEventListener('click', undoToastHandler);
    undoToastTimeout = setTimeout(() => {
      undoToast.classList.add('hidden');
      if (undoToastHandler) undoToastBtn.removeEventListener('click', undoToastHandler);
      undoToastHandler = null;
    }, 6000);
  }

  // ---------- DOM refs ----------
  const authScreen = document.getElementById('authScreen');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const authError = document.getElementById('authError');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  const forgotPasswordBox = document.getElementById('forgotPasswordBox');
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotUsername = document.getElementById('forgotUsername');
  const forgotPasswordMsg = document.getElementById('forgotPasswordMsg');
  const registerCard = document.getElementById('registerCard');
  const registerForm = document.getElementById('registerForm');
  const registerUsername = document.getElementById('registerUsername');
  const registerPassword = document.getElementById('registerPassword');
  const registerEmail = document.getElementById('registerEmail');
  const registerError = document.getElementById('registerError');
  const showLoginBtn = document.getElementById('showLoginBtn');

  const eventsScreen = document.getElementById('eventsScreen');
  const loggedInAs = document.getElementById('loggedInAs');
  const accountEmailInput = document.getElementById('accountEmailInput');
  const saveEmailBtn = document.getElementById('saveEmailBtn');
  const emailSettingsMsg = document.getElementById('emailSettingsMsg');
  const createEventForm = document.getElementById('createEventForm');
  const newEventName = document.getElementById('newEventName');
  const eventsError = document.getElementById('eventsError');
  const eventsList = document.getElementById('eventsList');
  const eventsLogoutBtn = document.getElementById('eventsLogoutBtn');
  const undoToast = document.getElementById('undoToast');
  const undoToastMsg = document.getElementById('undoToastMsg');
  const undoToastBtn = document.getElementById('undoToastBtn');

  const startScreen = document.getElementById('startScreen');
  const startScreenTitle = document.getElementById('startScreenTitle');
  const switchEventBtn = document.getElementById('switchEventBtn');
  const mainScreen = document.getElementById('mainScreen');
  const startBtn = document.getElementById('startBtn');
  const customCodeInput = document.getElementById('customCodeInput');
  const startError = document.getElementById('startError');
  const codeDisplay = document.getElementById('codeDisplay');
  const eventNamePill = document.getElementById('eventNamePill');
  const showQrBtn = document.getElementById('showQrBtn');
  const qrModal = document.getElementById('qrModal');
  const qrImageWrap = document.getElementById('qrImageWrap');
  const qrCodeText = document.getElementById('qrCodeText');
  const closeQrBtn = document.getElementById('closeQrBtn');
  const openSingerLibraryBtn = document.getElementById('openSingerLibraryBtn');
  const closeSingerLibraryBtn = document.getElementById('closeSingerLibraryBtn');
  const singerLibraryModal = document.getElementById('singerLibraryModal');
  const singerLibraryPlayerList = document.getElementById('singerLibraryPlayerList');
  const singerStatus = document.getElementById('singerStatus');
  const playerConnStatus = document.getElementById('playerConnStatus');
  const endSessionBtn = document.getElementById('endSessionBtn');
  const flashSingerBtn = document.getElementById('flashSingerBtn');

  const nowShowing = document.getElementById('nowShowing');
  const nowShowingWrap = document.getElementById('nowShowingWrap');
  const lyricsHiddenNote = document.getElementById('lyricsHiddenNote');
  const clearLyricsBtn = document.getElementById('clearLyricsBtn');
  const hideLyricsBtn = document.getElementById('hideLyricsBtn');
  const clearScreenBtn = document.getElementById('clearScreenBtn');
  const fontUpBtn = document.getElementById('fontUpBtn');
  const fontDownBtn = document.getElementById('fontDownBtn');
  const prevLineBtn = document.getElementById('prevLineBtn');
  const nextLineBtn = document.getElementById('nextLineBtn');

  const currentMessage = document.getElementById('currentMessage');
  const clearMessageBtn = document.getElementById('clearMessageBtn');
  const messageInput = document.getElementById('messageInput');
  const sendMessageBtn = document.getElementById('sendMessageBtn');
  const toggleMessageBtn = document.getElementById('toggleMessageBtn');
  const messageBox = document.getElementById('messageBox');
  const presetGrid = document.getElementById('presetGrid');
  const presetGridWrap = document.getElementById('presetGridWrap');
  const presetGridScroll = document.getElementById('presetGridScroll');
  const sessionInfo = document.getElementById('sessionInfo');
  const sessionInfoWrap = document.getElementById('sessionInfoWrap');

  const nextSongBtn = document.getElementById('nextSongBtn');
  const upNextLabel = document.getElementById('upNextLabel');
  const liveQueueList = document.getElementById('liveQueueList');
  const liveQueueWrap = document.getElementById('liveQueueWrap');

  const playlistLoadSelect = document.getElementById('playlistLoadSelect');
  const loadPlaylistBtn = document.getElementById('loadPlaylistBtn');
  const saveQueueBtn = document.getElementById('saveQueueBtn');
  const printSetlistBtn = document.getElementById('printSetlistBtn');
  const clearQueueBtn = document.getElementById('clearQueueBtn');
  const queueList = document.getElementById('queueList');

  const reactionsFeed = document.getElementById('reactionsFeed');
  const reactionBanner = document.getElementById('reactionBanner');

  const liveScreen = document.getElementById('liveScreen');
  const manageScreen = document.getElementById('manageScreen');
  const manageToggleBtn = document.getElementById('manageToggleBtn');
  const setupLayout = document.getElementById('setupLayout');

  // Phone-only Library/Queue toggle within the setup screen - see the
  // .setup-layout-queue rules in player.css for why this exists (avoids
  // the whole setup screen needing to scroll as one long stacked page).
  document.querySelectorAll('.panel-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.panel-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
      setupLayout.classList.toggle('setup-layout-queue', btn.dataset.panel === 'queue');
    });
  });

  // ---------- Screens ----------
  const ALL_SCREENS = [authScreen, eventsScreen, startScreen, mainScreen];
  function showScreen(screen) {
    ALL_SCREENS.forEach((s) => s.classList.toggle('hidden', s !== screen));
  }

  // ---------- Auth ----------
  function showAuthCard(which) {
    authError.classList.add('hidden');
    registerError.classList.add('hidden');
    document.getElementById('loginForm').closest('.card').classList.toggle('hidden', which !== 'login');
    registerCard.classList.toggle('hidden', which !== 'register');
  }
  showRegisterBtn.addEventListener('click', () => showAuthCard('register'));
  showLoginBtn.addEventListener('click', () => showAuthCard('login'));

  async function afterLogin(user) {
    currentUser = user;
    loggedInAs.textContent = user.username;
    accountEmailInput.value = user.email || '';
    await loadEvents();
    showScreen(eventsScreen);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const res = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      authError.textContent = data.error || 'Could not log in.';
      authError.classList.remove('hidden');
      return;
    }
    await afterLogin(data.user);
  });

  forgotPasswordBtn.addEventListener('click', () => {
    forgotPasswordBox.classList.toggle('hidden');
  });

  forgotPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    forgotPasswordMsg.classList.add('hidden');
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: forgotUsername.value.trim() }),
    });
    const data = await res.json();
    forgotPasswordMsg.textContent = data.message || 'If that account has a recovery email on file, a reset link has been sent.';
    forgotPasswordMsg.classList.remove('hidden');
    forgotUsername.value = '';
  });

  saveEmailBtn.addEventListener('click', async () => {
    emailSettingsMsg.classList.add('hidden');
    const res = await fetch('/api/auth/email', {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: accountEmailInput.value.trim() }),
    });
    const data = await res.json();
    emailSettingsMsg.textContent = res.ok ? 'Saved.' : (data.error || 'Could not save email.');
    emailSettingsMsg.classList.remove('hidden');
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.classList.add('hidden');
    const res = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: registerUsername.value.trim(), password: registerPassword.value, email: registerEmail.value.trim(), role: 'player' }),
    });
    const data = await res.json();
    if (!res.ok) {
      registerError.textContent = data.error || 'Could not register.';
      registerError.classList.remove('hidden');
      return;
    }
    await afterLogin(data.user);
  });

  async function logOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.reload();
  }
  eventsLogoutBtn.addEventListener('click', logOut);

  // ---------- Events ----------
  // Each event has its own completely separate songs, playlists, and presets.
  let eventsCache = [];

  async function loadEvents() {
    eventsCache = await apiGet('/api/events');
    renderEventsList();
  }

  function renderEventsList() {
    eventsList.innerHTML = '';
    if (eventsCache.length === 0) {
      eventsList.innerHTML = '<li class="muted">No events yet. Create one above.</li>';
      return;
    }
    eventsCache.forEach((ev) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(ev.name)}</strong></div>
        <div class="actions">
          <button class="btn btn-small btn-primary" data-act="open">Open</button>
          <button class="btn btn-small btn-danger" data-act="del">Del</button>
        </div>`;
      li.querySelector('[data-act="open"]').addEventListener('click', () => openEvent(ev));
      li.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`Delete event "${ev.name}"? Its songs, playlists, and presets go with it (recoverable together if you undo).`)) return;
        await apiDelete(`/api/events/${ev.id}`);
        eventsCache = eventsCache.filter((e) => e.id !== ev.id);
        renderEventsList();
        showUndoToast(`Deleted event "${ev.name}".`, async () => {
          const restored = await apiPost(`/api/events/${ev.id}/restore`, {});
          eventsCache.push(restored);
          renderEventsList();
        });
      });
      eventsList.appendChild(li);
    });
  }

  createEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    eventsError.classList.add('hidden');
    const name = newEventName.value.trim();
    if (!name) return;
    const created = await apiPost('/api/events', { name });
    if (created.error) {
      eventsError.textContent = created.error;
      eventsError.classList.remove('hidden');
      return;
    }
    eventsCache.push(created);
    newEventName.value = '';
    renderEventsList();
    openEvent(created);
  });

  async function openEvent(ev) {
    currentEventId = ev.id;
    currentEventName = ev.name;
    eventNamePill.textContent = `Event: ${ev.name}`;
    startScreenTitle.textContent = ev.name;
    await loadEventData();
    showScreen(startScreen);
  }

  switchEventBtn.addEventListener('click', async () => {
    currentEventId = null;
    currentEventName = null;
    await loadEvents();
    showScreen(eventsScreen);
  });

  // ---------- Session lifecycle ----------
  const SESSION_KEY = 'stagecue_session_code';
  const SESSION_EVENT_ID_KEY = 'stagecue_session_event_id';
  const SESSION_EVENT_NAME_KEY = 'stagecue_session_event_name';

  // A running, real-time log of this session's songs/reactions, kept for the
  // History tab. The server's live session state only ever holds the CURRENT
  // song, so this has to be built up here as things happen, then submitted
  // once when the session ends. Persisted to localStorage (keyed by session
  // code) so an accidental page refresh mid-show doesn't lose it.
  const SESSION_LOG_KEY = 'stagecue_session_log';
  let sessionStartedAt = null;
  let sessionSongLog = [];
  let sessionReactionLog = [];

  function persistSessionLog() {
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify({ code: sessionCode, startedAt: sessionStartedAt, songs: sessionSongLog, reactions: sessionReactionLog }));
  }

  function restoreOrStartSessionLog(code) {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_LOG_KEY) || 'null');
      if (saved && saved.code === code) {
        sessionStartedAt = saved.startedAt;
        sessionSongLog = saved.songs || [];
        sessionReactionLog = saved.reactions || [];
        return;
      }
    } catch { /* fall through to a fresh log */ }
    sessionStartedAt = Date.now();
    sessionSongLog = [];
    sessionReactionLog = [];
    persistSessionLog();
  }

  function enterSession(code, state) {
    sessionCode = code;
    codeDisplay.textContent = code;
    restoreOrStartSessionLog(code);
    showScreen(mainScreen);
    if (state) liveState = state;
    renderNowShowing();
    renderCurrentMessage();
    renderPresetGrid();
    updateSessionInfoFade();
    pushUpdate({ queue: queuePayload(), library: allowSingerLibrary ? libraryPayload() : [], libraryEnabled: allowSingerLibrary });
    socket.emit('player:requestLibrarySync');
  }

  // Shows a fade at the right edge of the topbar's pill row whenever it's
  // scrolled somewhere other than the end - on narrow phones the row
  // scrolls sideways instead of wrapping to multiple lines.
  function updateSessionInfoFade() {
    const atEnd = sessionInfo.scrollLeft + sessionInfo.clientWidth >= sessionInfo.scrollWidth - 2;
    sessionInfoWrap.classList.toggle('at-end', atEnd);
  }
  sessionInfo.addEventListener('scroll', updateSessionInfoFade);
  window.addEventListener('resize', () => {
    updateSessionInfoFade();
    updateNowShowingFade();
    updateLiveQueueFade();
  });

  showQrBtn.addEventListener('click', async () => {
    if (!sessionCode) return;
    const joinUrl = `${location.origin}/singer?code=${sessionCode}`;
    qrCodeText.textContent = sessionCode;
    qrImageWrap.innerHTML = '<p class="muted">Loading...</p>';
    qrModal.classList.remove('hidden');
    try {
      const svg = await (await fetch(`/api/qr?text=${encodeURIComponent(joinUrl)}`)).text();
      qrImageWrap.innerHTML = svg;
    } catch {
      qrImageWrap.innerHTML = '<p class="muted">Could not load QR code.</p>';
    }
  });
  closeQrBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
  qrModal.addEventListener('click', (e) => { if (e.target === qrModal) qrModal.classList.add('hidden'); });

  flashSingerBtn.addEventListener('click', () => {
    socket.emit('player:flash');
    flashSingerBtn.classList.add('btn-primary');
    const original = flashSingerBtn.textContent;
    flashSingerBtn.textContent = 'Sent!';
    setTimeout(() => {
      flashSingerBtn.classList.remove('btn-primary');
      flashSingerBtn.textContent = original;
    }, 600);
  });

  startBtn.addEventListener('click', () => {
    startError.classList.add('hidden');
    socket.emit('player:create', customCodeInput.value.trim(), (ack) => {
      if (!ack || !ack.ok) {
        startError.textContent = (ack && ack.error) || 'Could not start a session.';
        startError.classList.remove('hidden');
        return;
      }
      localStorage.setItem(SESSION_KEY, ack.code);
      localStorage.setItem(SESSION_EVENT_ID_KEY, currentEventId);
      localStorage.setItem(SESSION_EVENT_NAME_KEY, currentEventName || '');
      enterSession(ack.code, null);
    });
  });

  endSessionBtn.addEventListener('click', async () => {
    if (!confirm('End this session? The singer will be disconnected.')) return;
    if (sessionSongLog.length > 0 || sessionReactionLog.length > 0) {
      try {
        await apiPost(`/api/events/${currentEventId}/history`, {
          startedAt: sessionStartedAt, endedAt: Date.now(), songs: sessionSongLog, reactions: sessionReactionLog,
        });
      } catch { /* history is a nice-to-have - never block ending the session on it */ }
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_EVENT_ID_KEY);
    localStorage.removeItem(SESSION_EVENT_NAME_KEY);
    localStorage.removeItem(SESSION_LOG_KEY);
    socket.disconnect();
    location.reload();
  });

  // Runs on first connect AND every automatic reconnect after a dropped
  // connection - reclaims the in-progress session (and its event's data)
  // instead of losing it or bouncing back to the login/events screens.
  socket.on('connect', () => {
    setConnBadge(true);
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return;
    (async () => {
      const savedEventId = localStorage.getItem(SESSION_EVENT_ID_KEY);
      const savedEventName = localStorage.getItem(SESSION_EVENT_NAME_KEY) || '';
      if (savedEventId && savedEventId !== currentEventId) {
        currentEventId = savedEventId;
        currentEventName = savedEventName;
        eventNamePill.textContent = `Event: ${currentEventName}`;
        await loadEventData();
      }
      socket.emit('player:resume', saved, async (ack) => {
        if (ack && ack.ok) {
          enterSession(ack.code, ack.state);
          return;
        }
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(SESSION_EVENT_ID_KEY);
        localStorage.removeItem(SESSION_EVENT_NAME_KEY);
        localStorage.removeItem(SESSION_LOG_KEY);
        if (sessionCode) {
          // Was already live in this tab and got disconnected mid-show (e.g.
          // the server restarted under it) - reload for a clean, consistent
          // state rather than patching up a half-live screen in place.
          alert('This session could not be recovered after a long disconnect. Please start a new one.');
          location.reload();
          return;
        }
        // A fresh page load (e.g. reopening the app after the server
        // restarted) found no session to resume. The event and its songs/
        // playlists/presets are all still intact in the database - only
        // the live connection needs a fresh code - so go straight to
        // Start Session for this event instead of leaving the screen
        // blank or sending the player all the way back to the events list.
        if (currentEventId) {
          startScreenTitle.textContent = savedEventName || currentEventName || 'Keyboard Player';
          showScreen(startScreen);
        } else {
          await loadEvents();
          showScreen(eventsScreen);
        }
      });
    })();
  });

  socket.on('disconnect', () => setConnBadge(false));

  function setConnBadge(online) {
    if (!sessionCode) return; // don't show anything before a session has started
    playerConnStatus.classList.remove('hidden');
    const dot = playerConnStatus.querySelector('.status-dot');
    dot.classList.toggle('online', online);
    playerConnStatus.lastChild.textContent = online ? ' Connected' : ' Reconnecting...';
  }

  // liveScreen is the performance view (reached via "Go Live"); manageScreen
  // is the setup view (songs/playlists/presets/queue), shown by default so the
  // singer can already be connected and ready before the show actually starts.
  manageToggleBtn.addEventListener('click', () => {
    const goingToManage = liveScreen.classList.contains('hidden') === false;
    liveScreen.classList.toggle('hidden', goingToManage);
    manageScreen.classList.toggle('hidden', !goingToManage);
    manageToggleBtn.textContent = goingToManage ? 'Go Live' : 'Edit Setup';
  });

  socket.on('singer:joined', ({ count }) => {
    singerCount = count;
    const dot = singerStatus.querySelector('.status-dot');
    if (count > 0) {
      dot.classList.add('online');
      singerStatus.lastChild.textContent = count === 1 ? ' Singer connected' : ` ${count} singers connected`;
    } else {
      dot.classList.remove('online');
      singerStatus.lastChild.textContent = ' Singer not connected';
    }
  });

  // The singer only ever requests these - the player applies them locally
  // (same code path as its own buttons) and the resulting persistQueue()
  // call re-broadcasts the updated queue back out to everyone.
  socket.on('singer:queueJump', (songId) => {
    const idx = queue.indexOf(songId);
    if (idx < 0) return;
    sendSongToSinger(idx);
  });

  socket.on('singer:queueMoveTop', (songId) => {
    const idx = queue.indexOf(songId);
    if (idx <= 0) return;
    moveQueueItemToTop(idx);
  });

  socket.on('singer:queueAdd', (songId) => {
    if (!allowSingerLibrary || !findSong(songId)) return;
    addToQueue(songId);
  });

  socket.on('singer:queueRemove', (songId) => {
    const idx = queue.indexOf(songId);
    if (idx < 0) return;
    removeFromQueue(idx);
  });

  // The singer's own shared library - it lives only in this socket
  // connection's memory (not session.state), so a page reload asks for a
  // fresh copy via player:requestLibrarySync in enterSession().
  socket.on('singer:librarySync', (sharedSongs) => {
    singerLibrarySongs = Array.isArray(sharedSongs) ? sharedSongs : [];
    renderSingerLibraryPlayerList();
  });

  function renderSingerLibraryPlayerList() {
    openSingerLibraryBtn.classList.toggle('hidden', singerLibrarySongs.length === 0);
    singerLibraryPlayerList.innerHTML = '';
    if (singerLibrarySongs.length === 0) {
      singerLibraryPlayerList.innerHTML = '<li class="muted">The singer hasn\'t shared any songs.</li>';
      return;
    }
    singerLibrarySongs.forEach((song) => {
      const inQueue = queue.includes(song.id);
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(songKeyBpmLine(song))}${song.artist ? ` · ${escapeHtml(song.artist)}` : ''}</span></div>
        <div class="actions">
          <button class="btn btn-small" data-act="add" ${inQueue ? 'disabled' : ''}>${inQueue ? 'In Queue' : 'Queue'}</button>
        </div>`;
      const addBtn = li.querySelector('[data-act="add"]');
      if (!inQueue) addBtn.addEventListener('click', () => { addToQueue(song.id); renderSingerLibraryPlayerList(); });
      singerLibraryPlayerList.appendChild(li);
    });
  }

  openSingerLibraryBtn.addEventListener('click', () => singerLibraryModal.classList.remove('hidden'));
  closeSingerLibraryBtn.addEventListener('click', () => singerLibraryModal.classList.add('hidden'));

  socket.on('singer:suggestion', ({ title, artist, at }) => {
    if (reactionsFeed.dataset.empty === 'true') {
      reactionsFeed.innerHTML = '';
      reactionsFeed.dataset.empty = 'false';
    }
    const li = document.createElement('li');
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span>&#128161; Suggests: <strong>${escapeHtml(title)}</strong>${artist ? ` &mdash; ${escapeHtml(artist)}` : ''}</span><span class="time">${time}</span>`;
    reactionsFeed.prepend(li);
    while (reactionsFeed.children.length > 25) reactionsFeed.removeChild(reactionsFeed.lastChild);
  });

  socket.on('singer:reaction', ({ text, at }) => {
    if (reactionsFeed.dataset.empty === 'true') {
      reactionsFeed.innerHTML = '';
      reactionsFeed.dataset.empty = 'false';
    }
    const li = document.createElement('li');
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span>${escapeHtml(text)}</span><span class="time">${time}</span>`;
    reactionsFeed.prepend(li);
    while (reactionsFeed.children.length > 25) reactionsFeed.removeChild(reactionsFeed.lastChild);

    // Each reaction gets its own banner line with its own timer, so several
    // sent in quick succession all stay visible instead of a newer one
    // silently cutting an older one's display time short.
    const item = document.createElement('div');
    item.className = 'reaction-banner-item';
    item.textContent = `Singer: ${text}`;
    reactionBanner.prepend(item);
    reactionBanner.classList.remove('hidden');
    setTimeout(() => {
      item.remove();
      if (!reactionBanner.children.length) reactionBanner.classList.add('hidden');
    }, 4000);

    sessionReactionLog.push({ text, at });
    persistSessionLog();
  });
  reactionsFeed.dataset.empty = 'true';

  // ---------- Live state sync ----------
  // song and message are independent: pushing one never touches the other.
  function pushUpdate(partial) {
    liveState = { ...liveState, ...partial };
    socket.emit('player:update', partial);
    renderNowShowing();
    renderCurrentMessage();
    if ('song' in partial) renderPresetGrid(); // song presets depend on the current song
  }

  // Hiding lyrics only affects this screen - it never touches liveState, so the
  // singer's screen is completely unaffected by it.
  let lyricsHiddenLocally = localStorage.getItem('stagecue_lyrics_hidden') === 'true';

  function updateHideLyricsBtn() {
    hideLyricsBtn.textContent = lyricsHiddenLocally ? 'Show Lyrics' : 'Hide Lyrics';
  }
  updateHideLyricsBtn();

  hideLyricsBtn.addEventListener('click', () => {
    lyricsHiddenLocally = !lyricsHiddenLocally;
    localStorage.setItem('stagecue_lyrics_hidden', String(lyricsHiddenLocally));
    updateHideLyricsBtn();
    renderNowShowing();
  });

  function renderNowShowing() {
    // Prev/Next Line stay enabled by song presence alone, regardless of the
    // hide-lyrics toggle, so the player can still cue lines from memory.
    prevLineBtn.disabled = !liveState.song;
    nextLineBtn.disabled = !liveState.song;

    liveScreen.classList.toggle('lyrics-hidden', lyricsHiddenLocally);

    if (lyricsHiddenLocally) {
      nowShowing.innerHTML = '';
      nowShowing.classList.add('hidden');
      lyricsHiddenNote.classList.remove('hidden');
      updateNowShowingFade();
      return;
    }
    nowShowing.classList.remove('hidden');
    lyricsHiddenNote.classList.add('hidden');

    nowShowing.innerHTML = '';

    if (!liveState.song) {
      nowShowing.innerHTML = '<p class="muted">No song selected.</p>';
      updateNowShowingFade();
      return;
    }

    const title = document.createElement('div');
    title.className = 'song-title';
    title.textContent = liveState.song.title;
    nowShowing.appendChild(title);

    if (liveState.song.artist) {
      const artist = document.createElement('div');
      artist.className = 'song-artist';
      artist.textContent = liveState.song.artist;
      nowShowing.appendChild(artist);
    }

    const metaParts = [];
    if (liveState.song.key) metaParts.push(`Key: ${liveState.song.key}`);
    if (liveState.song.bpm) metaParts.push(`${liveState.song.bpm} BPM`);
    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'song-meta';
      meta.textContent = metaParts.join(' · ');
      nowShowing.appendChild(meta);
    }

    liveState.song.lines.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'lyric-line' + (idx === liveState.highlightLine ? ' active' : '');
      div.textContent = line || ' ';
      div.addEventListener('click', () => pushUpdate({ highlightLine: idx }));
      nowShowing.appendChild(div);
    });
    updateNowShowingFade();
  }

  // Shows a fade at the bottom of the lyrics box whenever it's scrolled
  // somewhere other than the end, hinting that more lines exist below
  // instead of hard-clipping the last visible line.
  function updateNowShowingFade() {
    const atEnd = nowShowing.scrollTop + nowShowing.clientHeight >= nowShowing.scrollHeight - 2;
    nowShowingWrap.classList.toggle('at-end', atEnd);
  }
  nowShowing.addEventListener('scroll', updateNowShowingFade);

  function renderCurrentMessage() {
    if (liveState.message) {
      currentMessage.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'msg-preview';
      p.textContent = liveState.message;
      currentMessage.appendChild(p);
    } else {
      currentMessage.innerHTML = '<p class="muted">No message showing.</p>';
    }
  }

  prevLineBtn.addEventListener('click', () => {
    if (!liveState.song) return;
    const prev = Math.max(-1, liveState.highlightLine - 1);
    pushUpdate({ highlightLine: prev });
  });
  nextLineBtn.addEventListener('click', () => {
    if (!liveState.song) return;
    const next = Math.min(liveState.song.lines.length - 1, liveState.highlightLine + 1);
    pushUpdate({ highlightLine: next });
  });

  clearLyricsBtn.addEventListener('click', () => pushUpdate({ song: null, highlightLine: -1 }));
  clearMessageBtn.addEventListener('click', () => pushUpdate({ message: '' }));
  clearScreenBtn.addEventListener('click', () => {
    currentIndex = -1;
    persistQueue();
    renderQueue();
    pushUpdate({ message: '', song: null, highlightLine: -1 });
  });

  // The player's own text size - purely local (localStorage), affects only
  // how big the Lyrics/Message boxes look on THIS screen. Never sent to the singer.
  let playerFontScale = localStorage.getItem('stagecue_player_font_scale') || 'normal';

  function applyPlayerFontScale() {
    FONT_SCALES.forEach((s) => {
      nowShowing.classList.remove('text-scale-' + s);
      currentMessage.classList.remove('text-scale-' + s);
    });
    nowShowing.classList.add('text-scale-' + playerFontScale);
    currentMessage.classList.add('text-scale-' + playerFontScale);
    updateNowShowingFade();
  }
  applyPlayerFontScale();

  fontUpBtn.addEventListener('click', () => {
    const i = Math.min(FONT_SCALES.length - 1, FONT_SCALES.indexOf(playerFontScale) + 1);
    playerFontScale = FONT_SCALES[i];
    localStorage.setItem('stagecue_player_font_scale', playerFontScale);
    applyPlayerFontScale();
  });
  fontDownBtn.addEventListener('click', () => {
    const i = Math.max(0, FONT_SCALES.indexOf(playerFontScale) - 1);
    playerFontScale = FONT_SCALES[i];
    localStorage.setItem('stagecue_player_font_scale', playerFontScale);
    applyPlayerFontScale();
  });

  // ---------- Messages & presets ----------
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    pushUpdate({ message: text });
    messageInput.value = '';
    messageBox.classList.add('hidden');
  }
  sendMessageBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  toggleMessageBtn.addEventListener('click', () => {
    messageBox.classList.toggle('hidden');
    if (!messageBox.classList.contains('hidden')) messageInput.focus();
  });

  // Shows the global default presets plus (if a song is currently loaded)
  // that song's own quick messages, visually marked so it's clear which is which.
  function renderPresetGrid() {
    presetGrid.innerHTML = '';
    const songPresets = (liveState.song && liveState.song.presets) || [];
    presets.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = p.label;
      btn.addEventListener('click', () => pushUpdate({ message: p.message }));
      presetGrid.appendChild(btn);
    });
    songPresets.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'btn preset-song-specific';
      btn.title = 'Quick message for this song';
      btn.textContent = p.label;
      btn.addEventListener('click', () => pushUpdate({ message: p.message }));
      presetGrid.appendChild(btn);
    });
    updatePresetScrollFade();
  }

  // Shows a fade at the bottom of the preset grid whenever it's scrolled
  // somewhere other than the end, hinting that more presets exist below.
  function updatePresetScrollFade() {
    const atEnd = presetGridScroll.scrollTop + presetGridScroll.clientHeight >= presetGridScroll.scrollHeight - 2;
    presetGridWrap.classList.toggle('at-end', atEnd);
  }
  presetGridScroll.addEventListener('scroll', updatePresetScrollFade);

  // ---------- Queue ----------
  // Namespaced per-event so switching events doesn't mix up their queues.
  function persistQueue() {
    localStorage.setItem(`stagecue_queue_${currentEventId}`, JSON.stringify(queue));
    localStorage.setItem(`stagecue_currentIndex_${currentEventId}`, String(currentIndex));
    if (sessionCode) pushUpdate({ queue: queuePayload() });
  }

  // Lightweight shape for the singer's queue view - it only ever sees
  // titles/artists, never the full song library.
  function queuePayload() {
    return queue.map((songId, idx) => {
      const song = findSong(songId);
      if (!song) return null;
      return { id: song.id, title: song.title, artist: song.artist || '', current: idx === currentIndex };
    }).filter(Boolean);
  }

  // Lets the singer browse the whole library (not just what's already
  // queued) so they can build the queue themselves, not only reorder it -
  // but only when the player has opted in via allowSingerLibraryToggle.
  function libraryPayload() {
    return songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist || '' }));
  }
  function syncLibraryToSinger() {
    if (sessionCode) pushUpdate({ library: allowSingerLibrary ? libraryPayload() : [], libraryEnabled: allowSingerLibrary });
  }

  const allowSingerLibraryToggle = document.getElementById('allowSingerLibraryToggle');
  allowSingerLibraryToggle.addEventListener('change', () => {
    allowSingerLibrary = allowSingerLibraryToggle.checked;
    localStorage.setItem(`stagecue_allowSingerLibrary_${currentEventId}`, String(allowSingerLibrary));
    syncLibraryToSinger();
  });

  function restoreQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(`stagecue_queue_${currentEventId}`) || '[]');
      queue = q.filter((id) => findSong(id));
      currentIndex = parseInt(localStorage.getItem(`stagecue_currentIndex_${currentEventId}`) || '-1', 10);
      if (currentIndex >= queue.length) currentIndex = -1;
    } catch {
      queue = [];
      currentIndex = -1;
    }
    const savedAllow = localStorage.getItem(`stagecue_allowSingerLibrary_${currentEventId}`);
    allowSingerLibrary = savedAllow === null ? true : savedAllow === 'true';
    allowSingerLibraryToggle.checked = allowSingerLibrary;
  }

  function renderQueue() {
    queueList.innerHTML = '';
    if (queue.length === 0) {
      queueList.innerHTML = '<li class="muted">Queue is empty. Add songs from the Library tab.</li>';
    } else {
      queue.forEach((songId, idx) => {
        const song = findSong(songId);
        if (!song) return;
        const li = document.createElement('li');
        li.className = 'queue-item' + (idx === currentIndex ? ' current' : '');
        li.innerHTML = `
          <span class="drag-handle" title="Drag to reorder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
          </span>
          <div class="info"><strong>${idx + 1}. ${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || '')}</span></div>
          <div class="actions">
            ${idx > 0 ? '<button class="btn btn-small" data-act="top" title="Move to top of queue">Top</button>' : ''}
            <button class="btn btn-small" data-act="up">&uarr;</button>
            <button class="btn btn-small" data-act="down">&darr;</button>
            <button class="btn btn-small btn-primary" data-act="send">Send</button>
            <button class="btn btn-small btn-danger" data-act="remove">&times;</button>
          </div>`;
        const topBtn = li.querySelector('[data-act="top"]');
        if (topBtn) topBtn.addEventListener('click', () => moveQueueItemToTop(idx));
        li.querySelector('[data-act="up"]').addEventListener('click', () => moveQueueItem(idx, -1));
        li.querySelector('[data-act="down"]').addEventListener('click', () => moveQueueItem(idx, 1));
        li.querySelector('[data-act="send"]').addEventListener('click', () => sendSongToSinger(idx));
        li.querySelector('[data-act="remove"]').addEventListener('click', () => removeFromQueue(idx));
        li.querySelector('.drag-handle').addEventListener('pointerdown', (e) => startQueueDrag(e, idx));
        queueList.appendChild(li);
      });
    }
    renderUpNext();
    renderLiveQueueList();
  }

  // Compact, tap-to-send version of the queue for the Live screen - no
  // reorder/remove controls (those stay in Setup), just "tap it, it plays now".
  function renderLiveQueueList() {
    liveQueueList.innerHTML = '';
    if (queue.length === 0) {
      liveQueueList.innerHTML = '<li class="muted">Queue is empty. Add songs in Setup.</li>';
      updateLiveQueueFade();
      return;
    }
    queue.forEach((songId, idx) => {
      const song = findSong(songId);
      if (!song) return;
      const li = document.createElement('li');
      li.className = 'queue-item tappable' + (idx === currentIndex ? ' current' : '');
      li.innerHTML = `<div class="info"><strong>${idx + 1}. ${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || '')}</span></div>`;
      li.addEventListener('click', () => sendSongToSinger(idx));
      liveQueueList.appendChild(li);
    });
    updateLiveQueueFade();
  }

  // Shows a fade at the bottom of the playlist whenever it's scrolled
  // somewhere other than the end, hinting that more songs exist below
  // instead of hard-clipping the last visible item.
  function updateLiveQueueFade() {
    const atEnd = liveQueueList.scrollTop + liveQueueList.clientHeight >= liveQueueList.scrollHeight - 2;
    liveQueueWrap.classList.toggle('at-end', atEnd);
  }
  liveQueueList.addEventListener('scroll', updateLiveQueueFade);

  function renderUpNext() {
    const nextIdx = currentIndex + 1;
    const nextSong = queue[nextIdx] ? findSong(queue[nextIdx]) : null;
    if (queue.length === 0) {
      upNextLabel.textContent = 'Queue is empty — add songs in Setup.';
      nextSongBtn.disabled = true;
    } else if (nextSong) {
      upNextLabel.textContent = `Up next: ${nextSong.title}`;
      nextSongBtn.disabled = false;
    } else {
      upNextLabel.textContent = 'End of queue.';
      nextSongBtn.disabled = true;
    }
  }

  nextSongBtn.addEventListener('click', () => {
    const nextIdx = currentIndex + 1;
    if (!queue[nextIdx]) return;
    sendSongToSinger(nextIdx);
  });

  function moveQueueItem(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= queue.length) return;
    [queue[idx], queue[target]] = [queue[target], queue[idx]];
    if (currentIndex === idx) currentIndex = target;
    else if (currentIndex === target) currentIndex = idx;
    persistQueue();
    renderQueue();
  }

  // Promotes a song straight to position 0. Whatever plays after it just
  // continues down the (now-shifted) queue as normal - no special-casing
  // needed beyond keeping currentIndex pointed at the right song.
  function moveQueueItemToTop(idx) {
    if (idx <= 0 || idx >= queue.length) return;
    const [moved] = queue.splice(idx, 1);
    queue.unshift(moved);
    if (currentIndex === idx) currentIndex = 0;
    else if (currentIndex >= 0 && currentIndex < idx) currentIndex += 1;
    persistQueue();
    renderQueue();
  }

  // Drag-to-reorder for the setup-screen queue, via Pointer Events so it
  // works the same with mouse, touch, or pen. The dragged row tracks the
  // pointer directly (no easing); siblings between its old and new spot
  // slide over by one row height to open a gap, purely as a CSS transform -
  // the actual `queue` array only gets reordered once on pointerup.
  let queueDrag = null;

  function startQueueDrag(e, idx) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const items = Array.from(queueList.querySelectorAll('.queue-item'));
    if (items.length < 2) return;
    const rects = items.map((el) => el.getBoundingClientRect());
    const step = rects[1].top - rects[0].top;

    queueDrag = { idx, targetIdx: idx, startY: e.clientY, items, step };
    items[idx].classList.add('dragging');
    items[idx].setPointerCapture(e.pointerId);
    items[idx].addEventListener('pointermove', onQueueDragMove);
    items[idx].addEventListener('pointerup', endQueueDrag);
    items[idx].addEventListener('pointercancel', endQueueDrag);
  }

  function onQueueDragMove(e) {
    if (!queueDrag) return;
    const dy = e.clientY - queueDrag.startY;
    queueDrag.items[queueDrag.idx].style.transform = `translateY(${dy}px)`;

    let newTarget = queueDrag.idx + Math.round(dy / queueDrag.step);
    newTarget = Math.max(0, Math.min(queueDrag.items.length - 1, newTarget));
    if (newTarget === queueDrag.targetIdx) return;

    queueDrag.items.forEach((el, i) => {
      if (i === queueDrag.idx) return;
      let shift = 0;
      if (i > queueDrag.idx && i <= newTarget) shift = -1;
      else if (i < queueDrag.idx && i >= newTarget) shift = 1;
      el.style.transform = shift ? `translateY(${shift * queueDrag.step}px)` : '';
    });
    queueDrag.targetIdx = newTarget;
  }

  function endQueueDrag(e) {
    if (!queueDrag) return;
    const { idx, targetIdx, items } = queueDrag;
    items[idx].removeEventListener('pointermove', onQueueDragMove);
    items[idx].removeEventListener('pointerup', endQueueDrag);
    items[idx].removeEventListener('pointercancel', endQueueDrag);
    if (e && items[idx].hasPointerCapture(e.pointerId)) items[idx].releasePointerCapture(e.pointerId);
    items.forEach((el) => { el.style.transform = ''; el.classList.remove('dragging'); });
    queueDrag = null;

    if (targetIdx !== idx) {
      const [moved] = queue.splice(idx, 1);
      queue.splice(targetIdx, 0, moved);
      if (currentIndex === idx) currentIndex = targetIdx;
      else if (idx < currentIndex && targetIdx >= currentIndex) currentIndex -= 1;
      else if (idx > currentIndex && targetIdx <= currentIndex) currentIndex += 1;
      persistQueue();
    }
    renderQueue();
  }

  function removeFromQueue(idx) {
    queue.splice(idx, 1);
    if (currentIndex === idx) currentIndex = -1;
    else if (currentIndex > idx) currentIndex -= 1;
    persistQueue();
    renderQueue();
  }

  function sendSongToSinger(idx) {
    const song = findSong(queue[idx]);
    if (!song) return;
    currentIndex = idx;
    persistQueue();
    renderQueue();
    pushUpdate({ song: { title: song.title, artist: song.artist, key: song.key, bpm: song.bpm, lines: (song.lyrics || '').split('\n'), presets: song.presets || [] }, highlightLine: -1 });
    sessionSongLog.push({ title: song.title, artist: song.artist || '', at: Date.now() });
    persistSessionLog();
  }

  function addToQueue(songId) {
    queue.push(songId);
    persistQueue();
    renderQueue();
  }

  clearQueueBtn.addEventListener('click', () => {
    if (queue.length && !confirm('Clear the whole queue?')) return;
    queue = [];
    currentIndex = -1;
    persistQueue();
    renderQueue();
  });

  loadPlaylistBtn.addEventListener('click', () => {
    const id = playlistLoadSelect.value;
    if (!id) return;
    const pl = playlists.find((p) => p.id === id);
    if (!pl) return;
    queue = pl.songIds.filter((sid) => findSong(sid));
    currentIndex = -1;
    persistQueue();
    renderQueue();
  });

  saveQueueBtn.addEventListener('click', async () => {
    if (queue.length === 0) return alert('Queue is empty.');
    const name = prompt('Name this playlist:');
    if (!name) return;
    const created = await apiPost('/api/playlists', { name, songIds: queue, eventId: currentEventId });
    playlists.push(created);
    renderPlaylistOptions();
    renderPlaylistLibraryList();
  });

  // Opens a clean, light, print-friendly page in a new tab - a paper (or
  // PDF, via the browser's own print dialog) backup of the set order in
  // case a phone or the wifi dies mid-show. Built entirely client-side
  // since the queue/song data is already loaded - no server round-trip.
  printSetlistBtn.addEventListener('click', () => {
    if (queue.length === 0) return alert('Queue is empty — add songs first.');

    const rows = queue.map((id, idx) => {
      const song = findSong(id);
      if (!song) return '';
      return `<li><span class="num">${idx + 1}.</span> <span class="title">${escapeHtml(song.title)}</span>${song.artist ? ` <span class="artist">&mdash; ${escapeHtml(song.artist)}</span>` : ''}</li>`;
    }).join('');

    const win = window.open('', '_blank');
    if (!win) return alert('Please allow pop-ups to print the setlist.');

    win.document.write(`<!doctype html>
<html><head><meta charset="UTF-8" /><title>Setlist - ${escapeHtml(currentEventName || 'StageCue')}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .meta { color: #666; font-size: 13px; margin: 0 0 24px; }
  ol.setlist { list-style: none; margin: 0; padding: 0; }
  ol.setlist li { font-size: 18px; padding: 10px 0; border-bottom: 1px solid #ddd; }
  .num { color: #888; font-weight: 600; margin-right: 4px; }
  .title { font-weight: 700; }
  .artist { color: #666; }
  .no-print { margin: 24px 0 0; }
  .no-print button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <h1>${escapeHtml(currentEventName || 'Setlist')}</h1>
  <p class="meta">Setlist &middot; ${new Date().toLocaleString()}</p>
  <ol class="setlist">${rows}</ol>
  <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`);
    win.document.close();
  });

  // ---------- Library: songs ----------
  const songForm = document.getElementById('songForm');
  const songLibraryTab = document.getElementById('tab-library');
  const toggleSongFormBtn = document.getElementById('toggleSongFormBtn');
  toggleSongFormBtn.addEventListener('click', () => songLibraryTab.classList.toggle('song-form-open'));
  const songIdField = document.getElementById('songId');
  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const songKey = document.getElementById('songKey');
  const songBpm = document.getElementById('songBpm');
  const songLyrics = document.getElementById('songLyrics');
  const songCancelBtn = document.getElementById('songCancelBtn');
  const songLibraryList = document.getElementById('songLibraryList');
  const songSearchInput = document.getElementById('songSearchInput');
  let songSearchQuery = '';
  const openArtistGroups = new Set();
  songSearchInput.addEventListener('input', () => {
    songSearchQuery = songSearchInput.value.trim().toLowerCase();
    renderSongLibraryList();
  });
  const songPresetDraftList = document.getElementById('songPresetDraftList');
  const songPresetLabelInput = document.getElementById('songPresetLabelInput');
  const songPresetMessageInput = document.getElementById('songPresetMessageInput');
  const songPresetAddBtn = document.getElementById('songPresetAddBtn');

  // Draft of this song's own quick messages, edited in-memory while the form
  // is open and saved along with the rest of the song on submit.
  let songPresetDraft = [];

  function renderSongPresetDraftList() {
    songPresetDraftList.innerHTML = '';
    if (songPresetDraft.length === 0) {
      songPresetDraftList.innerHTML = '<li class="muted">None yet.</li>';
      return;
    }
    songPresetDraft.forEach((p, idx) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(p.label)}</strong><span>${escapeHtml(p.message)}</span></div>
        <div class="actions"><button type="button" class="btn btn-small btn-danger" data-act="del">Del</button></div>`;
      li.querySelector('[data-act="del"]').addEventListener('click', () => {
        songPresetDraft.splice(idx, 1);
        renderSongPresetDraftList();
      });
      songPresetDraftList.appendChild(li);
    });
  }

  songPresetAddBtn.addEventListener('click', () => {
    const label = songPresetLabelInput.value.trim();
    const message = songPresetMessageInput.value.trim();
    if (!label || !message) return;
    songPresetDraft.push({ id: 'sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, message });
    songPresetLabelInput.value = '';
    songPresetMessageInput.value = '';
    renderSongPresetDraftList();
  });

  songForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { title: songTitle.value.trim(), artist: songArtist.value.trim(), key: songKey.value.trim(), bpm: songBpm.value.trim(), lyrics: songLyrics.value, presets: songPresetDraft, eventId: currentEventId };
    if (songIdField.value) {
      const updated = await apiPut(`/api/songs/${songIdField.value}`, payload);
      const idx = songs.findIndex((s) => s.id === updated.id);
      songs[idx] = updated;
    } else {
      const created = await apiPost('/api/songs', payload);
      songs.push(created);
    }
    resetSongForm();
    renderSongLibraryList();
    renderPlaylistSongChecks();
    renderQueue();
    syncLibraryToSinger();
  });

  songCancelBtn.addEventListener('click', resetSongForm);

  function resetSongForm() {
    songIdField.value = '';
    songForm.reset();
    songLibraryTab.classList.remove('song-form-open');
    songCancelBtn.classList.add('hidden');
    songPresetDraft = [];
    renderSongPresetDraftList();
  }

  function renderSongLibraryList() {
    songLibraryList.innerHTML = '';
    if (songs.length === 0) {
      songLibraryList.innerHTML = '<p class="muted">No songs yet.</p>';
      return;
    }
    const filtered = songSearchQuery
      ? songs.filter((s) => s.title.toLowerCase().includes(songSearchQuery) || (s.artist || '').toLowerCase().includes(songSearchQuery))
      : songs;
    if (filtered.length === 0) {
      songLibraryList.innerHTML = '<p class="muted">No songs match your search.</p>';
      return;
    }

    // Organized by artist as a collapsible group per artist (native
    // <details>, so 15 artists x 30 songs doesn't turn into one giant
    // unmanageable flat list) - sorted alphabetically, songs missing an
    // artist grouped last under "No Artist". Purely a display
    // arrangement - the underlying songs array (and anything derived
    // from it, like playlist checklists) stays in creation order.
    const groups = new Map(); // artistKey -> { label, songs: [] }
    filtered.forEach((song) => {
      const label = (song.artist || '').trim() || 'No Artist';
      const key = label.toLowerCase();
      if (!groups.has(key)) groups.set(key, { label, songs: [] });
      groups.get(key).songs.push(song);
    });
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'no artist' && b !== 'no artist') return 1;
      if (b === 'no artist' && a !== 'no artist') return -1;
      return a.localeCompare(b);
    });

    sortedKeys.forEach((key) => {
      const group = groups.get(key);
      group.songs.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));

      const details = document.createElement('details');
      details.className = 'artist-group';
      // While actively searching, every matching group opens automatically
      // so results are never hidden behind a collapsed artist you'd have
      // to know to expand. Otherwise, whatever the singer manually opened
      // stays open across re-renders (song add/edit/delete all re-render).
      details.open = songSearchQuery ? true : openArtistGroups.has(key);
      details.addEventListener('toggle', () => {
        if (details.open) openArtistGroups.add(key);
        else openArtistGroups.delete(key);
      });

      const summary = document.createElement('summary');
      summary.textContent = `${group.label} (${group.songs.length})`;
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'artist-song-list';
      group.songs.forEach((song) => {
        const li = document.createElement('li');
        li.className = 'entity-item';
        li.innerHTML = `
          <div class="info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(songKeyBpmLine(song))}</span></div>
          <div class="actions">
            <button class="btn btn-small" data-act="add">Queue</button>
            <button class="btn btn-small" data-act="edit">Edit</button>
            <button class="btn btn-small btn-danger" data-act="del">Del</button>
          </div>`;
        li.querySelector('[data-act="add"]').addEventListener('click', () => addToQueue(song.id));
        li.querySelector('[data-act="edit"]').addEventListener('click', () => {
          songIdField.value = song.id;
          songTitle.value = song.title;
          songArtist.value = song.artist || '';
          songKey.value = song.key || '';
          songBpm.value = song.bpm || '';
          songLyrics.value = song.lyrics || '';
          songPresetDraft = (song.presets || []).slice();
          renderSongPresetDraftList();
          songCancelBtn.classList.remove('hidden');
          songLibraryTab.classList.add('song-form-open');
          selectTab('library');
        });
        li.querySelector('[data-act="del"]').addEventListener('click', async () => {
          if (!confirm(`Delete "${song.title}"?`)) return;
          await apiDelete(`/api/songs/${song.id}`);
          songs = songs.filter((s) => s.id !== song.id);
          queue = queue.filter((id) => id !== song.id);
          if (currentIndex >= queue.length) currentIndex = -1;
          persistQueue();
          renderSongLibraryList();
          renderPlaylistSongChecks();
          renderQueue();
          syncLibraryToSinger();
          showUndoToast(`Deleted "${song.title}".`, async () => {
            const restored = await apiPost(`/api/songs/${song.id}/restore`, {});
            songs.push(restored);
            renderSongLibraryList();
            renderPlaylistSongChecks();
            syncLibraryToSinger();
          });
        });
        ul.appendChild(li);
      });
      details.appendChild(ul);
      songLibraryList.appendChild(details);
    });
  }

  // ---------- Playlists ----------
  const playlistForm = document.getElementById('playlistForm');
  const playlistIdField = document.getElementById('playlistId');
  const playlistName = document.getElementById('playlistName');
  const playlistSongChecks = document.getElementById('playlistSongChecks');
  const playlistCancelBtn = document.getElementById('playlistCancelBtn');
  const playlistLibraryList = document.getElementById('playlistLibraryList');

  function renderPlaylistSongChecks(checkedIds) {
    checkedIds = checkedIds || [];
    playlistSongChecks.innerHTML = '';
    if (songs.length === 0) {
      playlistSongChecks.innerHTML = '<p class="muted">Add songs to the library first.</p>';
      return;
    }
    songs.forEach((song) => {
      const div = document.createElement('div');
      div.className = 'check-item';
      const checked = checkedIds.includes(song.id) ? 'checked' : '';
      div.innerHTML = `<input type="checkbox" value="${song.id}" ${checked} id="chk-${song.id}" /><label for="chk-${song.id}">${escapeHtml(song.title)}</label>`;
      playlistSongChecks.appendChild(div);
    });
  }

  playlistForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const songIds = Array.from(playlistSongChecks.querySelectorAll('input:checked')).map((i) => i.value);
    const payload = { name: playlistName.value.trim(), songIds, eventId: currentEventId };
    if (playlistIdField.value) {
      const updated = await apiPut(`/api/playlists/${playlistIdField.value}`, payload);
      const idx = playlists.findIndex((p) => p.id === updated.id);
      playlists[idx] = updated;
    } else {
      const created = await apiPost('/api/playlists', payload);
      playlists.push(created);
    }
    resetPlaylistForm();
    renderPlaylistLibraryList();
    renderPlaylistOptions();
  });

  playlistCancelBtn.addEventListener('click', resetPlaylistForm);

  function resetPlaylistForm() {
    playlistIdField.value = '';
    playlistForm.reset();
    renderPlaylistSongChecks();
    playlistCancelBtn.classList.add('hidden');
  }

  function renderPlaylistLibraryList() {
    playlistLibraryList.innerHTML = '';
    if (playlists.length === 0) {
      playlistLibraryList.innerHTML = '<li class="muted">No playlists yet.</li>';
      return;
    }
    playlists.forEach((pl) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(pl.name)}</strong><span>${pl.songIds.length} song(s)</span></div>
        <div class="actions">
          <button class="btn btn-small" data-act="load">Load</button>
          <button class="btn btn-small" data-act="edit">Edit</button>
          <button class="btn btn-small btn-danger" data-act="del">Del</button>
        </div>`;
      li.querySelector('[data-act="load"]').addEventListener('click', () => {
        queue = pl.songIds.filter((sid) => findSong(sid));
        currentIndex = -1;
        persistQueue();
        renderQueue();
      });
      li.querySelector('[data-act="edit"]').addEventListener('click', () => {
        playlistIdField.value = pl.id;
        playlistName.value = pl.name;
        renderPlaylistSongChecks(pl.songIds);
        playlistCancelBtn.classList.remove('hidden');
        selectTab('playlists');
      });
      li.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`Delete playlist "${pl.name}"?`)) return;
        await apiDelete(`/api/playlists/${pl.id}`);
        playlists = playlists.filter((p) => p.id !== pl.id);
        renderPlaylistLibraryList();
        renderPlaylistOptions();
        showUndoToast(`Deleted playlist "${pl.name}".`, async () => {
          const restored = await apiPost(`/api/playlists/${pl.id}/restore`, {});
          playlists.push(restored);
          renderPlaylistLibraryList();
          renderPlaylistOptions();
        });
      });
      playlistLibraryList.appendChild(li);
    });
  }

  function renderPlaylistOptions() {
    playlistLoadSelect.innerHTML = '<option value="">Load a playlist into queue...</option>';
    playlists.forEach((pl) => {
      const opt = document.createElement('option');
      opt.value = pl.id;
      opt.textContent = `${pl.name} (${pl.songIds.length})`;
      playlistLoadSelect.appendChild(opt);
    });
  }

  // ---------- Presets ----------
  const presetForm = document.getElementById('presetForm');
  const presetIdField = document.getElementById('presetId');
  const presetLabel = document.getElementById('presetLabel');
  const presetMessage = document.getElementById('presetMessage');
  const presetCancelBtn = document.getElementById('presetCancelBtn');
  const presetLibraryList = document.getElementById('presetLibraryList');

  presetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { label: presetLabel.value.trim(), message: presetMessage.value.trim(), eventId: currentEventId };
    if (presetIdField.value) {
      const updated = await apiPut(`/api/presets/${presetIdField.value}`, payload);
      const idx = presets.findIndex((p) => p.id === updated.id);
      presets[idx] = updated;
    } else {
      const created = await apiPost('/api/presets', payload);
      presets.push(created);
    }
    resetPresetForm();
    renderPresetLibraryList();
    renderPresetGrid();
  });

  presetCancelBtn.addEventListener('click', resetPresetForm);

  function resetPresetForm() {
    presetIdField.value = '';
    presetForm.reset();
    presetCancelBtn.classList.add('hidden');
  }

  function renderPresetLibraryList() {
    presetLibraryList.innerHTML = '';
    if (presets.length === 0) {
      presetLibraryList.innerHTML = '<li class="muted">No presets yet.</li>';
      return;
    }
    presets.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(p.label)}</strong><span>${escapeHtml(p.message)}</span></div>
        <div class="actions">
          <button class="btn btn-small" data-act="edit">Edit</button>
          <button class="btn btn-small btn-danger" data-act="del">Del</button>
        </div>`;
      li.querySelector('[data-act="edit"]').addEventListener('click', () => {
        presetIdField.value = p.id;
        presetLabel.value = p.label;
        presetMessage.value = p.message;
        presetCancelBtn.classList.remove('hidden');
        selectTab('presets');
      });
      li.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`Delete preset "${p.label}"?`)) return;
        await apiDelete(`/api/presets/${p.id}`);
        presets = presets.filter((x) => x.id !== p.id);
        renderPresetLibraryList();
        renderPresetGrid();
        showUndoToast(`Deleted preset "${p.label}".`, async () => {
          const restored = await apiPost(`/api/presets/${p.id}/restore`, {});
          presets.push(restored);
          renderPresetLibraryList();
          renderPresetGrid();
        });
      });
      presetLibraryList.appendChild(li);
    });
  }

  // ---------- Tabs ----------
  function selectTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'history') loadHistory();
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));

  // ---------- Show history ----------
  const historyList = document.getElementById('historyList');

  async function loadHistory() {
    historyList.innerHTML = '<li class="muted">Loading...</li>';
    const records = await apiGet(`/api/events/${currentEventId}/history`);
    if (!Array.isArray(records) || records.length === 0) {
      historyList.innerHTML = '<li class="muted">No past sessions for this event yet.</li>';
      return;
    }
    historyList.innerHTML = '';
    records.forEach((rec) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      const dateLabel = new Date(rec.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      const songRows = rec.songs.map((s) => {
        const time = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<li><span class="time">${time}</span>${escapeHtml(s.title)}${s.artist ? ` &mdash; ${escapeHtml(s.artist)}` : ''}</li>`;
      }).join('');
      const reactionRows = rec.reactions.map((r) => {
        const time = new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<li><span class="time">${time}</span>${escapeHtml(r.text)}</li>`;
      }).join('');
      li.innerHTML = `
        <details>
          <summary><strong>${dateLabel}</strong> <span class="muted">&mdash; ${rec.songs.length} song${rec.songs.length === 1 ? '' : 's'}</span></summary>
          ${songRows ? `<ol class="history-song-list">${songRows}</ol>` : '<p class="muted small-note">No songs sent.</p>'}
          ${reactionRows ? `<p class="muted small-note">Reactions:</p><ul class="history-reaction-list">${reactionRows}</ul>` : ''}
        </details>`;
      historyList.appendChild(li);
    });
  }

  // ---------- Utility ----------
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Loading an event's data ----------
  // Called once an event is chosen (or restored on reconnect) - everything here
  // is scoped to currentEventId, so switching events never mixes up libraries.
  async function loadEventData() {
    [songs, playlists, presets] = await Promise.all([
      apiGet(`/api/songs?eventId=${currentEventId}`),
      apiGet(`/api/playlists?eventId=${currentEventId}`),
      apiGet(`/api/presets?eventId=${currentEventId}`),
    ]);
    restoreQueue();
    renderSongLibraryList();
    renderPlaylistLibraryList();
    renderPlaylistOptions();
    renderPlaylistSongChecks();
    renderPresetLibraryList();
    renderPresetGrid();
    renderSongPresetDraftList();
    renderQueue();
    renderNowShowing();
    renderCurrentMessage();
  }

  // ---------- Boot ----------
  async function boot() {
    fetch('/api/config', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.googleEnabled) googleLoginBtn.classList.remove('hidden');
        if (cfg.passwordResetEnabled) forgotPasswordBtn.classList.remove('hidden');
      })
      .catch(() => {});

    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.user) {
      showScreen(authScreen);
      return;
    }
    currentUser = data.user;
    loggedInAs.textContent = data.user.username;
    // If there's a live session to resume, let the socket 'connect' handler's
    // resume flow own screen navigation instead - otherwise this and that would
    // race, and whichever finishes last (usually the events screen) wins wrongly.
    if (localStorage.getItem(SESSION_KEY)) return;
    await loadEvents();
    showScreen(eventsScreen);
  }

  boot();
})();
