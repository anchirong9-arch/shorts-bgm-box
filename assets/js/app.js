/* 쇼츠 브금 박스 — 프론트엔드 로직 (의존성 없음) */
(function () {
  'use strict';

  var audio = document.getElementById('audio');
  var grid = document.getElementById('grid');
  var chips = document.getElementById('chips');
  var qInput = document.getElementById('q');
  var clearBtn = document.getElementById('clear');
  var sortSel = document.getElementById('sort');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var statsEl = document.getElementById('stats');
  var creditsBody = document.getElementById('creditsBody');
  var zipCat = document.getElementById('zipCat');

  var ppBtn = document.getElementById('pp');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var repeatBtn = document.getElementById('repeat');
  var seek = document.getElementById('seek');
  var curEl = document.getElementById('cur');
  var durEl = document.getElementById('dur');
  var nowTitle = document.getElementById('nowTitle');
  var nowMeta = document.getElementById('nowMeta');
  var dlCur = document.getElementById('dlCur');

  var DATA = null;
  var state = { cat: 'all', q: '', sort: 'default', list: [], currentId: null, repeatOne: false };
  var zipping = false;

  /* ---------- zip (store 방식, 의존성 없음) ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipPath(t) {
    var folder = { comedy: '01-comedy', chase: '02-chase', daily: '03-daily', drama: '04-drama', shopping: '05-shopping' }[t.category] || 'etc';
    var n = (t.no < 10 ? '0' : '') + t.no;
    return folder + '/' + n + ' ' + t.title + ' - ' + t.composer + ' (CC0).mp3';
  }
  function makeZip(tracks, onProgress) {
    var enc = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    var chain = Promise.resolve();
    tracks.forEach(function (t, i) {
      chain = chain.then(function () {
        if (onProgress) onProgress(i, tracks.length, t);
        return fetch(t.file).then(function (r) {
          if (!r.ok) throw new Error(t.title + ' 내려받기 실패');
          return r.arrayBuffer();
        }).then(function (ab) {
          var data = new Uint8Array(ab);
          var name = enc.encode(zipPath(t));
          var crc = crc32(data);
          var lh = new Uint8Array(30 + name.length);
          var dv = new DataView(lh.buffer);
          dv.setUint32(0, 0x04034b50, true);
          dv.setUint16(4, 20, true);
          dv.setUint16(6, 0x0800, true);
          dv.setUint16(8, 0, true);
          dv.setUint16(10, 0, true);
          dv.setUint16(12, 0x21, true);
          dv.setUint32(14, crc, true);
          dv.setUint32(18, data.length, true);
          dv.setUint32(22, data.length, true);
          dv.setUint16(26, name.length, true);
          dv.setUint16(28, 0, true);
          lh.set(name, 30);
          parts.push(lh, data);

          var cd = new Uint8Array(46 + name.length);
          var cv = new DataView(cd.buffer);
          cv.setUint32(0, 0x02014b50, true);
          cv.setUint16(4, 20, true);
          cv.setUint16(6, 20, true);
          cv.setUint16(8, 0x0800, true);
          cv.setUint16(10, 0, true);
          cv.setUint16(12, 0, true);
          cv.setUint16(14, 0x21, true);
          cv.setUint32(16, crc, true);
          cv.setUint32(20, data.length, true);
          cv.setUint32(24, data.length, true);
          cv.setUint16(28, name.length, true);
          cv.setUint16(30, 0, true);
          cv.setUint16(32, 0, true);
          cv.setUint16(34, 0, true);
          cv.setUint16(36, 0, true);
          cv.setUint32(38, 0, true);
          cv.setUint32(42, offset, true);
          cd.set(name, 46);
          central.push(cd);

          offset += lh.length + data.length;
        });
      });
    });
    return chain.then(function () {
      var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
      var end = new Uint8Array(22);
      var ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, tracks.length, true);
      ev.setUint16(10, tracks.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, offset, true);
      ev.setUint16(20, 0, true);
      return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
    });
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 30000);
  }

  /* ---------- utils ---------- */
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtSize(bytes) {
    return (bytes / 1000000).toFixed(1) + 'MB';
  }
  function dlName(t) {
    return t.title + ' - ' + t.composer + ' (CC0).mp3';
  }
  function byId(id) {
    for (var i = 0; i < DATA.tracks.length; i++) if (DATA.tracks[i].id === id) return DATA.tracks[i];
    return null;
  }
  function catOf(id) {
    for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].id === id) return DATA.categories[i];
    return null;
  }

  /* ---------- render ---------- */
  function matches(t, q) {
    if (!q) return true;
    var hay = [t.title, t.titleKo, t.composer, t.use, t.desc, t.tags.join(' '), (catOf(t.category) || {}).name || '']
      .join(' ').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function computeList() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.tracks.filter(function (t) {
      return (state.cat === 'all' || t.category === state.cat) && matches(t, q);
    });
    var s = state.sort;
    if (s === 'short') list.sort(function (a, b) { return a.duration - b.duration; });
    else if (s === 'long') list.sort(function (a, b) { return b.duration - a.duration; });
    else if (s === 'bpm-asc') list.sort(function (a, b) { return a.bpm - b.bpm; });
    else if (s === 'bpm-desc') list.sort(function (a, b) { return b.bpm - a.bpm; });
    state.list = list;
    return list;
  }

  function renderChips() {
    var total = DATA.tracks.length;
    var html = chipHtml('all', '🎧', '전체', total);
    DATA.categories.forEach(function (c) {
      var n = DATA.tracks.filter(function (t) { return t.category === c.id; }).length;
      html += chipHtml(c.id, c.emoji, c.name, n);
    });
    chips.innerHTML = html;
  }
  function chipHtml(id, emoji, name, n) {
    return '<button type="button" class="chip" role="tab" data-cat="' + id + '" aria-selected="' + (state.cat === id) + '">' +
      '<span aria-hidden="true">' + emoji + '</span>' + name + '<span class="n">' + n + '</span></button>';
  }
  function renderChipState() {
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-cat') === state.cat));
    });
  }

  function renderGrid() {
    var list = computeList();
    countEl.textContent = list.length + '곡' +
      (state.cat === 'all' ? '' : ' · ' + catOf(state.cat).name) +
      (state.q ? ' · "' + state.q.trim() + '"' : '');
    emptyEl.hidden = list.length !== 0;

    if (zipCat) {
      if (state.cat !== 'all' && DATA.zips && DATA.zips[state.cat]) {
        var z = DATA.zips[state.cat];
        zipCat.href = z.path;
        zipCat.setAttribute('download', '');
        zipCat.textContent = '📦 ' + catOf(state.cat).short + '만 ZIP · ' + fmtSize(z.size);
        zipCat.hidden = false;
      } else {
        zipCat.hidden = true;
      }
    }

    grid.innerHTML = list.map(function (t) {
      var c = catOf(t.category);
      var isCur = state.currentId === t.id;
      return '' +
        '<article class="card' + (isCur ? ' playing' : '') + '" data-id="' + t.id + '" style="--cat:' + c.color + '">' +
          '<div class="card-top">' +
            '<button type="button" class="play" data-act="play" aria-label="' + t.title + ' 재생">' + (isCur && !audio.paused ? '❚❚' : '▶') + '</button>' +
            '<div class="title-wrap">' +
              '<h3>' + t.title + '</h3>' +
              '<p class="ko">' + t.titleKo + '</p>' +
              '<p class="by">' + t.composer + ' · ' + c.emoji + ' ' + c.short + '</p>' +
            '</div>' +
            '<span class="badge">CC0</span>' +
          '</div>' +
          '<p class="desc">' + t.desc + '</p>' +
          '<div class="meta">' +
            '<span>⏱ ' + fmtTime(t.duration) + '</span>' +
            '<span>🥁 ≈' + t.bpm + ' BPM</span>' +
            '<span>💾 ' + fmtSize(t.size) + '</span>' +
          '</div>' +
          '<div class="tags">' + t.tags.map(function (g) { return '<span class="tag">#' + g + '</span>'; }).join('') + '</div>' +
          '<p class="use"><b>추천</b> ' + t.use + '</p>' +
          '<div class="card-foot">' +
            '<span class="lic">CC0 · 상업적 이용/수익 창출 OK</span>' +
            '<a class="dl-btn" href="' + t.file + '" download="' + dlName(t) + '" data-act="dl">⬇ MP3</a>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  function renderCredits() {
    creditsBody.innerHTML = DATA.tracks.map(function (t) {
      return '<tr><td>' + t.no + '</td><td>' + t.title + '</td><td>' + t.composer + '</td>' +
        '<td class="p">' + t.freePdPath + '</td><td>CC0 1.0</td></tr>';
    }).join('');
  }

  function renderStats() {
    var mins = Math.round(DATA.totalDuration / 60);
    statsEl.innerHTML =
      '<span class="stat"><b>' + DATA.tracks.length + '곡</b></span>' +
      '<span class="stat"><b>' + mins + '분</b></span>' +
      '<span class="stat"><b>' + fmtSize(DATA.totalSize) + '</b></span>' +
      '<span class="stat">상업적 이용 <b>가능</b></span>';
  }

  /* ---------- player ---------- */
  function setPlayIcon() {
    var playing = !audio.paused && !audio.ended && !!audio.src;
    ppBtn.textContent = playing ? '❚❚' : '▶';
    ppBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
    Array.prototype.forEach.call(grid.querySelectorAll('.card'), function (c) {
      var isCur = c.getAttribute('data-id') === state.currentId;
      c.classList.toggle('playing', isCur && playing);
      var b = c.querySelector('.play');
      if (b) {
        b.textContent = (isCur && playing) ? '❚❚' : '▶';
        b.setAttribute('aria-label', (b.closest('.card').querySelector('h3') || {}).textContent + (isCur && playing ? ' 일시정지' : ' 재생'));
      }
    });
  }

  function loadTrack(t, autoplay) {
    if (!t) return;
    state.currentId = t.id;
    audio.src = t.file;
    nowTitle.textContent = t.title;
    nowMeta.textContent = t.composer + ' · ' + fmtTime(t.duration) + ' · ≈' + t.bpm + ' BPM';
    dlCur.href = t.file;
    dlCur.setAttribute('download', dlName(t));
    durEl.textContent = fmtTime(t.duration);
    curEl.textContent = '0:00';
    seek.value = 0;
    setPlayIcon();
    if (autoplay) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked */ });
    }
  }

  function playById(id) {
    var t = byId(id);
    if (!t) return;
    if (state.currentId === id && audio.src) {
      if (audio.paused) audio.play().catch(function () {}); else audio.pause();
      return;
    }
    loadTrack(t, true);
  }

  function step(dir) {
    var list = state.list.length ? state.list : DATA.tracks;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === state.currentId) { idx = i; break; }
    var next = list[(idx + dir + list.length) % list.length];
    if (next) loadTrack(next, true);
  }

  /* ---------- events ---------- */
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    state.cat = b.getAttribute('data-cat');
    renderChipState();
    renderGrid();
  });

  qInput.addEventListener('input', function () {
    state.q = qInput.value;
    clearBtn.hidden = !state.q;
    renderGrid();
  });
  clearBtn.addEventListener('click', function () {
    qInput.value = ''; state.q = ''; clearBtn.hidden = true; renderGrid(); qInput.focus();
  });
  sortSel.addEventListener('change', function () { state.sort = sortSel.value; renderGrid(); });

  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act="play"]');
    if (btn) {
      var card = btn.closest('.card');
      playById(card.getAttribute('data-id'));
      return;
    }
  });

  ppBtn.addEventListener('click', function () {
    if (!audio.src) {
      var first = (state.list.length ? state.list : DATA.tracks)[0];
      if (first) loadTrack(first, true);
      return;
    }
    if (audio.paused) audio.play().catch(function () {}); else audio.pause();
  });
  prevBtn.addEventListener('click', function () {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    step(-1);
  });
  nextBtn.addEventListener('click', function () { step(1); });
  repeatBtn.addEventListener('click', function () {
    state.repeatOne = !state.repeatOne;
    repeatBtn.setAttribute('aria-pressed', String(state.repeatOne));
    repeatBtn.title = state.repeatOne ? '한 곡 반복 켜짐' : '한 곡 반복';
  });

  seek.addEventListener('input', function () {
    if (!audio.duration) return;
    audio.currentTime = (seek.value / 1000) * audio.duration;
    curEl.textContent = fmtTime(audio.currentTime);
  });

  audio.addEventListener('play', setPlayIcon);
  audio.addEventListener('pause', setPlayIcon);
  audio.addEventListener('loadedmetadata', function () {
    durEl.textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('timeupdate', function () {
    curEl.textContent = fmtTime(audio.currentTime);
    if (audio.duration) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
  });
  audio.addEventListener('ended', function () {
    if (state.repeatOne) { audio.currentTime = 0; audio.play().catch(function () {}); return; }
    step(1);
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space') { e.preventDefault(); ppBtn.click(); }
  });

  /* ---------- 전체 ZIP ---------- */
  function wireZipButton() {
    var btn = document.getElementById('zipAll');
    if (!btn || !DATA) return;
    btn.title = '전체 ' + DATA.tracks.length + '곡 · ' + fmtSize(DATA.totalSize) + ' ZIP (브라우저에서 생성)';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (zipping) return;
      zipping = true;
      var label = btn.innerHTML;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('busy');
      makeZip(DATA.tracks, function (i, n, t) {
        btn.textContent = 'ZIP 만드는 중… ' + (i + 1) + '/' + n + ' (' + t.title + ')';
      }).then(function (blob) {
        saveBlob(blob, '쇼츠 브금 박스 - CC0 BGM 20곡.zip');
        btn.innerHTML = '✅ ZIP 저장됨 (' + fmtSize(blob.size) + ')';
        setTimeout(function () { btn.innerHTML = label; btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); }, 5000);
      }).catch(function (err) {
        btn.innerHTML = '⚠ 다시 시도';
        btn.classList.remove('busy');
        btn.removeAttribute('aria-busy');
        alert('ZIP을 만들지 못했어요: ' + (err && err.message ? err.message : err) + '\n카테고리별 ZIP을 이용해 주세요.');
      }).then(function () { zipping = false; });
    });
  }

  /* ---------- boot ---------- */
  fetch('assets/data/tracks.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('데이터를 불러오지 못했습니다'); return r.json(); })
    .then(function (data) {
      DATA = data;
      renderChips();
      renderStats();
      renderGrid();
      renderCredits();
      wireZipButton();
    })
    .catch(function (err) {
      grid.innerHTML = '<p class="empty">' + (err && err.message ? err.message : '오류') + '</p>';
    });
})();
