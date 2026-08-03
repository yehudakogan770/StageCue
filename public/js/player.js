(function () {
  const socket = io();

  let songs = [];
  let playlists = [];
  let presets = [];
  let queue = []; // array of song ids
  let currentIndex = -1;
  let sessionCode = null;
  let singerCount = 0;

  // song and message are independent - either, both, or neither can be showing at once.
  let liveState = { message: '', song: null, highlightLine: -1, fontScale: 'normal' };
  const FONT_SCALES = ['small', 'normal', 'large', 'xlarge'];

  // ---------- API helpers ----------
  async function apiGet(url) { return (await fetch(url)).json(); }
  async function apiPost(url, body) {
    return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }
  async function apiPut(url, body) {
    return (await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }
  async function apiDelete(url) {
    return (await fetch(url, { method: 'DELETE' })).json();
  }

  function findSong(id) { return songs.find((s) => s.id === id); }

  // ---------- DOM refs ----------
  const startScreen = document.getElementById('startScreen');
  const mainScreen = document.getElementById('mainScreen');
  const startBtn = document.getElementById('startBtn');
  const customCodeInput = document.getElementById('customCodeInput');
  const startError = document.getElementById('startError');
  const codeDisplay = document.getElementById('codeDisplay');
  const singerStatus = document.getElementById('singerStatus');
  const playerConnStatus = document.getElementById('playerConnStatus');
  const endSessionBtn = document.getElementById('endSessionBtn');

  const nowShowing = document.getElementById('nowShowing');
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

  const nextSongBtn = document.getElementById('nextSongBtn');
  const upNextLabel = document.getElementById('upNextLabel');

  const playlistLoadSelect = document.getElementById('playlistLoadSelect');
  const loadPlaylistBtn = document.getElementById('loadPlaylistBtn');
  const saveQueueBtn = document.getElementById('saveQueueBtn');
  const clearQueueBtn = document.getElementById('clearQueueBtn');
  const queueList = document.getElementById('queueList');

  const reactionsFeed = document.getElementById('reactionsFeed');
  const reactionBanner = document.getElementById('reactionBanner');

  const liveScreen = document.getElementById('liveScreen');
  const manageScreen = document.getElementById('manageScreen');
  const manageToggleBtn = document.getElementById('manageToggleBtn');

  // ---------- Session lifecycle ----------
  const SESSION_KEY = 'stagecue_session_code';

  function enterSession(code, state) {
    sessionCode = code;
    codeDisplay.textContent = code;
    startScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    if (state) liveState = state;
    renderNowShowing();
    renderCurrentMessage();
  }

  startBtn.addEventListener('click', () => {
    startError.classList.add('hidden');
    socket.emit('player:create', customCodeInput.value.trim(), (ack) => {
      if (!ack || !ack.ok) {
        startError.textContent = (ack && ack.error) || 'Could not start a session.';
        startError.classList.remove('hidden');
        return;
      }
      localStorage.setItem(SESSION_KEY, ack.code);
      enterSession(ack.code, null);
    });
  });

  endSessionBtn.addEventListener('click', () => {
    if (!confirm('End this session? The singer will be disconnected.')) return;
    localStorage.removeItem(SESSION_KEY);
    socket.disconnect();
    location.reload();
  });

  // Runs on first connect AND every automatic reconnect after a dropped
  // connection - reclaims the in-progress session instead of losing it.
  socket.on('connect', () => {
    setConnBadge(true);
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return;
    socket.emit('player:resume', saved, (ack) => {
      if (ack && ack.ok) {
        enterSession(ack.code, ack.state);
        return;
      }
      localStorage.removeItem(SESSION_KEY);
      if (sessionCode) {
        alert('This session could not be recovered after a long disconnect. Please start a new one.');
        location.reload();
      }
    });
  });

  socket.on('disconnect', () => setConnBadge(false));

  function setConnBadge(online) {
    if (!sessionCode) return; // don't show anything before a session has started
    playerConnStatus.classList.remove('hidden');
    const dot = playerConnStatus.querySelector('.status-dot');
    dot.classList.toggle('online', online);
    playerConnStatus.lastChild.textContent = online ? ' Connected' : ' Reconnecting...';
  }

  // liveScreen is the performance view (reached via "Launch Event"); manageScreen
  // is the setup view (songs/playlists/presets/queue), shown by default so the
  // singer can already be connected and ready before the event actually starts.
  manageToggleBtn.addEventListener('click', () => {
    const goingToManage = liveScreen.classList.contains('hidden') === false;
    liveScreen.classList.toggle('hidden', goingToManage);
    manageScreen.classList.toggle('hidden', !goingToManage);
    manageToggleBtn.textContent = goingToManage ? 'Launch Event' : 'Edit Setup';
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

  let bannerTimeout = null;
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

    reactionBanner.textContent = `Singer: ${text}`;
    reactionBanner.classList.remove('hidden');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => reactionBanner.classList.add('hidden'), 4000);
  });
  reactionsFeed.dataset.empty = 'true';

  // ---------- Live state sync ----------
  // song and message are independent: pushing one never touches the other.
  function pushUpdate(partial) {
    liveState = { ...liveState, ...partial };
    socket.emit('player:update', partial);
    renderNowShowing();
    renderCurrentMessage();
  }

  function renderNowShowing() {
    nowShowing.innerHTML = '';
    prevLineBtn.disabled = true;
    nextLineBtn.disabled = true;

    if (!liveState.song) {
      nowShowing.innerHTML = '<p class="muted">No song selected.</p>';
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

    liveState.song.lines.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'lyric-line' + (idx === liveState.highlightLine ? ' active' : '');
      div.textContent = line || ' ';
      div.addEventListener('click', () => pushUpdate({ highlightLine: idx }));
      nowShowing.appendChild(div);
    });

    prevLineBtn.disabled = false;
    nextLineBtn.disabled = false;
  }

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

  clearMessageBtn.addEventListener('click', () => pushUpdate({ message: '' }));
  clearScreenBtn.addEventListener('click', () => {
    currentIndex = -1;
    persistQueue();
    renderQueue();
    pushUpdate({ message: '', song: null, highlightLine: -1 });
  });

  fontUpBtn.addEventListener('click', () => {
    const i = Math.min(FONT_SCALES.length - 1, FONT_SCALES.indexOf(liveState.fontScale) + 1);
    pushUpdate({ fontScale: FONT_SCALES[i] });
  });
  fontDownBtn.addEventListener('click', () => {
    const i = Math.max(0, FONT_SCALES.indexOf(liveState.fontScale) - 1);
    pushUpdate({ fontScale: FONT_SCALES[i] });
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

  function renderPresetGrid() {
    presetGrid.innerHTML = '';
    presets.forEach((p) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = p.label;
      btn.addEventListener('click', () => pushUpdate({ message: p.message }));
      presetGrid.appendChild(btn);
    });
  }

  // ---------- Queue ----------
  function persistQueue() {
    localStorage.setItem('stagecue_queue', JSON.stringify(queue));
    localStorage.setItem('stagecue_currentIndex', String(currentIndex));
  }
  function restoreQueue() {
    try {
      const q = JSON.parse(localStorage.getItem('stagecue_queue') || '[]');
      queue = q.filter((id) => findSong(id));
      currentIndex = parseInt(localStorage.getItem('stagecue_currentIndex') || '-1', 10);
      if (currentIndex >= queue.length) currentIndex = -1;
    } catch {
      queue = [];
      currentIndex = -1;
    }
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
          <div class="info"><strong>${idx + 1}. ${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || '')}</span></div>
          <div class="actions">
            <button class="btn btn-small" data-act="up">&uarr;</button>
            <button class="btn btn-small" data-act="down">&darr;</button>
            <button class="btn btn-small btn-primary" data-act="send">Send</button>
            <button class="btn btn-small btn-danger" data-act="remove">&times;</button>
          </div>`;
        li.querySelector('[data-act="up"]').addEventListener('click', () => moveQueueItem(idx, -1));
        li.querySelector('[data-act="down"]').addEventListener('click', () => moveQueueItem(idx, 1));
        li.querySelector('[data-act="send"]').addEventListener('click', () => sendSongToSinger(idx));
        li.querySelector('[data-act="remove"]').addEventListener('click', () => removeFromQueue(idx));
        queueList.appendChild(li);
      });
    }
    renderUpNext();
  }

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
    pushUpdate({ song: { title: song.title, artist: song.artist, lines: (song.lyrics || '').split('\n') }, highlightLine: -1 });
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
    const created = await apiPost('/api/playlists', { name, songIds: queue });
    playlists.push(created);
    renderPlaylistOptions();
    renderPlaylistLibraryList();
  });

  // ---------- Library: songs ----------
  const songForm = document.getElementById('songForm');
  const songIdField = document.getElementById('songId');
  const songTitle = document.getElementById('songTitle');
  const songArtist = document.getElementById('songArtist');
  const songLyrics = document.getElementById('songLyrics');
  const songCancelBtn = document.getElementById('songCancelBtn');
  const songLibraryList = document.getElementById('songLibraryList');

  songForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { title: songTitle.value.trim(), artist: songArtist.value.trim(), lyrics: songLyrics.value };
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
  });

  songCancelBtn.addEventListener('click', resetSongForm);

  function resetSongForm() {
    songIdField.value = '';
    songForm.reset();
    songCancelBtn.classList.add('hidden');
  }

  function renderSongLibraryList() {
    songLibraryList.innerHTML = '';
    if (songs.length === 0) {
      songLibraryList.innerHTML = '<li class="muted">No songs yet.</li>';
      return;
    }
    songs.forEach((song) => {
      const li = document.createElement('li');
      li.className = 'entity-item';
      li.innerHTML = `
        <div class="info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || '')}</span></div>
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
        songLyrics.value = song.lyrics || '';
        songCancelBtn.classList.remove('hidden');
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
      });
      songLibraryList.appendChild(li);
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
    const payload = { name: playlistName.value.trim(), songIds };
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
    const payload = { label: presetLabel.value.trim(), message: presetMessage.value.trim() };
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
      });
      presetLibraryList.appendChild(li);
    });
  }

  // ---------- Tabs ----------
  function selectTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));

  // ---------- Utility ----------
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Init ----------
  async function init() {
    [songs, playlists, presets] = await Promise.all([apiGet('/api/songs'), apiGet('/api/playlists'), apiGet('/api/presets')]);
    restoreQueue();
    renderSongLibraryList();
    renderPlaylistLibraryList();
    renderPlaylistOptions();
    renderPlaylistSongChecks();
    renderPresetLibraryList();
    renderPresetGrid();
    renderQueue();
    renderNowShowing();
    renderCurrentMessage();
  }

  init();
})();
