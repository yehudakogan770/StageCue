(function () {
  const socket = io();

  const REPLIES = ["Got it", "Repeat please", "Can't hear you", "Slower please", "Louder please", "One more minute"];

  const joinScreen = document.getElementById('joinScreen');
  const liveScreen = document.getElementById('liveScreen');
  const joinForm = document.getElementById('joinForm');
  const codeInput = document.getElementById('codeInput');
  const joinError = document.getElementById('joinError');
  const leaveBtn = document.getElementById('leaveBtn');
  const display = document.getElementById('display');
  const replyBar = document.getElementById('replyBar');

  REPLIES.forEach((text) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      socket.emit('singer:react', text);
      flashReplySent(btn);
    });
    replyBar.appendChild(btn);
  });

  function flashReplySent(btn) {
    btn.classList.add('btn-primary');
    setTimeout(() => btn.classList.remove('btn-primary'), 400);
  }

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!code) return;
    joinError.classList.add('hidden');
    socket.emit('singer:join', code, (ack) => {
      if (!ack || !ack.ok) {
        joinError.textContent = (ack && ack.error) || 'Could not connect.';
        joinError.classList.remove('hidden');
        return;
      }
      joinScreen.classList.add('hidden');
      liveScreen.classList.remove('hidden');
      applyState(ack.state);
    });
  });

  leaveBtn.addEventListener('click', () => {
    if (!confirm('Leave the session?')) return;
    socket.disconnect();
    location.reload();
  });

  socket.on('state:update', applyState);

  socket.on('session:ended', () => {
    alert('The keyboard player ended the session.');
    location.reload();
  });

  socket.on('disconnect', () => {
    const dot = document.querySelector('#connStatus .status-dot');
    if (dot) dot.classList.remove('online');
  });

  function applyState(state) {
    if (!state) return;

    display.className = 'display scale-' + (state.fontScale || 'normal');
    display.innerHTML = '';

    if (state.mode === 'message' && state.message) {
      const p = document.createElement('p');
      p.className = 'message-text';
      p.textContent = state.message;
      display.appendChild(p);
      return;
    }

    if (state.mode === 'lyrics' && state.song) {
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

      state.song.lines.forEach((line, idx) => {
        const div = document.createElement('div');
        div.className = 'lyric-line' + (idx === state.highlightLine ? ' active' : '');
        div.textContent = line || ' ';
        wrap.appendChild(div);
      });

      display.appendChild(wrap);

      const active = wrap.querySelector('.lyric-line.active');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const p = document.createElement('p');
    p.className = 'waiting';
    p.textContent = 'Waiting for the keyboard player...';
    display.appendChild(p);
  }
})();
