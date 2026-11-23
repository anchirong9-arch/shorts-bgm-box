/* 쇼츠 브금 박스 — 효과음 · 내 소리함 · 영상 소리 추출 (의존성 없음) */
(function () {
  'use strict';

  var SFX = window.SFXLib;
  if (!SFX) { console.error('SFXLib를 불러오지 못했습니다'); return; }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDur(sec) {
    if (!sec || !isFinite(sec)) return '–';
    if (sec < 10) return sec.toFixed(2).replace(/0$/, '') + '초';
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtSize(b) {
    if (!b) return '0KB';
    if (b < 1024) return b + 'B';
    if (b < 1048576) return Math.round(b / 1024) + 'KB';
    return (b / 1048576).toFixed(1) + 'MB';
  }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 30000);
  }
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:99;background:#161a23;border:1px solid #262c38;' +
        'color:#eef1f7;padding:11px 16px;border-radius:12px;font-size:13.5px;box-shadow:0 12px 30px rgba(0,0,0,.45);max-width:88vw;text-align:center;opacity:0;transition:.2s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.borderColor = kind === 'err' ? 'rgba(255,107,107,.6)' : '#262c38';
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = '0'; }, 2600);
  }

  var Ctx = null;
  function ac() {
    if (!Ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      Ctx = new AC();
    }
    if (Ctx.state === 'suspended') Ctx.resume();
    return Ctx;
  }

  var curSrc = null, curCard = null;
  function stopPlayback() {
    if (curSrc) {
      try { curSrc.onended = null; curSrc.stop(); } catch (e) { }
      curSrc = null;
    }
    if (curCard) {
      curCard.classList.remove('playing');
      var b = curCard.querySelector('[data-act="play"]');
      if (b) b.textContent = '▶';
      curCard = null;
    }
  }
  function playBuf(buf, offset, dur, card) {
    stopPlayback();
    var c = ac();
    var s = c.createBufferSource();
    s.buffer = buf; s.connect(c.destination);
    if (dur != null && dur > 0) s.start(0, offset || 0, dur); else s.start(0, offset || 0);
    curSrc = s; curCard = card || null;
    if (card) {
      card.classList.add('playing');
      var b = card.querySelector('[data-act="play"]');
      if (b) b.textContent = '❚❚';
    }
    s.onended = function () { if (curSrc === s) stopPlayback(); };
  }

  /* =======================================================
     IndexedDB — 내 소리함
     ======================================================= */
  var DB_NAME = 'shorts-bgm-box', DB_VER = 1, STORE = 'clips', _db = null;
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = function () { _db = r.result; res(_db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function dbAll() {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        q.onsuccess = function () { res(q.result || []); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function dbPut(rec) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec);
        q.onsuccess = function () { res(rec); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function dbDel(id) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
        q.onsuccess = function () { res(); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }

  /* =======================================================
     상태
     ======================================================= */
  var clips = [];           // IndexedDB 레코드
  var decoded = {};         // id -> AudioBuffer
  var sfxRender = {};       // id -> AudioBuffer (sampleRate별)
  var sfxState = { cat: 'all', q: '', sort: 'default' };
  var mineState = { cat: 'all', q: '' };

  function catInfo(id) {
    for (var i = 0; i < SFX.CATS.length; i++) if (SFX.CATS[i].id === id) return SFX.CATS[i];
    for (var j = 0; j < SFX.USER_CATS.length; j++) if (SFX.USER_CATS[j].id === id) return SFX.USER_CATS[j];
    return { id: id, name: id, emoji: '🎵', short: id, color: '#98a2b3' };
  }

  /* =======================================================
     탭
     ======================================================= */
  var playerEl = $('player'), bgmAudio = $('audio');
  function syncPlayer() { if (playerEl) playerEl.hidden = !bgmAudio.getAttribute('src'); }
  ['loadstart', 'play', 'pause', 'ended', 'emptied'].forEach(function (ev) {
    bgmAudio.addEventListener(ev, syncPlayer);
  });
  syncPlayer();

  function setTab(name) {
    stopPlayback();
    document.body.setAttribute('data-tab', name);
    var btns = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(btns, function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === name));
    });
    ['bgm', 'sfx', 'mine', 'extract'].forEach(function (n) {
      var p = $('pane-' + n);
      if (p) p.hidden = (n !== name);
    });
    if (name === 'sfx') renderSfx();
    if (name === 'mine') renderMine();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) setTab(b.getAttribute('data-tab'));
  });
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#', '');
    if (['bgm', 'sfx', 'mine', 'extract'].indexOf(h) !== -1 && document.body.getAttribute('data-tab') !== h) setTab(h);
  });

  /* =======================================================
     효과음 탭
     ======================================================= */
  var SFX_TABS = [
    { id: 'all', emoji: '🎧', name: '전체' },
    { id: 'cute', emoji: '🐰', name: '귀여운' },
    { id: 'edit', emoji: '🛠', name: '편집 기본' },
    { id: 'fun', emoji: '🤣', name: '예능·웃긴' },
    { id: 'game', emoji: '🎮', name: '게임' },
    { id: 'meme', emoji: '🌍', name: '해외 밈' },
    { id: 'call', emoji: '💬', name: '통화·디스코드' },
    { id: 'clip', emoji: '🔥', name: '유행·스트리머 대사' },
    { id: 'mine', emoji: '📁', name: '내 소리함' }
  ];

  function sfxItems() {
    var out = [];
    for (var i = 0; i < SFX.list.length; i++) {
      var d = SFX.list[i];
      out.push({ type: 'sfx', id: d.id, name: d.name, cat: d.cat, dur: d.dur, desc: d.desc, tags: d.tags, use: d.use });
    }
    for (var j = 0; j < clips.length; j++) {
      var r = clips[j];
      out.push({ type: 'user', id: r.id, name: r.name, cat: r.cat, dur: r.dur, desc: '', tags: [], rec: r });
    }
    return out;
  }

  function itemMatches(it, q) {
    if (!q) return true;
    var c = catInfo(it.cat);
    var hay = [it.name, it.desc || '', it.use || '', (it.tags || []).join(' '), c.name].join(' ').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function filterSfx() {
    var q = sfxState.q.trim().toLowerCase();
    var all = sfxItems();
    var list = all.filter(function (it) {
      var catOk;
      if (sfxState.cat === 'all') catOk = true;
      else if (sfxState.cat === 'mine') catOk = it.type === 'user';
      else if (sfxState.cat === 'clip') catOk = it.type === 'user' && it.cat === 'clip';
      else catOk = it.cat === sfxState.cat;
      return catOk && itemMatches(it, q);
    });
    var s = sfxState.sort;
    if (s === 'short') list.sort(function (a, b) { return (a.dur || 0) - (b.dur || 0); });
    else if (s === 'long') list.sort(function (a, b) { return (b.dur || 0) - (a.dur || 0); });
    else if (s === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    return list;
  }

  function renderSfxChips() {
    var counts = {};
    SFX.list.forEach(function (d) { counts[d.cat] = (counts[d.cat] || 0) + 1; });
    clips.forEach(function (r) {
      counts['u_' + r.cat] = (counts['u_' + r.cat] || 0) + 1;
    });
    var html = '';
    SFX_TABS.forEach(function (t) {
      var n;
      if (t.id === 'all') n = SFX.list.length + clips.length;
      else if (t.id === 'mine') n = clips.length;
      else if (t.id === 'clip') n = counts['u_clip'] || 0;
      else n = (counts[t.id] || 0) + (counts['u_' + t.id] || 0);
      html += '<button type="button" class="chip" role="tab" data-cat="' + t.id + '" aria-selected="' + (sfxState.cat === t.id) + '">' +
        '<span aria-hidden="true">' + t.emoji + '</span>' + t.name + '<span class="n">' + n + '</span></button>';
    });
    $('sfxChips').innerHTML = html;
  }

  function cardHtml(it, manage) {
    var c = catInfo(it.cat);
    var isUser = it.type === 'user';
    var badge = isUser ? '내 클립' : 'WAV';
    var lic = isUser ? (it.rec && it.rec.src === 'extract' ? '영상에서 추출' : '내가 올림') : '자체 합성 · 무료';
    var tags = (it.tags || []).map(function (g) { return '<span class="tag">#' + esc(g) + '</span>'; }).join('');
    return '<article class="card sfx' + (isUser ? ' user' : '') + '" data-id="' + esc(it.id) + '" data-type="' + it.type + '" style="--cat:' + c.color + '">' +
      '<div class="card-top">' +
        '<button type="button" class="play" data-act="play" aria-label="' + esc(it.name) + ' 재생">▶</button>' +
        '<div class="title-wrap">' +
          '<h3>' + esc(it.name) + '</h3>' +
          '<p class="ko">' + c.emoji + ' ' + esc(c.short) + ' · ' + fmtDur(it.dur) + (isUser && it.rec ? ' · ' + fmtSize(it.rec.size) : '') + '</p>' +
        '</div>' +
        '<span class="badge">' + badge + '</span>' +
      '</div>' +
      (it.desc ? '<p class="desc">' + esc(it.desc) + '</p>' : '') +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '<div class="card-foot">' +
        '<span class="lic">' + lic + '</span>' +
        '<div class="row">' +
          '<button type="button" class="dl-btn sm" data-act="dl">' + (isUser ? '⬇ 원본' : '⬇ WAV') + '</button>' +
          (manage ? '<button type="button" class="dl-btn sm" data-act="del" title="삭제">🗑</button>' : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderSfx() {
    renderSfxChips();
    var list = filterSfx();
    var catName = '';
    for (var i = 0; i < SFX_TABS.length; i++) if (SFX_TABS[i].id === sfxState.cat) catName = SFX_TABS[i].name;
    $('sfxCount').textContent = list.length + '개' + (sfxState.cat === 'all' ? '' : ' · ' + catName) + (sfxState.q ? ' · "' + sfxState.q.trim() + '"' : '');
    $('sfxEmpty').hidden = list.length !== 0;
    $('sfxGrid').innerHTML = list.map(function (it) { return cardHtml(it, it.type === 'user'); }).join('');
    $('tSfx').textContent = String(SFX.list.length);
    $('tMine').textContent = String(clips.length);
  }

  $('sfxChips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    sfxState.cat = b.getAttribute('data-cat');
    renderSfx();
  });
  $('sfxQ').addEventListener('input', function () {
    sfxState.q = $('sfxQ').value;
    $('sfxClear').hidden = !sfxState.q;
    renderSfx();
  });
  $('sfxClear').addEventListener('click', function () {
    $('sfxQ').value = ''; sfxState.q = ''; $('sfxClear').hidden = true; renderSfx(); $('sfxQ').focus();
  });
  $('sfxSort').addEventListener('change', function () { sfxState.sort = $('sfxSort').value; renderSfx(); });

  /* ---- 효과음 재생 / 다운로드 ---- */
  function getSfxBuffer(id) {
    var sr = ac().sampleRate;
    var key = id + '@' + sr;
    if (!sfxRender[key]) sfxRender[key] = SFX.render(id, sr);
    return sfxRender[key];
  }

  function decodeClip(id) {
    if (decoded[id]) return Promise.resolve(decoded[id]);
    var rec = null;
    for (var i = 0; i < clips.length; i++) if (clips[i].id === id) rec = clips[i];
    if (!rec || !rec.blob) return Promise.reject(new Error('파일을 찾지 못했습니다'));
    return rec.blob.arrayBuffer().then(function (ab) {
      return new Promise(function (res, rej) {
        // Safari는 promise 미지원 — 콜백 병행
        var p = ac().decodeAudioData(ab, function (buf) { decoded[id] = buf; res(buf); }, function (e) { rej(e || new Error('decode')); });
        if (p && p.then) p.then(function (buf) { decoded[id] = buf; res(buf); }, function (e) { rej(e); });
      });
    });
  }

  function playItem(it, card) {
    if (it.type === 'sfx') {
      playBuf(getSfxBuffer(it.id), 0, null, card);
    } else {
      decodeClip(it.id).then(function (buf) {
        playBuf(buf, 0, null, card);
      }).catch(function (e) {
        toast('이 파일은 브라우저에서 재생할 수 없어요', 'err');
      });
    }
  }

  function downloadItem(it) {
    if (it.type === 'sfx') {
      var blob = SFX.wavBlob(it.id, SFX.SR);
      saveBlob(blob, 'SFX-' + it.name.replace(/[\\/:*?"<>|]/g, '') + '.wav');
      toast('WAV로 저장했어요: ' + it.name);
    } else {
      saveBlob(it.rec.blob, it.rec.name + (it.rec.ext || ''));
      toast('파일을 저장했어요');
    }
  }

  function handleCardClick(e, manage) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.card');
    if (!card) return;
    var id = card.getAttribute('data-id'), type = card.getAttribute('data-type');
    var it = null;
    if (type === 'sfx') {
      it = { type: 'sfx', id: id, name: (SFX.get(id) || {}).name || id };
    } else {
      for (var i = 0; i < clips.length; i++) if (clips[i].id === id) it = { type: 'user', id: id, name: clips[i].name, rec: clips[i] };
    }
    if (!it) return;
    var act = btn.getAttribute('data-act');
    if (act === 'play') {
      if (card.classList.contains('playing')) { stopPlayback(); return; }
      playItem(it, card);
    } else if (act === 'dl') {
      downloadItem(it);
    } else if (act === 'del') {
      if (!confirm('"' + it.name + '"을(를) 내 소리함에서 지울까요? 되돌릴 수 없어요.')) return;
      dbDel(id).then(function () {
        delete decoded[id];
        clips = clips.filter(function (r) { return r.id !== id; });
        renderSfx(); renderMine();
        toast('지웠어요');
      }).catch(function () { toast('지우지 못했어요', 'err'); });
    }
  }
  $('sfxGrid').addEventListener('click', function (e) { handleCardClick(e, true); });

  /* =======================================================
     내 소리함
     ======================================================= */
  function renderMineChips() {
    var counts = {};
    clips.forEach(function (r) { counts[r.cat] = (counts[r.cat] || 0) + 1; });
    var html = '<button type="button" class="chip" role="tab" data-cat="all" aria-selected="' + (mineState.cat === 'all') + '">' +
      '<span aria-hidden="true">📁</span>전체<span class="n">' + clips.length + '</span></button>';
    SFX.USER_CATS.forEach(function (c) {
      html += '<button type="button" class="chip" role="tab" data-cat="' + c.id + '" aria-selected="' + (mineState.cat === c.id) + '">' +
        '<span aria-hidden="true">' + c.emoji + '</span>' + esc(c.name) + '<span class="n">' + (counts[c.id] || 0) + '</span></button>';
    });
    $('mineChips').innerHTML = html;
  }

  function renderMine() {
    renderMineChips();
    var q = mineState.q.trim().toLowerCase();
    var list = clips.filter(function (r) {
      var catOk = mineState.cat === 'all' || r.cat === mineState.cat;
      var nameOk = !q || (r.name + ' ' + catInfo(r.cat).name).toLowerCase().indexOf(q) !== -1;
      return catOk && nameOk;
    });
    $('mineEmpty').hidden = list.length !== 0;
    $('mineGrid').innerHTML = list.map(function (r) {
      return cardHtml({ type: 'user', id: r.id, name: r.name, cat: r.cat, dur: r.dur, desc: '', tags: [], rec: r }, true);
    }).join('');
    $('tMine').textContent = String(clips.length);
    updateUsage();
  }

  function updateUsage() {
    var el = $('vaultUsage');
    if (!el) return;
    var total = clips.reduce(function (a, r) { return a + (r.size || 0); }, 0);
    var txt = clips.length + '개 · 약 ' + fmtSize(total) + ' 저장됨';
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (est && est.quota) {
          el.textContent = txt + ' · 브라우저 저장 공간 ' + fmtSize(est.usage || 0) + ' / ' + fmtSize(est.quota);
        } else el.textContent = txt;
      }).catch(function () { el.textContent = txt; });
    } else el.textContent = txt;
  }

  $('mineChips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    mineState.cat = b.getAttribute('data-cat');
    renderMine();
  });
  $('mineQ').addEventListener('input', function () {
    mineState.q = $('mineQ').value;
    renderMine();
  });
  $('mineGrid').addEventListener('click', function (e) { handleCardClick(e, true); });

  /* ---- 파일 올리기(스테이징) ---- */
  var staged = [];
  var dropEl = $('drop'), fileIn = $('fileIn');

  function guessExt(file) {
    var n = file.name || '';
    var m = n.match(/\.[a-z0-9]+$/i);
    return m ? m[0].toLowerCase() : '';
  }
  function isAudioFile(f) {
    if (f.type && f.type.indexOf('audio/') === 0) return true;
    return /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|webm)$/i.test(f.name || '');
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var audio = files.filter(isAudioFile);
    var skipped = files.length - audio.length;
    if (skipped > 0) toast(skipped + '개는 음성 파일이 아니라 건너뛰었어요 (영상은 🎬 탭에서)');
    if (!audio.length) return;
    var jobs = audio.map(function (f) {
      return new Promise(function (res) {
        var name = f.name.replace(/\.[^.]+$/, '');
        var item = { file: f, name: name, cat: 'clip', dur: 0, ext: guessExt(f) };
        var ab = null;
        f.arrayBuffer().then(function (b) {
          ab = b;
          return new Promise(function (r2, j2) {
            var p = ac().decodeAudioData(b.slice(0), function (buf) { r2(buf); }, function () { j2(); });
            if (p && p.then) p.then(r2, function () { j2(); });
          });
        }).then(function (buf) { item.dur = buf.duration; })
          .catch(function () { item.dur = 0; item.bad = true; })
          .then(function () { res(item); });
      });
    });
    Promise.all(jobs).then(function (items) {
      staged = staged.concat(items);
      renderStaging();
      $('staging').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function renderStaging() {
    var box = $('staging');
    if (!staged.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var rows = staged.map(function (it, i) {
      var opts = SFX.USER_CATS.map(function (c) {
        return '<option value="' + c.id + '"' + (it.cat === c.id ? ' selected' : '') + '>' + esc(c.emoji + ' ' + c.name) + '</option>';
      }).join('');
      return '<div class="stage-row" data-i="' + i + '">' +
        '<input type="text" data-name value="' + esc(it.name) + '" aria-label="이름">' +
        '<select data-cat aria-label="카테고리">' + opts + '</select>' +
        '<button type="button" class="rm" data-rm aria-label="빼기">✕</button>' +
        '<div class="fmeta">' + esc(it.file.name) + ' · ' + fmtSize(it.file.size) + ' · ' + fmtDur(it.dur) + (it.bad ? ' · ⚠️ 재생 불가 형식일 수 있어요' : '') + '</div>' +
      '</div>';
    }).join('');
    box.innerHTML = '<h4>저장할 소리 ' + staged.length + '개 — 이름과 카테고리를 확인하세요</h4>' + rows +
      '<div class="stage-foot">' +
        '<button type="button" class="btn ghost sm" id="stageCancel">취소</button>' +
        '<button type="button" class="btn primary sm" id="stageSave">📁 ' + staged.length + '개 내 소리함에 저장</button>' +
      '</div>';
  }

  $('staging').addEventListener('input', function (e) {
    var row = e.target.closest('.stage-row');
    if (!row) return;
    var i = +row.getAttribute('data-i');
    if (!staged[i]) return;
    if (e.target.hasAttribute('data-name')) staged[i].name = e.target.value;
    if (e.target.hasAttribute('data-cat')) staged[i].cat = e.target.value;
  });
  $('staging').addEventListener('change', function (e) {
    var row = e.target.closest('.stage-row');
    if (!row) return;
    var i = +row.getAttribute('data-i');
    if (staged[i] && e.target.hasAttribute('data-cat')) staged[i].cat = e.target.value;
  });
  $('staging').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]');
    if (rm) {
      var row = rm.closest('.stage-row');
      staged.splice(+row.getAttribute('data-i'), 1);
      renderStaging();
      return;
    }
    if (e.target.id === 'stageCancel') { staged = []; renderStaging(); return; }
    if (e.target.id === 'stageSave') saveStaged();
  });

  function saveStaged() {
    if (!staged.length) return;
    var items = staged.slice();
    var chain = Promise.resolve();
    var okCount = 0;
    items.forEach(function (it) {
      chain = chain.then(function () {
        var rec = {
          id: uid(),
          name: (it.name || '이름 없음').trim() || '이름 없음',
          cat: it.cat || 'clip',
          mime: it.file.type || 'audio/mpeg',
          size: it.file.size,
          dur: it.dur || 0,
          added: Date.now(),
          src: 'upload',
          ext: it.ext || '',
          blob: it.file
        };
        return dbPut(rec).then(function () { okCount++; });
      });
    });
    chain.then(function () {
      staged = [];
      renderStaging();
      return refreshClips();
    }).then(function () {
      toast(okCount + '개를 내 소리함에 저장했어요');
      renderSfx(); renderMine();
    }).catch(function (e) {
      console.error(e);
      toast('저장하지 못했어요 — 저장 공간이 부족할 수 있어요', 'err');
    });
  }

  function wireDrop(zone, input, handler) {
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      handler(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handler(e.dataTransfer.files);
    });
  }
  wireDrop(dropEl, fileIn, addFiles);

  function refreshClips() {
    return dbAll().then(function (rows) {
      clips = rows.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
      // 예전 버전에서 'meme'로 저장된 사용자 클립을 'clip'으로 옮김
      clips.forEach(function (r) {
        if (r.cat === 'meme' && (r.src === 'upload' || r.src === 'extract')) {
          r.cat = 'clip';
          dbPut(r).catch(function () { });
        }
      });
      return clips;
    });
  }

  /* =======================================================
     백업 내보내기 / 불러오기
     ======================================================= */
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'application/octet-stream' });
  }

  $('backupOut').addEventListener('click', function () {
    var btn = $('backupOut');
    if (!clips.length) { toast('백업할 소리가 없어요', 'err'); return; }
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = '백업 만드는 중…';
    var payload = {
      format: 'shorts-bgm-box-backup', version: 1,
      exportedAt: new Date().toISOString(), count: clips.length, sounds: []
    };
    var chain = Promise.resolve();
    clips.forEach(function (rec) {
      chain = chain.then(function () {
        return blobToBase64(rec.blob).then(function (b64) {
          payload.sounds.push({
            id: rec.id, name: rec.name, cat: rec.cat, mime: rec.mime, size: rec.size,
            dur: rec.dur, added: rec.added, src: rec.src, ext: rec.ext || '', data: b64
          });
        });
      });
    });
    chain.then(function () {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      saveBlob(blob, '쇼츠브금박스-내소리함-백업-' + stamp() + '.json');
      toast(payload.count + '개 백업 파일을 만들었어요 (' + fmtSize(blob.size) + ')');
    }).catch(function (e) {
      console.error(e);
      toast('백업을 만들지 못했어요', 'err');
    }).then(function () {
      btn.disabled = false; btn.textContent = old;
    });
  });

  $('backupIn').addEventListener('click', function () { $('backupFile').click(); });
  $('backupFile').addEventListener('change', function () {
    var f = $('backupFile').files && $('backupFile').files[0];
    $('backupFile').value = '';
    if (f) importBackup(f);
  });

  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data;
      try { data = JSON.parse(String(fr.result)); } catch (e) { toast('백업 파일을 읽을 수 없어요 (JSON 아님)', 'err'); return; }
      if (!data || data.format !== 'shorts-bgm-box-backup' || !Array.isArray(data.sounds)) {
        toast('쇼츠 브금 박스 백업 파일이 아니에요', 'err');
        return;
      }
      var existingIds = {}, existingKeys = {};
      clips.forEach(function (r) {
        existingIds[r.id] = 1;
        existingKeys[(r.name || '') + '|' + (r.size || 0)] = 1;
      });
      var added = 0, skipped = 0, failed = 0;
      var chain = Promise.resolve();
      data.sounds.forEach(function (s) {
        chain = chain.then(function () {
          if (!s || !s.data) { failed++; return; }
          var key = (s.name || '') + '|' + (s.size || 0);
          if (existingIds[s.id] || existingKeys[key]) { skipped++; return; }
          var blob;
          try { blob = base64ToBlob(s.data, s.mime); } catch (e) { failed++; return; }
          var rec = {
            id: existingIds[s.id] ? uid() : (s.id || uid()),
            name: s.name || ('복원 ' + (added + 1)),
            cat: s.cat || 'clip',
            mime: s.mime || 'audio/mpeg',
            size: s.size || blob.size,
            dur: s.dur || 0,
            added: Date.now(),
            src: s.src || 'upload',
            ext: s.ext || '',
            blob: blob
          };
          return dbPut(rec).then(function () {
            added++;
            existingIds[rec.id] = 1;
            existingKeys[key] = 1;
          });
        });
      });
      chain.then(function () { return refreshClips(); }).then(function () {
        renderSfx(); renderMine();
        toast('복원 완료 — 추가 ' + added + '개' + (skipped ? ' · 이미 있음 ' + skipped + '개' : '') + (failed ? ' · 실패 ' + failed + '개' : ''));
      }).catch(function (e) {
        console.error(e);
        toast('불러오지 못했어요 — 저장 공간이 부족할 수 있어요', 'err');
      });
    };
    fr.onerror = function () { toast('파일을 읽지 못했어요', 'err'); };
    fr.readAsText(file);
  }

  /* =======================================================
     효과음 전체 ZIP
     ======================================================= */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipFiles(files, onProgress) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0, i = 0;
    function step() {
      if (i >= files.length) return Promise.resolve(finish());
      var f = files[i];
      if (onProgress) onProgress(i, files.length, f.name);
      var blob = f.blob || f.make();
      return blob.arrayBuffer().then(function (ab) {
        var data = new Uint8Array(ab);
        var name = enc.encode(f.name);
        var crc = crc32(data);
        var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
        dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
        dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
        dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
        lh.set(name, 30);
        parts.push(lh, data);
        var cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
        cd.set(name, 46);
        central.push(cd);
        offset += lh.length + data.length;
        i++;
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      });
    }
    function finish() {
      var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
      var end = new Uint8Array(22), ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
      ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
    }
    return step();
  }

  $('sfxZip').addEventListener('click', function () {
    var btn = $('sfxZip');
    if (btn.disabled) return;
    btn.disabled = true;
    var old = btn.textContent;
    var files = [];
    SFX.list.forEach(function (d) {
      files.push({
        name: catInfo(d.cat).short + '/' + d.name.replace(/[\\/:*?"<>|]/g, '') + '.wav',
        make: (function (id) { return function () { return SFX.wavBlob(id, SFX.SR); }; })(d.id)
      });
    });
    zipFiles(files, function (i, n, name) {
      btn.textContent = 'ZIP ' + (i + 1) + '/' + n;
    }).then(function (blob) {
      saveBlob(blob, '쇼츠브금박스-효과음-' + SFX.count + '종-WAV.zip');
      toast('효과음 ZIP 저장 (' + fmtSize(blob.size) + ')');
    }).catch(function (e) {
      console.error(e);
      toast('ZIP을 만들지 못했어요', 'err');
    }).then(function () {
      btn.disabled = false; btn.textContent = old;
    });
  });

  /* =======================================================
     영상 소리 추출기
     ======================================================= */
  var xtrack = null;         // { file, buf, peaks }
  var xsel = { a: 0, b: 0 };
  var xcanvas = $('xWave'), xctx = xcanvas.getContext('2d');
  var dragMode = null;

  function setStatus(msg, kind) {
    var s = $('xStatus');
    s.textContent = msg || '';
    s.className = 'xstatus' + (kind ? ' ' + kind : '');
  }

  function drawWave() {
    if (!xtrack || !xtrack.buf || !(xtrack.buf.duration > 0)) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cssW = xcanvas.clientWidth || 600;
    var cssH = 128;
    xcanvas.width = Math.round(cssW * dpr);
    xcanvas.height = Math.round(cssH * dpr);
    var w = xcanvas.width, h = xcanvas.height;
    var buf = xtrack.buf;
    var data = buf.getChannelData(0);
    var step = Math.max(1, Math.floor(data.length / w));
    var peaks = new Float32Array(w);
    var a = Math.floor(xsel.a / buf.duration * w);
    var b = Math.ceil(xsel.b / buf.duration * w);

    xctx.clearRect(0, 0, w, h);
    // 배경
    xctx.fillStyle = '#0e1117';
    xctx.fillRect(0, 0, w, h);
    // 선택 영역
    xctx.fillStyle = 'rgba(110,231,183,.12)';
    xctx.fillRect(a, 0, Math.max(1, b - a), h);
    // 파형
    for (var x = 0; x < w; x++) {
      var start = x * step, mx = 0;
      for (var i = 0; i < step; i += 4) {
        var v = Math.abs(data[start + i] || 0);
        if (v > mx) mx = v;
      }
      peaks[x] = mx;
      var bh = Math.max(1, mx * h * 0.92);
      var inside = x >= a && x <= b;
      xctx.fillStyle = inside ? '#6ee7b7' : '#33405a';
      xctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
    // 중앙선
    xctx.fillStyle = 'rgba(255,255,255,.10)';
    xctx.fillRect(0, h / 2, w, 1);
    // 핸들
    [a, b].forEach(function (px) {
      xctx.fillStyle = '#38bdf8';
      xctx.fillRect(Math.max(0, px - dpr), 0, 2 * dpr, h);
    });
    xtrack.peaks = peaks;
  }

  function pxToTime(px) {
    var w = xcanvas.width || 1;
    return Math.max(0, Math.min(xtrack.buf.duration, px / w * xtrack.buf.duration));
  }
  function clientToX(ev) {
    var rect = xcanvas.getBoundingClientRect();
    var cx = (ev.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, cx)) * xcanvas.width;
  }

  function updateSelLabels() {
    if (!xtrack) return;
    $('xStart').value = xsel.a.toFixed(2);
    $('xEnd').value = xsel.b.toFixed(2);
    $('xStart').max = xtrack.buf.duration.toFixed(2);
    $('xEnd').max = xtrack.buf.duration.toFixed(2);
    $('xLen').textContent = (xsel.b - xsel.a).toFixed(2) + '초';
    syncAutoName();
  }

  function syncAutoName() {
    if (!xtrack) return;
    var el = $('xName');
    var base = (xtrack.file.name || 'clip').replace(/\.[^.]+$/, '');
    var auto = base + ' ' + (xsel.b - xsel.a).toFixed(1) + 's';
    if (!el.value || el.getAttribute('data-auto') === '1') {
      el.value = auto;
      el.setAttribute('data-auto', '1');
    }
  }

  xcanvas.addEventListener('pointerdown', function (ev) {
    if (!xtrack) return;
    xcanvas.setPointerCapture(ev.pointerId);
    var px = clientToX(ev);
    var w = xcanvas.width;
    var aPx = xsel.a / xtrack.buf.duration * w;
    var bPx = xsel.b / xtrack.buf.duration * w;
    var near = 14 * (window.devicePixelRatio || 1);
    if (Math.abs(px - aPx) < near) dragMode = 'a';
    else if (Math.abs(px - bPx) < near) dragMode = 'b';
    else {
      dragMode = 'b';
      xsel.a = pxToTime(px);
      xsel.b = pxToTime(px);
    }
    onDrag(px);
  });
  xcanvas.addEventListener('pointermove', function (ev) {
    if (!dragMode || !xtrack) return;
    onDrag(clientToX(ev));
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    xcanvas.addEventListener(ev, function () {
      if (!dragMode) return;
      dragMode = null;
      if (xsel.b - xsel.a < 0.05) { // 너무 짧으면 그 지점부터 0.15초 확보
        xsel.b = Math.min(xtrack.buf.duration, xsel.a + 0.15);
        if (xsel.b - xsel.a < 0.05) xsel.a = Math.max(0, xsel.b - 0.15);
      }
      updateSelLabels();
      drawWave();
    });
  });
  function onDrag(px) {
    var t = pxToTime(px);
    if (dragMode === 'a') xsel.a = Math.min(t, xsel.b - 0.02);
    else xsel.b = Math.max(t, xsel.a + 0.02);
    if (xsel.a < 0) xsel.a = 0;
    if (xsel.b > xtrack.buf.duration) xsel.b = xtrack.buf.duration;
    updateSelLabels();
    drawWave();
  }

  ['xStart', 'xEnd'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (!xtrack) return;
      var d = xtrack.buf.duration;
      var a = Math.max(0, Math.min(d, parseFloat($('xStart').value) || 0));
      var b = Math.max(0, Math.min(d, parseFloat($('xEnd').value) || 0));
      if (b <= a) b = Math.min(d, a + 0.1);
      xsel.a = a; xsel.b = b;
      updateSelLabels(); drawWave();
    });
  });

  $('xReset').addEventListener('click', function () {
    if (!xtrack) return;
    xsel.a = 0; xsel.b = xtrack.buf.duration;
    updateSelLabels(); drawWave();
  });

  $('xPreview').addEventListener('click', function () {
    if (!xtrack) return;
    if (xsel.b - xsel.a < 0.02) { toast('구간이 너무 짧아요', 'err'); return; }
    playBuf(xtrack.buf, xsel.a, xsel.b - xsel.a, null);
  });
  $('xPreviewAll').addEventListener('click', function () {
    if (xtrack) playBuf(xtrack.buf, 0, null, null);
  });

  /* ---- WAV 인코딩(다채널) ---- */
  function encodeWav(chs, sr) {
    var nch = chs.length, len = chs[0].length;
    var bytes = 44 + len * nch * 2;
    var ab = new ArrayBuffer(bytes), v = new DataView(ab);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * nch * 2, true);
    var o = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < nch; c++) {
        var s = chs[c][i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return ab;
  }

  function buildClip() {
    var buf = xtrack.buf, sr = buf.sampleRate;
    var i0 = Math.max(0, Math.floor(xsel.a * sr));
    var i1 = Math.min(buf.length, Math.floor(xsel.b * sr));
    var len = Math.max(1, i1 - i0);
    var nch = Math.min(2, buf.numberOfChannels);
    var chs = [];
    for (var c = 0; c < nch; c++) {
      var src = buf.getChannelData(c);
      var dst = new Float32Array(len);
      for (var i = 0; i < len; i++) dst[i] = src[i0 + i] || 0;
      chs.push(dst);
    }
    if ($('xNorm').checked) {
      var mx = 0, j;
      for (var k = 0; k < nch; k++) {
        var arr = chs[k];
        for (j = 0; j < len; j++) { var v = Math.abs(arr[j]); if (v > mx) mx = v; }
      }
      if (mx > 0.0001) {
        var g = 0.98 / mx;
        if (g > 40) g = 40;
        for (var m = 0; m < nch; m++) {
          var a2 = chs[m];
          for (j = 0; j < len; j++) a2[j] *= g;
        }
      }
    }
    if ($('xFade').checked) {
      var f = Math.max(1, Math.round(0.005 * sr));
      if (f * 2 < len) {
        for (var n = 0; n < nch; n++) {
          var b2 = chs[n];
          for (j = 0; j < f; j++) { b2[j] *= j / f; b2[len - 1 - j] *= j / f; }
        }
      }
    }
    return { ab: encodeWav(chs, sr), sr: sr, dur: len / sr };
  }

  function clipName() {
    var base = ($('xName').value || '').trim();
    if (base) return base;
    var fn = (xtrack.file.name || 'clip').replace(/\.[^.]+$/, '');
    return fn + ' ' + xsel.a.toFixed(1) + '-' + xsel.b.toFixed(1) + 's';
  }

  $('xName').addEventListener('input', function () {
    this.setAttribute('data-auto', '0');
  });

  $('xSave').addEventListener('click', function () {
    if (!xtrack) return;
    var clip = buildClip();
    var name = clipName();
    var cat = $('xCat').value || 'clip';
    var blob = new Blob([clip.ab], { type: 'audio/wav' });
    var rec = {
      id: uid(), name: name, cat: cat, mime: 'audio/wav', size: blob.size,
      dur: clip.dur, added: Date.now(), src: 'extract', ext: '.wav', blob: blob
    };
    dbPut(rec).then(function () {
      return refreshClips();
    }).then(function () {
      renderSfx(); renderMine();
      toast('내 소리함에 저장했어요 — 🔥 유행·스트리머 대사에서 확인');
      $('xName').value = '';
      $('xName').setAttribute('data-auto', '1');
    }).catch(function (e) {
      console.error(e);
      toast('저장하지 못했어요 (저장 공간 부족?)', 'err');
    });
  });

  $('xDownload').addEventListener('click', function () {
    if (!xtrack) return;
    var clip = buildClip();
    saveBlob(new Blob([clip.ab], { type: 'audio/wav' }), clipName().replace(/[\\/:*?"<>|]/g, '') + '.wav');
    toast('WAV로 저장했어요 (' + clip.dur.toFixed(2) + '초)');
  });

  function loadExtractFile(file) {
    if (!file) return;
    setStatus('영상에서 소리를 꺼내는 중… (파일 크기에 따라 몇 초 걸려요)');
    $('xStage').hidden = true;
    var abP = file.arrayBuffer();
    abP.then(function (ab) {
      return new Promise(function (res, rej) {
        var p = ac().decodeAudioData(ab, function (buf) { res(buf); }, function (e) { rej(e || new Error('decode')); });
        if (p && p.then) p.then(res, function (e) { rej(e); });
      });
    }).then(function (buf) {
      xtrack = { file: file, buf: buf };
      xsel.a = 0;
      xsel.b = buf.duration;
      $('xName').value = '';
      $('xName').setAttribute('data-auto', '1');
      $('xInfo').innerHTML =
        '<span class="pill">파일 <b>' + esc(file.name) + '</b></span>' +
        '<span class="pill">길이 <b>' + buf.duration.toFixed(2) + '초</b></span>' +
        '<span class="pill">채널 <b>' + buf.numberOfChannels + '</b></span>' +
        '<span class="pill">샘플레이트 <b>' + buf.sampleRate + 'Hz</b></span>';
      $('xStage').hidden = false;
      updateSelLabels();
      drawWave();
      setStatus('파형을 드래그해 구간을 잡고 [▶ 구간 듣기]로 확인하세요.', 'ok');
    }).catch(function (e) {
      console.error(e);
      setStatus('이 파일의 소리를 읽지 못했어요. MP4·MOV·WebM·MP3 파일인지 확인해 주세요. (영상에 소리 트랙이 없으면 추출할 수 없어요)', 'err');
    });
  }
  wireDrop($('xDrop'), $('xFile'), function (files) {
    if (files && files[0]) {
      if (files[0].size > 250 * 1024 * 1024) {
        toast('파일이 너무 커요 — 250MB 이하로 잘라 올려 주세요', 'err');
        return;
      }
      loadExtractFile(files[0]);
    }
  });

  window.addEventListener('resize', function () {
    if (xtrack && !$('xStage').hidden) drawWave();
  });

  /* =======================================================
     부트
     ======================================================= */
  // 추출기 카테고리 셀렉트
  $('xCat').innerHTML = SFX.USER_CATS.map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === 'clip' ? ' selected' : '') + '>' + esc(c.emoji + ' ' + c.name) + '</option>';
  }).join('');

  $('tSfx').textContent = String(SFX.list.length);

  refreshClips().then(function () {
    renderSfxChips();
    renderMine();
    var hash = (location.hash || '').replace('#', '');
    if (['sfx', 'mine', 'extract'].indexOf(hash) !== -1) setTab(hash);
    else setTab('bgm');
  }).catch(function (e) {
    console.error(e);
    renderSfx();
    setTab('bgm');
  });
})();
