/*!
 * 쇼츠 브금 박스 — 효과음(SFX) 합성 라이브러리
 * 모든 효과음은 이 파일 안에서 수학적으로 합성됩니다(외부 음원·저작권 없음, CC0).
 * 사용: SFXLib.list / SFXLib.render(id) / SFXLib.toWav(buffer) / SFXLib.wavBlob(id)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFXLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SR = 44100;
  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(seed) {
    var s = (seed | 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s |= 0;
      s ^= s >>> 17;
      s ^= s << 5; s |= 0;
      return ((s >>> 0) / 2147483648) - 1; // -1..1
    };
  }

  /* ---------------- biquad ---------------- */
  function Biquad() { this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; }
  Biquad.prototype.set = function (type, f, q, sr) {
    f = clamp(f, 20, sr * 0.45);
    q = q > 0 ? q : 0.7071;
    var w0 = TAU * f / sr, cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q);
    var b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  };
  Biquad.prototype.run = function (x) {
    var y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  };

  /* ---------------- waveform ---------------- */
  function wave(type, ph, duty) {
    switch (type) {
      case 'tri': return 1 - 4 * Math.abs(ph - 0.5);
      case 'sq': return ph < (duty || 0.5) ? 1 : -1;
      case 'saw': return 2 * ph - 1;
      default: return Math.sin(TAU * ph);
    }
  }

  /* ---------------- engine ---------------- */
  function Engine(dur, sr) {
    this.sr = sr;
    this.dur = dur;
    this.out = new Float32Array(Math.max(1, Math.ceil((dur + 0.08) * sr)));
  }

  // envelope: attack deкрays with exponential time constant `dec`, linear release at the end
  function env(t, dur, atk, dec, rel) {
    if (t < 0 || t > dur) return 0;
    var a = atk > 0 ? Math.min(1, t / atk) : 1;
    var d = dec > 0 ? Math.exp(-(t - atk > 0 ? t - atk : 0) / dec) : 1;
    var r = rel > 0 ? Math.min(1, (dur - t) / rel) : 1;
    return a * d * (r > 0 ? r : 0);
  }

  Engine.prototype.add = function (buf, t0, gain) {
    var sr = this.sr, n0 = Math.round((t0 || 0) * sr), out = this.out;
    for (var i = 0; i < buf.length; i++) {
      var k = n0 + i;
      if (k >= 0 && k < out.length) out[k] += buf[i] * (gain == null ? 1 : gain);
    }
  };

  /* tone: chirp / vibrato / waveform */
  Engine.prototype.tone = function (o) {
    var sr = this.sr, out = this.out;
    var t0 = o.t0 || 0, dur = o.dur || 0.2, f0 = o.f0 || 440, f1 = o.f1 == null ? f0 : o.f1;
    var amp = o.amp == null ? 0.5 : o.amp, atk = o.atk == null ? 0.004 : o.atk;
    var dec = o.dec == null ? dur / 2.2 : o.dec, rel = o.rel == null ? Math.min(0.04, dur * 0.3) : o.rel;
    var type = o.type || 'sine', duty = o.duty, vib = o.vib || 0, vibRate = o.vibRate || 5.5;
    var gl = o.glide || 'exp', n = Math.max(1, Math.round(dur * sr)), n0 = Math.round(t0 * sr);
    var ph = o.phase || 0, lp = null;
    if (o.lp) { lp = new Biquad(); lp.set('lp', o.lp, o.lpQ || 0.7071, sr); }
    for (var i = 0; i < n; i++) {
      var p = i / n;
      var f = gl === 'exp' && f0 > 0 && f1 > 0 ? f0 * Math.pow(f1 / f0, p) : f0 + (f1 - f0) * p;
      if (vib) f *= 1 + vib * Math.sin(TAU * vibRate * i / sr);
      ph += f / sr;
      if (ph >= 1) ph -= Math.floor(ph);
      var s = wave(type, ph, duty) * amp * env(i / sr, dur, atk, dec, rel);
      if (lp) s = lp.run(s);
      var k = n0 + i;
      if (k >= 0 && k < out.length) out[k] += s;
    }
  };

  /* noise with moving biquad filter */
  Engine.prototype.noise = function (o) {
    var sr = this.sr, out = this.out;
    var t0 = o.t0 || 0, dur = o.dur || 0.2, amp = o.amp == null ? 0.4 : o.amp;
    var atk = o.atk == null ? 0.003 : o.atk, dec = o.dec == null ? dur / 2.4 : o.dec;
    var rel = o.rel == null ? Math.min(0.04, dur * 0.3) : o.rel;
    var type = o.filter || 'bp', f0 = o.f0 || 1200, f1 = o.f1 == null ? f0 : o.f1, q = o.q || 1;
    var n = Math.max(1, Math.round(dur * sr)), n0 = Math.round(t0 * sr);
    var r = rnd(o.seed || 24681357);
    var bq = new Biquad();
    var block = 32, cf = f0;
    for (var i = 0; i < n; i++) {
      if (i % block === 0) {
        var p = i / n;
        cf = f0 > 0 && f1 > 0 ? f0 * Math.pow(f1 / f0, p) : f0 + (f1 - f0) * p;
        bq.set(type, cf, q, sr);
      }
      var s = bq.run(r()) * amp * env(i / sr, dur, atk, dec, rel);
      var k = n0 + i;
      if (k >= 0 && k < out.length) out[k] *= 1, out[k] += s;
    }
  };

  /* short click transient */
  Engine.prototype.click = function (t0, amp, f) {
    amp = amp == null ? 0.5 : amp;
    this.noise({ t0: t0, dur: 0.006, amp: amp, filter: 'hp', f0: f || 2600, q: 0.8, atk: 0.0005, dec: 0.0022 });
    this.tone({ t0: t0, dur: 0.012, f0: (f || 2600) * 0.9, f1: (f || 2600) * 0.6, amp: amp * 0.5, atk: 0.0005, dec: 0.004, rel: 0.005 });
  };

  /* bell: inharmonic partials */
  Engine.prototype.bell = function (o) {
    var f = o.f || 880, t0 = o.t0 || 0, dur = o.dur || 1, amp = o.amp == null ? 0.5 : o.amp;
    var part = o.partials || [[1, 1], [2.01, 0.45], [2.98, 0.22], [4.16, 0.12], [5.43, 0.06]];
    for (var i = 0; i < part.length; i++) {
      this.tone({
        t0: t0, dur: dur * (i === 0 ? 1 : 0.72), f0: f * part[i][0], f1: f * part[i][0] * (o.bend || 1),
        amp: amp * part[i][1], atk: 0.002, dec: dur * (i === 0 ? 0.42 : 0.2), rel: Math.min(0.15, dur * 0.3), type: o.type || 'sine'
      });
    }
  };

  /* kick / thump */
  Engine.prototype.kick = function (o) {
    o = o || {};
    var t0 = o.t0 || 0, amp = o.amp == null ? 0.85 : o.amp, dur = o.dur || 0.3, from = o.from || 120, to = o.to || 45;
    this.tone({ t0: t0, dur: dur, f0: from, f1: to, amp: amp, atk: 0.002, dec: dur * 0.35, rel: dur * 0.25, type: 'sine' });
    this.noise({ t0: t0, dur: Math.min(0.08, dur * 0.3), amp: amp * 0.28, filter: 'lp', f0: 900, f1: 300, q: 0.8, atk: 0.001, dec: 0.02 });
  };

  /* snare-ish hit */
  Engine.prototype.snare = function (o) {
    o = o || {};
    var t0 = o.t0 || 0, amp = o.amp == null ? 0.5 : o.amp;
    this.noise({ t0: t0, dur: 0.13, amp: amp, filter: 'bp', f0: 1900, f1: 1300, q: 0.9, atk: 0.001, dec: 0.035 });
    this.tone({ t0: t0, dur: 0.09, f0: 220, f1: 160, amp: amp * 0.5, atk: 0.001, dec: 0.03, type: 'tri' });
  };

  /* hand clap */
  Engine.prototype.clap = function (o) {
    o = o || {};
    var t0 = o.t0 || 0, amp = o.amp == null ? 0.4 : o.amp;
    for (var i = 0; i < 3; i++) {
      this.noise({ t0: t0 + i * 0.008, dur: 0.02, amp: amp * (1 - i * 0.25), filter: 'bp', f0: 1500 + i * 400, q: 1.2, atk: 0.0008, dec: 0.006 });
    }
    this.noise({ t0: t0 + 0.02, dur: 0.09, amp: amp * 0.5, filter: 'bp', f0: 1800, q: 0.9, atk: 0.001, dec: 0.03 });
  };

  /* cymbal / crash */
  Engine.prototype.cymbal = function (o) {
    o = o || {};
    var t0 = o.t0 || 0, amp = o.amp == null ? 0.4 : o.amp, dur = o.dur || 1.4;
    this.noise({ t0: t0, dur: dur, amp: amp, filter: 'hp', f0: 4800, q: 0.6, atk: 0.002, dec: dur * 0.3, seed: 91117 });
    this.noise({ t0: t0, dur: dur * 0.5, amp: amp * 0.5, filter: 'bp', f0: 8200, q: 0.8, atk: 0.002, dec: dur * 0.2, seed: 4113 });
  };

  /* simple Schroeder reverb */
  Engine.prototype.rev = function (o) {
    o = o || {};
    var sr = this.sr, mix = o.mix == null ? 0.18 : o.mix, rt = o.rt || 0.6, size = o.size || 1, damp = o.damp == null ? 0.35 : o.damp;
    var out = this.out, n = out.length;
    var wet = new Float32Array(n);
    var combD = [0.0297, 0.0371, 0.0411, 0.0437], apD = [0.005, 0.0017];
    var i, j;
    for (var c = 0; c < combD.length; c++) {
      var d = Math.max(1, Math.round(combD[c] * size * sr));
      var g = Math.pow(10, -3 * (d / sr) / Math.max(0.05, rt));
      var buf = new Float32Array(d), idx = 0, lpz = 0;
      for (i = 0; i < n; i++) {
        var y = buf[idx];
        lpz = y * (1 - damp) + lpz * damp;
        buf[idx] = out[i] + lpz * g;
        wet[i] += y * 0.25;
        idx = idx + 1 === d ? 0 : idx + 1;
      }
    }
    for (var a = 0; a < apD.length; a++) {
      var ad = Math.max(1, Math.round(apD[a] * size * sr));
      var ab = new Float32Array(ad), ai = 0;
      for (i = 0; i < n; i++) {
        var bo = ab[ai];
        var inx = wet[i] + bo * 0.5;
        ab[ai] = inx;
        wet[i] = bo - inx * 0.5;
        ai = ai + 1 === ad ? 0 : ai + 1;
      }
    }
    for (j = 0; j < n; j++) out[j] = out[j] * (1 - mix * 0.55) + wet[j] * mix;
  };

  Engine.prototype.finish = function (peak) {
    var out = this.out, mx = 0, i;
    for (i = 0; i < out.length; i++) { var v = Math.abs(out[i]); if (v > mx) mx = v; }
    if (mx > 0) {
      var g = (peak || 0.92) / mx;
      if (g > 6) g = 6;
      for (i = 0; i < out.length; i++) out[i] = clamp(out[i] * g, -1, 1);
    }
    // 마지막 5ms 페이드아웃(클릭 방지)
    var fade = Math.round(0.005 * this.sr);
    for (i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
    return out;
  };

  /* ---------------- effect definitions ---------------- */
  /* cat: cute(귀여운) / edit(편집 기본) / fun(예능·웃긴) */

  var DEFS = [
    /* ---------- 귀여운 효과음 ---------- */
    {
      id: 'ppak', name: '뾱!', cat: 'cute', dur: 0.18, tags: ['팝', '등장', '톡'],
      desc: '짧고 발랄한 "뾱". 뭔가 톡 튀어나오거나 말풍선이 뜰 때.',
      use: '자막 등장·아이템 획득·리액션',
      make: function (e) {
        e.tone({ dur: 0.075, f0: 720, f1: 1560, amp: 0.55, atk: 0.002, dec: 0.022, type: 'sine' });
        e.click(0, 0.16, 3200);
        e.tone({ t0: 0.05, dur: 0.09, f0: 1500, f1: 980, amp: 0.22, atk: 0.003, dec: 0.03, type: 'sine' });
      }
    },
    {
      id: 'boing', name: '뽀잉~', cat: 'cute', dur: 0.55, tags: ['스프링', '튀김', '만화'],
      desc: '용수철이 튀는 "뽀잉". 만화 같은 점프·튕김 연출에.',
      use: '캐릭터 점프·튕겨나감·놀람',
      make: function (e) {
        e.tone({ dur: 0.12, f0: 190, f1: 540, amp: 0.5, atk: 0.004, dec: 0.05, type: 'tri' });
        e.tone({ t0: 0.08, dur: 0.4, f0: 540, f1: 240, amp: 0.42, atk: 0.004, dec: 0.13, type: 'tri', vib: 0.05, vibRate: 15 });
        e.tone({ t0: 0.08, dur: 0.4, f0: 1080, f1: 480, amp: 0.1, atk: 0.004, dec: 0.1, type: 'sine' });
      }
    },
    {
      id: 'diyong', name: '띠용~', cat: 'cute', dur: 0.85, tags: ['반짝', '마법', '상승'],
      desc: '위로 스윽 올라가는 "띠용~". 뭔가 나타나거나 반짝일 때.',
      use: '아이템 등장·마법·변신',
      make: function (e) {
        e.bell({ f: 880, dur: 0.8, amp: 0.3, bend: 1.5, partials: [[1, 1], [2.0, 0.35], [3.01, 0.15]] });
        e.tone({ t0: 0.02, dur: 0.6, f0: 1320, f1: 2350, amp: 0.1, atk: 0.01, dec: 0.2, type: 'sine' });
        e.rev({ mix: 0.2, rt: 0.7 });
      }
    },
    {
      id: 'dingdong', name: '딩동', cat: 'cute', dur: 1.0, tags: ['초인종', '알림', '벨'],
      desc: '도레미 초인종 "딩-동". 문 열림·방문 알림 느낌.',
      use: '알림·등장 신호·인터폰',
      make: function (e) {
        e.bell({ f: 659.25, dur: 0.6, amp: 0.45 });
        e.bell({ t0: 0.3, f: 523.25, dur: 0.75, amp: 0.45 });
        e.rev({ mix: 0.16, rt: 0.9 });
      }
    },
    {
      id: 'ping', name: '알림 핑', cat: 'cute', dur: 0.6, tags: ['알림', '메시지', '카톡'],
      desc: '메시지 알림음 같은 "핑". 자막·DM 연출에.',
      use: '메시지 도착·알림·확인',
      make: function (e) {
        e.tone({ dur: 0.2, f0: 1568, amp: 0.4, atk: 0.002, dec: 0.055, type: 'sine' });
        e.tone({ t0: 0.11, dur: 0.3, f0: 2093, amp: 0.32, atk: 0.002, dec: 0.09, type: 'sine' });
        e.rev({ mix: 0.12, rt: 0.5 });
      }
    },
    {
      id: 'twinkle', name: '반짝반짝', cat: 'cute', dur: 0.95, tags: ['반짝', '마법', '상승'],
      desc: '높은 음이 종종종 올라가는 반짝임. 성공·획득 연출.',
      use: '성공·아이템 획득·눈 반짝',
      make: function (e) {
        var notes = [1046.5, 1318.5, 1568, 2093, 2637];
        for (var i = 0; i < notes.length; i++) {
          e.tone({ t0: i * 0.075, dur: 0.3, f0: notes[i], amp: 0.26 - i * 0.02, atk: 0.002, dec: 0.07, type: 'sine' });
          e.tone({ t0: i * 0.075, dur: 0.22, f0: notes[i] * 2, amp: 0.06, atk: 0.002, dec: 0.05, type: 'sine' });
        }
        e.rev({ mix: 0.22, rt: 0.8 });
      }
    },
    {
      id: 'pyong', name: '뿅!', cat: 'cute', dur: 0.45, tags: ['등장', '변신', '팝'],
      desc: '연기 나며 나타나는 "뿅". 캐릭터 등장·변신에.',
      use: '등장·변신·퇴장',
      make: function (e) {
        e.noise({ dur: 0.2, amp: 0.22, filter: 'hp', f0: 2200, f1: 7000, q: 0.7, atk: 0.01, dec: 0.05, seed: 7711 });
        e.tone({ dur: 0.13, f0: 380, f1: 1500, amp: 0.35, atk: 0.004, dec: 0.03 });
        e.tone({ t0: 0.1, dur: 0.2, f0: 1500, f1: 2600, amp: 0.12, atk: 0.004, dec: 0.06 });
        e.rev({ mix: 0.18, rt: 0.5 });
      }
    },
    {
      id: 'heartbeat', name: '두근두근', cat: 'cute', dur: 1.15, tags: ['심장', '긴장', '설렘'],
      desc: '쿵-쿵 두 번 뛰는 심장 소리. 고백·긴장 장면.',
      use: '설렘·긴장·초조',
      make: function (e) {
        e.kick({ t0: 0.02, dur: 0.24, from: 78, to: 42, amp: 0.85 });
        e.kick({ t0: 0.3, dur: 0.26, from: 72, to: 40, amp: 0.7 });
        e.kick({ t0: 0.62, from: 70, to: 40, amp: 0.55, dur: 0.22 });
        e.kick({ t0: 0.88, from: 66, to: 38, amp: 0.42, dur: 0.22 });
        e.rev({ mix: 0.1, rt: 0.4 });
      }
    },
    {
      id: 'droplet', name: '물방울', cat: 'cute', dur: 0.3, tags: ['물', '똑', '맑은'],
      desc: '똑 떨어지는 물방울. 맑고 깨끗한 전환에.',
      use: '물·똑똑·깔끔한 포인트',
      make: function (e) {
        e.tone({ dur: 0.1, f0: 480, f1: 1400, amp: 0.45, atk: 0.002, dec: 0.028 });
        e.tone({ t0: 0.055, dur: 0.09, f0: 1350, f1: 2200, amp: 0.16, atk: 0.002, dec: 0.028 });
        e.rev({ mix: 0.15, rt: 0.45 });
      }
    },
    {
      id: 'jjaeng', name: '쨍그랑', cat: 'cute', dur: 1.4, tags: ['종', '벨', '반짝'],
      desc: '작은 종이 쨍그랑. 축하·포인트 강조에.',
      use: '축하·성공·강조',
      make: function (e) {
        e.bell({ f: 1760, dur: 1.2, amp: 0.36, partials: [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.9, 0.08]] });
        e.rev({ mix: 0.26, rt: 1.2 });
      }
    },
    {
      id: 'nomnom', name: '냠냠', cat: 'cute', dur: 0.62, tags: ['먹방', '씹기', '귀여움'],
      desc: '오물오물 먹는 소리. 먹방·간식 리뷰에.',
      use: '먹방·간식·맛있음',
      make: function (e) {
        for (var i = 0; i < 3; i++) {
          e.noise({ t0: i * 0.17, dur: 0.13, amp: 0.4 - i * 0.05, filter: 'lp', f0: 700 - i * 80, f1: 300, q: 0.9, atk: 0.006, dec: 0.04, seed: 4400 + i });
          e.tone({ t0: i * 0.17 + 0.02, dur: 0.08, f0: 180, f1: 120, amp: 0.12, atk: 0.005, dec: 0.03, type: 'tri' });
        }
      }
    },
    {
      id: 'bubble', name: '보글보글', cat: 'cute', dur: 0.75, tags: ['물', '거품', '통통'],
      desc: '보글보글 올라오는 거품. 액체·끓는 연출에.',
      use: '물·거품·끓음',
      make: function (e) {
        var times = [0, 0.14, 0.31, 0.5];
        var f = [420, 560, 700, 320];
        for (var i = 0; i < times.length; i++) {
          e.tone({ t0: times[i], dur: 0.09, f0: f[i], f1: f[i] * 2.1, amp: 0.3, atk: 0.003, dec: 0.025 });
        }
        e.rev({ mix: 0.14, rt: 0.5 });
      }
    },
    {
      id: 'ppuing', name: '삐잉 (귀여운)', cat: 'cute', dur: 0.32, tags: ['삐', '귀여움', '리액션'],
      desc: '삐잉- 하고 우는 작은 소리. 억울·귀여운 리액션에.',
      use: '억울·귀여운 리액션',
      make: function (e) {
        e.tone({ dur: 0.28, f0: 820, f1: 620, amp: 0.3, atk: 0.01, dec: 0.12, type: 'tri', vib: 0.04, vibRate: 9 });
        e.rev({ mix: 0.1, rt: 0.4 });
      }
    },
    {
      id: 'cute-lvlup', name: '귀여운 성공', cat: 'cute', dur: 0.7, tags: ['성공', '상승', '게임'],
      desc: '뾰롱- 하고 올라가는 성공음. 게임 클리어·성공 표시.',
      use: '성공·클리어·달성',
      make: function (e) {
        var n = [784, 988, 1175, 1568];
        for (var i = 0; i < n.length; i++) {
          e.tone({ t0: i * 0.09, dur: 0.22, f0: n[i], amp: 0.3, atk: 0.003, dec: 0.06, type: 'tri' });
        }
        e.rev({ mix: 0.16, rt: 0.6 });
      }
    },

    /* ---------- 편집 기본 (유용한 것) ---------- */
    {
      id: 'shutter', name: '찰칵 (카메라)', cat: 'edit', dur: 0.22, tags: ['카메라', '사진', '찰칵'],
      desc: '카메라 셔터 "찰칵". 사진·스냅샷 연출.',
      use: '사진 찍기·캡처·증거',
      make: function (e) {
        e.click(0, 0.55, 3600);
        e.noise({ t0: 0.0, dur: 0.014, amp: 0.4, filter: 'hp', f0: 2400, q: 0.7, atk: 0.0004, dec: 0.004 });
        e.click(0.085, 0.45, 2600);
        e.noise({ t0: 0.085, dur: 0.03, amp: 0.3, filter: 'bp', f0: 1600, q: 1, atk: 0.0006, dec: 0.01 });
      }
    },
    {
      id: 'whoosh', name: '휙 (전환)', cat: 'edit', dur: 0.6, tags: ['전환', '휙', '장면'],
      desc: '휙- 하고 지나가는 바람. 장면 전환의 기본.',
      use: '장면 전환·스와이프·속도감',
      make: function (e) {
        e.noise({ dur: 0.5, amp: 0.5, filter: 'bp', f0: 260, f1: 3800, q: 1.1, atk: 0.09, dec: 0.16, seed: 3311 });
        e.rev({ mix: 0.12, rt: 0.5 });
      }
    },
    {
      id: 'whoosh-back', name: '쓱 (역방향 전환)', cat: 'edit', dur: 0.55, tags: ['전환', '되돌리기', '쓱'],
      desc: '반대 방향으로 쓱- 되돌아가는 바람. 과거 회상·되돌리기.',
      use: '회상·되돌리기·역방향',
      make: function (e) {
        e.noise({ dur: 0.45, amp: 0.45, filter: 'bp', f0: 4200, f1: 240, q: 1.1, atk: 0.05, dec: 0.16, seed: 3312 });
        e.rev({ mix: 0.12, rt: 0.5 });
      }
    },
    {
      id: 'fwip', name: '후쉬 (강한 전환)', cat: 'edit', dur: 0.7, tags: ['임팩트', '전환', '강조'],
      desc: '바람 + 낮은 쿵이 같이 오는 강한 전환.',
      use: '강한 장면 전환·임팩트',
      make: function (e) {
        e.noise({ dur: 0.35, amp: 0.4, filter: 'hp', f0: 7000, f1: 1200, q: 0.7, atk: 0.02, dec: 0.09, seed: 5512 });
        e.kick({ t0: 0.02, dur: 0.35, from: 110, to: 38, amp: 0.55 });
        e.rev({ mix: 0.18, rt: 0.7 });
      }
    },
    {
      id: 'tick', name: '틱 (클릭)', cat: 'edit', dur: 0.08, tags: ['클릭', '타이핑', '작은'],
      desc: '아주 짧은 "틱". 자막·타이핑·포인트마다.',
      use: '자막 한 글자·체크·포인트',
      make: function (e) {
        e.click(0, 0.5, 4200);
        e.tone({ dur: 0.02, f0: 2600, amp: 0.2, atk: 0.0005, dec: 0.006, rel: 0.008 });
      }
    },
    {
      id: 'cut', name: '컷!', cat: 'edit', dur: 0.22, tags: ['컷', '편집', '신호'],
      desc: '편집 "컷!" 신호처럼 딱 끊는 소리.',
      use: '컷·전환·끊기',
      make: function (e) {
        e.click(0, 0.6, 3000);
        e.noise({ t0: 0.004, dur: 0.1, amp: 0.35, filter: 'lp', f0: 500, f1: 180, q: 0.9, atk: 0.001, dec: 0.03 });
      }
    },
    {
      id: 'puk', name: '퍽 (타격)', cat: 'edit', dur: 0.25, tags: ['타격', '때리기', '퍽'],
      desc: '중간 높이의 "퍽". 맞는 장면·손바닥 타격.',
      use: '때리기·부딪힘·한 방',
      make: function (e) {
        e.noise({ dur: 0.09, amp: 0.55, filter: 'bp', f0: 900, f1: 700, q: 1.4, atk: 0.001, dec: 0.025, seed: 8123 });
        e.tone({ dur: 0.14, f0: 170, f1: 70, amp: 0.45, atk: 0.001, dec: 0.045 });
      }
    },
    {
      id: 'kung', name: '쿵 (묵직)', cat: 'edit', dur: 0.45, tags: ['타격', '묵직', '쿵'],
      desc: '묵직하게 떨어지는 "쿵". 착지·추락·무거운 물건.',
      use: '착지·추락·무거움',
      make: function (e) {
        e.kick({ dur: 0.4, from: 130, to: 42, amp: 0.9 });
        e.noise({ t0: 0.01, dur: 0.12, amp: 0.22, filter: 'lp', f0: 700, f1: 200, q: 0.8, atk: 0.002, dec: 0.04 });
        e.rev({ mix: 0.12, rt: 0.5 });
      }
    },
    {
      id: 'boom', name: '웅장한 임팩트', cat: 'edit', dur: 2.1, tags: ['임팩트', '웅장', '영화'],
      desc: '영화 예고편 같은 낮고 웅장한 폭발음. 반전·오프닝.',
      use: '오프닝·반전·최종 강조',
      make: function (e) {
        e.tone({ dur: 1.4, f0: 58, f1: 34, amp: 0.9, atk: 0.004, dec: 0.5, rel: 0.3, type: 'sine' });
        e.tone({ dur: 1.0, f0: 116, f1: 62, amp: 0.3, atk: 0.004, dec: 0.35, rel: 0.25, type: 'sine' });
        e.noise({ dur: 0.9, amp: 0.4, filter: 'lp', f0: 1400, f1: 220, q: 0.7, atk: 0.003, dec: 0.28, seed: 9987 });
        e.rev({ mix: 0.36, rt: 1.8, size: 1.2, damp: 0.45 });
      }
    },
    {
      id: 'beep-censor', name: '삐- (검열)', cat: 'edit', dur: 0.7, tags: ['삐', '검열', '모자이크'],
      desc: '삐- 하고 막는 검열음. 욕설·모자이크·비밀 가리기.',
      use: '검열·모자이크·비밀',
      make: function (e) {
        e.tone({ dur: 0.62, f0: 1000, amp: 0.2, atk: 0.008, dec: 9, rel: 0.02, type: 'sq', lp: 4000 });
        e.tone({ dur: 0.62, f0: 2000, amp: 0.05, atk: 0.008, dec: 9, rel: 0.02, type: 'sine' });
      }
    },
    {
      id: 'wrong', name: '삐빅 (오답)', cat: 'edit', dur: 0.65, tags: ['오답', '실패', '경고'],
      desc: '낮은 두 음으로 삐빅- 실패/오답 표시.',
      use: '오답·실패·틀림',
      make: function (e) {
        e.tone({ dur: 0.24, f0: 190, amp: 0.28, atk: 0.005, dec: 2, rel: 0.03, type: 'sq', lp: 1800 });
        e.tone({ t0: 0.28, dur: 0.3, f0: 143, amp: 0.3, atk: 0.005, dec: 2, rel: 0.03, type: 'sq', lp: 1800 });
      }
    },
    {
      id: 'correct', name: '딩동댕 (정답)', cat: 'edit', dur: 0.9, tags: ['정답', '성공', 'OX'],
      desc: '딩-동-댕 정답 소리. 퀴즈·성공·통과.',
      use: '정답·성공·당첨',
      make: function (e) {
        e.bell({ f: 784, dur: 0.5, amp: 0.34 });
        e.bell({ t0: 0.13, f: 1046, dur: 0.55, amp: 0.32 });
        e.bell({ t0: 0.26, f: 1318, dur: 0.6, amp: 0.3 });
        e.rev({ mix: 0.16, rt: 0.8 });
      }
    },
    {
      id: 'rewind', name: '리와인드', cat: 'edit', dur: 0.65, tags: ['되감기', '과거', '테이프'],
      desc: '테이프를 되감는 듯한 소리. 과거 회상·되돌리기.',
      use: '회상·되감기·시간 역행',
      make: function (e) {
        e.tone({ dur: 0.6, f0: 220, f1: 1100, amp: 0.22, atk: 0.01, dec: 0.5, type: 'saw', lp: 2600, vib: 0.25, vibRate: 28 });
        e.noise({ dur: 0.6, amp: 0.14, filter: 'bp', f0: 900, f1: 3200, q: 1.2, atk: 0.02, dec: 0.3, seed: 6123 });
      }
    },
    {
      id: 'fastfwd', name: '빨리감기', cat: 'edit', dur: 0.55, tags: ['빨리', '속도', '테이프'],
      desc: '사각사각 빨리 감기는 소리. 시간 압축·스킵.',
      use: '빨리감기·시간 압축·스킵',
      make: function (e) {
        e.tone({ dur: 0.5, f0: 330, f1: 1500, amp: 0.2, atk: 0.01, dec: 0.4, type: 'saw', lp: 3000, vib: 0.4, vibRate: 60 });
        e.noise({ dur: 0.5, amp: 0.12, filter: 'hp', f0: 2000, f1: 6000, q: 0.8, atk: 0.02, dec: 0.25, seed: 6124 });
      }
    },
    {
      id: 'countdown', name: '카운트다운', cat: 'edit', dur: 1.25, tags: ['카운트', '3', '시작'],
      desc: '삐- 삐- 삐- 세 번. 시작 전 카운트다운.',
      use: '카운트다운·시작',
      make: function (e) {
        for (var i = 0; i < 3; i++) e.tone({ t0: i * 0.42, dur: 0.12, f0: 880, amp: 0.32, atk: 0.004, dec: 9, rel: 0.02, type: 'sine' });
      }
    },
    {
      id: 'alarm', name: '타이머 종료', cat: 'edit', dur: 1.35, tags: ['알람', '종료', '타이머'],
      desc: '삐삐삐삐- 타이머가 울리는 소리. 시간 종료·경고.',
      use: '시간 종료·마감·경고',
      make: function (e) {
        for (var i = 0; i < 6; i++) {
          e.tone({ t0: i * 0.2, dur: 0.11, f0: i % 2 ? 1568 : 1318, amp: 0.26, atk: 0.004, dec: 9, rel: 0.02, type: 'sq', lp: 5000 });
        }
      }
    },
    {
      id: 'typing', name: '타이핑', cat: 'edit', dur: 0.85, tags: ['타자', '키보드', '검색'],
      desc: '타닥타닥 키보드 소리. 검색·채팅·자막 연출.',
      use: '검색·채팅·작성',
      make: function (e) {
        var times = [0, 0.09, 0.19, 0.31, 0.44, 0.58, 0.7];
        for (var i = 0; i < times.length; i++) {
          e.click(times[i], 0.34 + (i % 3) * 0.05, 2400 + (i % 4) * 500);
          e.noise({ t0: times[i], dur: 0.02, amp: 0.18, filter: 'bp', f0: 1800 + (i % 3) * 400, q: 1.4, atk: 0.0005, dec: 0.006 });
        }
      }
    },
    {
      id: 'zoom', name: '줌인', cat: 'edit', dur: 0.5, tags: ['줌', '확대', '포인트'],
      desc: '슈웅- 하고 확대되는 느낌. 중요한 부분 강조.',
      use: '확대·주목·포인트',
      make: function (e) {
        e.noise({ dur: 0.4, amp: 0.3, filter: 'bp', f0: 400, f1: 2600, q: 2.2, atk: 0.05, dec: 0.14, seed: 7788 });
        e.tone({ dur: 0.3, f0: 200, f1: 420, amp: 0.12, atk: 0.04, dec: 0.12 });
      }
    },
    {
      id: 'glitch', name: '글리치', cat: 'edit', dur: 0.5, tags: ['오류', '글리치', '디지털'],
      desc: '지지직 끊기는 디지털 오류. 시스템 다운·오류 연출.',
      use: '오류·시스템·순간이동',
      make: function (e) {
        var r = rnd(31415);
        for (var i = 0; i < 10; i++) {
          var t = i * 0.045;
          e.tone({ t0: t, dur: 0.038, f0: 200 + Math.abs(r()) * 2200, amp: 0.16, atk: 0.001, dec: 9, rel: 0.004, type: 'sq', lp: 6000 });
          if (i % 2 === 0) e.noise({ t0: t, dur: 0.03, amp: 0.16, filter: 'bp', f0: 3000, q: 1.5, atk: 0.001, dec: 0.008, seed: 100 + i });
        }
      }
    },
    {
      id: 'swipe', name: '스와이프', cat: 'edit', dur: 0.32, tags: ['스와이프', '넘김', '쓱'],
      desc: '짧게 쓱- 넘기는 소리. 화면 전환·다음 항목.',
      use: '넘기기·다음·스와이프',
      make: function (e) {
        e.noise({ dur: 0.26, amp: 0.38, filter: 'bp', f0: 1200, f1: 4200, q: 1.4, atk: 0.03, dec: 0.08, seed: 2244 });
      }
    },
    {
      id: 'riser', name: '긴장 상승', cat: 'edit', dur: 1.8, tags: ['긴장', '상승', '빌드업'],
      desc: '서서히 올라가며 긴장을 만드는 빌드업. 반전 직전.',
      use: '빌드업·반전 준비·긴장',
      make: function (e) {
        e.noise({ dur: 1.6, amp: 0.42, filter: 'bp', f0: 280, f1: 6500, q: 2, atk: 1.4, dec: 0.25, seed: 8899 });
        e.tone({ dur: 1.6, f0: 90, f1: 880, amp: 0.2, atk: 1.3, dec: 0.3, type: 'saw', lp: 2200 });
        e.rev({ mix: 0.2, rt: 1.2 });
      }
    },
    {
      id: 'ding', name: '딩 (알림)', cat: 'edit', dur: 1.1, tags: ['알림', '종', '확인'],
      desc: '깔끔한 "딩". 알림·확인·성공 표시.',
      use: '알림·확인·완료',
      make: function (e) {
        e.bell({ f: 1046.5, dur: 1.0, amp: 0.36, partials: [[1, 1], [2.02, 0.3], [3.01, 0.12]] });
        e.rev({ mix: 0.2, rt: 1.0 });
      }
    },
    {
      id: 'pause', name: '일시정지', cat: 'edit', dur: 0.3, tags: ['정지', '멈춤', '중단'],
      desc: '뚜- 하고 내려가는 두 음. 멈춤·중단 표시.',
      use: '멈춤·중단·취소',
      make: function (e) {
        e.tone({ dur: 0.1, f0: 900, f1: 780, amp: 0.28, atk: 0.003, dec: 0.04, type: 'tri' });
        e.tone({ t0: 0.1, dur: 0.14, f0: 700, f1: 480, amp: 0.28, atk: 0.003, dec: 0.05, type: 'tri' });
      }
    },
    {
      id: 'pop-open', name: '툭 (열림)', cat: 'edit', dur: 0.22, tags: ['열기', '팝', '작은'],
      desc: '작게 툭- 열리는 소리. 팝업·상자 열기.',
      use: '팝업·열기·보관함',
      make: function (e) {
        e.tone({ dur: 0.07, f0: 520, f1: 900, amp: 0.3, atk: 0.002, dec: 0.02, type: 'tri' });
        e.click(0, 0.2, 2800);
        e.tone({ t0: 0.06, dur: 0.1, f0: 900, f1: 1150, amp: 0.14, atk: 0.002, dec: 0.03 });
      }
    },

    /* ---------- 예능·웃긴 ---------- */
    {
      id: 'badumtss', name: '빰빠밤 (드럼)', cat: 'fun', dur: 1.7, tags: ['드럼', '마무리', '예능'],
      desc: '빰- 빠- 밤! 웃긴 마무리 드럼. 아재개그 필수템.',
      use: '웃긴 마무리·아재개그·허무',
      make: function (e) {
        e.snare({ t0: 0.0, amp: 0.5 });
        e.snare({ t0: 0.22, amp: 0.55 });
        e.kick({ t0: 0.44, dur: 0.18, from: 110, to: 50, amp: 0.5 });
        e.snare({ t0: 0.44, amp: 0.5 });
        e.cymbal({ t0: 0.44, amp: 0.4, dur: 1.1 });
        e.rev({ mix: 0.2, rt: 0.9 });
      }
    },
    {
      id: 'trombone', name: '실망 트럼본', cat: 'fun', dur: 2.6, tags: ['실망', '슬픔', '왜왜왜'],
      desc: '와와와- 와아아아앙 내려가는 트럼본. 대표적인 실망 효과음.',
      use: '실망·허무·실패',
      make: function (e) {
        var seq = [[233.08, 0.0, 0.34], [220, 0.34, 0.34], [207.65, 0.68, 0.34], [174.61, 1.02, 1.3]];
        for (var i = 0; i < seq.length; i++) {
          var f = seq[i][0], t = seq[i][1], d = seq[i][2];
          var f1 = i === seq.length - 1 ? f * 0.62 : f * 0.985;
          e.tone({ t0: t, dur: d, f0: f, f1: f1, amp: 0.34, atk: 0.045, dec: d * 0.9, rel: 0.12, type: 'saw', lp: 1400, vib: 0.014, vibRate: 5.2 });
          e.tone({ t0: t, dur: d, f0: f * 2, f1: f1 * 2, amp: 0.09, atk: 0.05, dec: d * 0.8, rel: 0.12, type: 'saw', lp: 2200 });
        }
        e.rev({ mix: 0.22, rt: 1.4, damp: 0.5 });
      }
    },
    {
      id: 'drumroll', name: '드럼롤', cat: 'fun', dur: 1.8, tags: ['드럼', '긴장', '기대'],
      desc: '두구두구 빨라지는 드럼롤. 발표 직전 기대감.',
      use: '발표 전·기대·긴장',
      make: function (e) {
        var t = 0, gap = 0.09;
        for (var i = 0; i < 26; i++) {
          e.snare({ t0: t, amp: 0.16 + i * 0.008 });
          t += gap;
          gap *= 0.93;
          if (gap < 0.028) gap = 0.028;
        }
        e.cymbal({ t0: t, amp: 0.38, dur: 1.0 });
        e.rev({ mix: 0.16, rt: 0.8 });
      }
    },
    {
      id: 'crash', name: '심벌 쾅', cat: 'fun', dur: 1.8, tags: ['심벌', '쾅', '강조'],
      desc: '쨔잔- 하고 터지는 심벌. 뭔가 확실한 마무리.',
      use: '마무리·등장·쾅',
      make: function (e) {
        e.cymbal({ t0: 0, amp: 0.5, dur: 1.5 });
        e.noise({ t0: 0, dur: 0.5, amp: 0.2, filter: 'hp', f0: 3000, q: 0.6, atk: 0.002, dec: 0.15, seed: 4433 });
        e.rev({ mix: 0.3, rt: 1.4 });
      }
    },
    {
      id: 'coin', name: '동전 (코인)', cat: 'game', dur: 0.5, tags: ['동전', '돈', '게임'],
      desc: '쨍- 쨍- 동전 두 개. 돈·구매·보상.',
      use: '돈·구매·보상·득템',
      make: function (e) {
        e.tone({ dur: 0.08, f0: 988, amp: 0.3, atk: 0.002, dec: 0.03, type: 'sq', lp: 5000 });
        e.tone({ t0: 0.07, dur: 0.3, f0: 1319, amp: 0.28, atk: 0.002, dec: 0.1, type: 'sq', lp: 5000 });
        e.rev({ mix: 0.12, rt: 0.5 });
      }
    },
    {
      id: 'levelup', name: '레벨업', cat: 'game', dur: 0.85, tags: ['레벨업', '성장', '게임'],
      desc: '도미솔도- 올라가는 레벨업 사운드.',
      use: '레벨업·성장·달성',
      make: function (e) {
        var n = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < n.length; i++) {
          e.tone({ t0: i * 0.1, dur: 0.18, f0: n[i], amp: 0.26, atk: 0.004, dec: 0.05, type: 'sq', lp: 4200 });
        }
        e.tone({ t0: 0.4, dur: 0.4, f0: 1046.5, amp: 0.14, atk: 0.01, dec: 0.14, type: 'tri' });
        e.rev({ mix: 0.18, rt: 0.7 });
      }
    },
    {
      id: 'applause', name: '박수', cat: 'fun', dur: 2.2, tags: ['박수', '축하', '응원'],
      desc: '짝짝짝 여러 명이 치는 박수. 축하·칭찬.',
      use: '축하·칭찬·응원',
      make: function (e) {
        var r = rnd(5150);
        for (var i = 0; i < 70; i++) {
          var t = Math.abs(r()) * 1.6;
          var a = 0.1 + Math.abs(r()) * 0.16;
          e.clap({ t0: t, amp: a });
        }
        e.noise({ dur: 1.8, amp: 0.05, filter: 'hp', f0: 1200, q: 0.6, atk: 0.2, dec: 0.7, seed: 6161 });
        e.rev({ mix: 0.28, rt: 1.5 });
      }
    },
    {
      id: 'suspense', name: '두구두구', cat: 'fun', dur: 2.4, tags: ['긴장', '두구두구', '발표'],
      desc: '쿵쿵쿵 빨라지다 터지는 긴장 연출. 결과 발표 직전.',
      use: '결과 발표·긴장·반전',
      make: function (e) {
        var t = 0, gap = 0.22;
        for (var i = 0; i < 8; i++) {
          e.kick({ t0: t, dur: 0.12, from: 95, to: 55, amp: 0.5 });
          t += gap;
          gap *= 0.87;
        }
        e.noise({ t0: t + 0.05, dur: 0.5, amp: 0.35, filter: 'bp', f0: 700, f1: 1600, q: 1.2, atk: 0.01, dec: 0.15, seed: 7733 });
        e.tone({ t0: t + 0.05, dur: 0.7, f0: 220, f1: 110, amp: 0.22, atk: 0.005, dec: 0.25, type: 'saw', lp: 1200 });
        e.rev({ mix: 0.24, rt: 1.2 });
      }
    },
    {
      id: 'whistle', name: '삐이잉 (휘파람)', cat: 'fun', dur: 1.25, tags: ['휘파람', '추락', '만화'],
      desc: '위로 올라갔다 뚝 떨어지는 만화 휘파람.',
      use: '미끄러짐·추락·만화적 전개',
      make: function (e) {
        e.tone({ dur: 0.32, f0: 900, f1: 1650, amp: 0.24, atk: 0.02, dec: 0.2, rel: 0.04, vib: 0.02, vibRate: 6 });
        e.tone({ t0: 0.3, dur: 0.9, f0: 1650, f1: 330, amp: 0.26, atk: 0.01, dec: 0.6, rel: 0.1, vib: 0.025, vibRate: 7 });
        e.rev({ mix: 0.18, rt: 0.8 });
      }
    },
    {
      id: 'scratch', name: '띠로리 (스크래치)', cat: 'fun', dur: 0.75, tags: ['DJ', '스크래치', '당황'],
      desc: '레코드 긁는 듯한 위잉위잉. 뭔가 이상할 때.',
      use: '당황·정지·뭐지?',
      make: function (e) {
        e.tone({ dur: 0.7, f0: 380, f1: 380, amp: 0.26, atk: 0.01, dec: 0.4, type: 'saw', lp: 2600, vib: 0.5, vibRate: 9 });
        e.noise({ dur: 0.7, amp: 0.16, filter: 'bp', f0: 1400, q: 1.1, atk: 0.01, dec: 0.3, seed: 9182 });
      }
    },
    {
      id: 'bonk', name: '봉k (머리)', cat: 'fun', dur: 0.32, tags: ['맞음', '머리', '만화'],
      desc: '봉- 하고 머리를 맞는 만화 소리.',
      use: '머리 맞음·실수·혼남',
      make: function (e) {
        e.tone({ dur: 0.13, f0: 520, f1: 140, amp: 0.45, atk: 0.002, dec: 0.045, type: 'tri' });
        e.tone({ t0: 0.002, dur: 0.1, f0: 1040, f1: 280, amp: 0.12, atk: 0.002, dec: 0.03 });
        e.click(0, 0.25, 1800);
      }
    },
    {
      id: 'squeak', name: '삐걱', cat: 'fun', dur: 0.45, tags: ['삐걱', '문', '어색'],
      desc: '삐걱- 삐걱거리는 소리. 어색한 분위기·문 열림.',
      use: '어색·문·분위기 전환',
      make: function (e) {
        e.tone({ dur: 0.4, f0: 700, f1: 520, amp: 0.2, atk: 0.02, dec: 0.2, type: 'saw', lp: 2600, vib: 0.22, vibRate: 26 });
        e.noise({ dur: 0.4, amp: 0.08, filter: 'bp', f0: 2400, q: 2, atk: 0.02, dec: 0.15, seed: 3355 });
      }
    },
    {
      id: 'recordstop', name: '뚝 (정지)', cat: 'fun', dur: 0.75, tags: ['정지', '뚝', '당황'],
      desc: '음악이 뚝- 하고 멈추는 소리. 갑분싸·당황.',
      use: '갑분싸·정지·당황',
      make: function (e) {
        e.tone({ dur: 0.6, f0: 320, f1: 38, amp: 0.4, atk: 0.005, dec: 0.3, rel: 0.1, type: 'saw', lp: 1600 });
        e.noise({ dur: 0.3, amp: 0.12, filter: 'lp', f0: 900, f1: 200, q: 0.8, atk: 0.005, dec: 0.1, seed: 2233 });
        e.rev({ mix: 0.14, rt: 0.6 });
      }
    },
    {
      id: 'yay', name: '야호 (팡파레)', cat: 'fun', dur: 1.3, tags: ['축하', '팡파레', '신남'],
      desc: '빠밤빠밤 짧은 팡파레. 축하·당첨·성공.',
      use: '축하·당첨·성공',
      make: function (e) {
        var seq = [[523.25, 0, 0.12], [659.25, 0.12, 0.12], [783.99, 0.24, 0.12], [1046.5, 0.36, 0.5]];
        for (var i = 0; i < seq.length; i++) {
          e.tone({ t0: seq[i][1], dur: seq[i][2], f0: seq[i][0], amp: 0.26, atk: 0.006, dec: seq[i][2] * 0.6, type: 'sq', lp: 4600 });
          e.tone({ t0: seq[i][1], dur: seq[i][2], f0: seq[i][0] * 0.5, amp: 0.1, atk: 0.006, dec: seq[i][2] * 0.6, type: 'tri' });
        }
        e.cymbal({ t0: 0.36, amp: 0.2, dur: 0.8 });
        e.rev({ mix: 0.2, rt: 0.9 });
      }
    },
    {
      id: 'noir', name: '쉿 (쉿!)', cat: 'fun', dur: 0.6, tags: ['쉿', '조용', '비밀'],
      desc: '쉬이잇- 조용히 하라는 소리. 비밀·몰래.',
      use: '비밀·조용히·몰래',
      make: function (e) {
        e.noise({ dur: 0.55, amp: 0.4, filter: 'bp', f0: 3200, f1: 5200, q: 2.2, atk: 0.08, dec: 0.2, seed: 6655 });
        e.noise({ t0: 0.0, dur: 0.5, amp: 0.12, filter: 'hp', f0: 6000, q: 0.7, atk: 0.1, dec: 0.2, seed: 6656 });
      }
    },
    {
      id: 'magic-fail', name: '뿌직', cat: 'fun', dur: 0.4, tags: ['방귀', '민망', '웃김'],
      desc: '뿌직- 민망한 소리. 웃긴 실패·민망한 순간.',
      use: '민망·실패·웃김',
      make: function (e) {
        e.tone({ dur: 0.28, f0: 160, f1: 90, amp: 0.35, atk: 0.01, dec: 0.08, type: 'saw', lp: 700, vib: 0.35, vibRate: 22 });
        e.noise({ dur: 0.28, amp: 0.2, filter: 'lp', f0: 900, f1: 300, q: 0.9, atk: 0.01, dec: 0.08, seed: 9911 });
      }
    },
    {
      id: 'heart-stop', name: '충격 (억!)', cat: 'fun', dur: 0.9, tags: ['충격', '반전', '놀람'],
      desc: '억! 하고 놀라는 순간의 충격음. 급반전에.',
      use: '놀람·충격·반전',
      make: function (e) {
        e.tone({ dur: 0.25, f0: 660, f1: 220, amp: 0.4, atk: 0.003, dec: 0.09, type: 'saw', lp: 2400 });
        e.noise({ dur: 0.3, amp: 0.3, filter: 'hp', f0: 2500, f1: 600, q: 0.8, atk: 0.003, dec: 0.09, seed: 1177 });
        e.kick({ t0: 0.01, dur: 0.5, from: 140, to: 40, amp: 0.6 });
        e.rev({ mix: 0.24, rt: 1.0 });
      },
      nameKo: '충격 (억!)'
    },

    /* ---------- 통화·디스코드 알림 ---------- */
    {
      id: 'discord-join', name: '디스코드 입장음', cat: 'call', dur: 0.9, tags: ['디스코드', '입장', '두둥'],
      desc: '디코 음성방에 들어갈 때 나는 두둥- 상승 두 음.',
      use: '입장·시작·들어옴',
      make: function (e) {
        e.bell({ f: 698.46, dur: 0.48, amp: 0.4, partials: [[1, 1], [2.0, 0.28], [3.0, 0.1]] });
        e.bell({ t0: 0.17, f: 1046.5, dur: 0.65, amp: 0.36, partials: [[1, 1], [2.0, 0.26], [3.0, 0.1]] });
        e.rev({ mix: 0.2, rt: 0.8 });
      }
    },
    {
      id: 'discord-leave', name: '디스코드 퇴장음', cat: 'call', dur: 0.9, tags: ['디스코드', '퇴장', '나감'],
      desc: '음성방에서 나갈 때의 둥-둥 내려가는 두 음.',
      use: '퇴장·종료·나감',
      make: function (e) {
        e.bell({ f: 1046.5, dur: 0.48, amp: 0.34 });
        e.bell({ t0: 0.16, f: 698.46, dur: 0.65, amp: 0.34 });
        e.rev({ mix: 0.2, rt: 0.8 });
      }
    },
    {
      id: 'discord-ping', name: '디스코드 알림', cat: 'call', dur: 0.55, tags: ['디스코드', '알림', '멘션'],
      desc: '디코에서 누가 부르거나 메시지가 왔을 때의 짧은 알림.',
      use: '멘션·메시지·알림',
      make: function (e) {
        e.tone({ dur: 0.12, f0: 1174.7, amp: 0.34, atk: 0.002, dec: 3, rel: 0.03 });
        e.tone({ t0: 0.1, dur: 0.32, f0: 1568, amp: 0.3, atk: 0.002, dec: 0.09 });
        e.rev({ mix: 0.14, rt: 0.6 });
      }
    },
    {
      id: 'ringback', name: '통화 연결음', cat: 'call', dur: 1.5, tags: ['통화', '전화', '신호'],
      desc: '전화 거는 쪽에서 듣는 뚜- 연결 신호음.',
      use: '전화 걸기·기다림·연결 중',
      make: function (e) {
        e.tone({ dur: 1.0, f0: 450, amp: 0.16, atk: 0.02, dec: 9, rel: 0.04 });
        e.tone({ dur: 1.0, f0: 480, amp: 0.13, atk: 0.02, dec: 9, rel: 0.04 });
      }
    },
    {
      id: 'call-connect', name: '통화 연결됨', cat: 'call', dur: 0.65, tags: ['통화', '연결', '띠링'],
      desc: '전화가 연결되며 울리는 띠링- 두 음.',
      use: '연결 성공·수신',
      make: function (e) {
        e.bell({ f: 880, dur: 0.35, amp: 0.34 });
        e.bell({ t0: 0.09, f: 1318.5, dur: 0.48, amp: 0.3 });
        e.rev({ mix: 0.16, rt: 0.7 });
      }
    },
    {
      id: 'call-end', name: '통화 끊김', cat: 'call', dur: 0.6, tags: ['통화', '끊김', '종료'],
      desc: '뚜- 뚜- 하고 끊기는 전화 종료음.',
      use: '통화 종료·거절·끊김',
      make: function (e) {
        e.tone({ dur: 0.14, f0: 720, f1: 620, amp: 0.3, atk: 0.004, dec: 4, rel: 0.03 });
        e.tone({ t0: 0.18, dur: 0.2, f0: 560, f1: 440, amp: 0.3, atk: 0.004, dec: 3, rel: 0.03 });
      }
    },
    {
      id: 'mute-on', name: '음소거 켜짐', cat: 'call', dur: 0.35, tags: ['음소거', '마이크', '디스코드'],
      desc: '마이크를 끌 때 나는 낮은 뚜뚜 두 음.',
      use: '음소거·마이크 끔',
      make: function (e) {
        e.tone({ dur: 0.1, f0: 620, amp: 0.26, atk: 0.003, dec: 4, rel: 0.02, type: 'tri' });
        e.tone({ t0: 0.11, dur: 0.12, f0: 500, amp: 0.26, atk: 0.003, dec: 4, rel: 0.02, type: 'tri' });
      }
    },
    {
      id: 'mute-off', name: '음소거 해제', cat: 'call', dur: 0.35, tags: ['음소거', '마이크', '디스코드'],
      desc: '마이크를 켤 때 나는 높은 뚜뚜 두 음.',
      use: '음소거 해제·마이크 켬',
      make: function (e) {
        e.tone({ dur: 0.1, f0: 500, amp: 0.26, atk: 0.003, dec: 4, rel: 0.02, type: 'tri' });
        e.tone({ t0: 0.11, dur: 0.12, f0: 640, amp: 0.26, atk: 0.003, dec: 4, rel: 0.02, type: 'tri' });
      }
    },
    {
      id: 'notif-3', name: '알림 3음', cat: 'call', dur: 0.75, tags: ['알림', '벨', '카톡'],
      desc: '도미솔 세 음으로 올라가는 깔끔한 알림.',
      use: '알림·도착·확인',
      make: function (e) {
        var n = [783.99, 987.77, 1174.7];
        for (var i = 0; i < 3; i++) e.bell({ t0: i * 0.1, f: n[i], dur: 0.38, amp: 0.24, partials: [[1, 1], [2.01, 0.3]] });
        e.rev({ mix: 0.16, rt: 0.7 });
      }
    },
    {
      id: 'join-bell', name: '입장 종', cat: 'call', dur: 1.1, tags: ['입장', '종', '방송'],
      desc: '딩- 하고 방에 들어왔음을 알리는 종소리.',
      use: '입장·시청자 알림·방송 시작',
      make: function (e) {
        e.bell({ f: 987.77, dur: 0.95, amp: 0.34, partials: [[1, 1], [2.4, 0.3], [4.1, 0.12]] });
        e.rev({ mix: 0.22, rt: 1.0 });
      }
    },

    /* ---------- 해외 밈 ---------- */
    {
      id: 'vine-boom', name: '베이스 붐 (밈)', cat: 'meme', dur: 2.3, tags: ['밈', '붐', '충격'],
      desc: '해외 밈 단골 초저음 붐. 뭔가 터질 때 한 방.',
      use: '충격·반전·한 방 강조',
      peak: 0.97,
      make: function (e) {
        e.tone({ dur: 0.9, f0: 96, f1: 34, amp: 0.95, atk: 0.004, dec: 0.4, rel: 0.25 });
        e.tone({ dur: 0.8, f0: 192, f1: 68, amp: 0.32, atk: 0.004, dec: 0.35, rel: 0.2 });
        e.tone({ dur: 0.5, f0: 288, f1: 102, amp: 0.12, atk: 0.004, dec: 0.2, rel: 0.15 });
        e.noise({ dur: 0.5, amp: 0.25, filter: 'lp', f0: 400, f1: 90, q: 0.8, atk: 0.004, dec: 0.16, seed: 1201 });
        e.rev({ mix: 0.42, rt: 2.0, size: 1.3, damp: 0.5 });
      }
    },
    {
      id: 'boom-808', name: '808 붐', cat: 'meme', dur: 1.7, tags: ['808', '붐', '힙합'],
      desc: '쿵- 하고 바닥을 울리는 808 베이스 붐.',
      use: '임팩트·비트·강조',
      peak: 0.96,
      make: function (e) {
        e.tone({ dur: 1.2, f0: 66, f1: 30, amp: 0.95, atk: 0.003, dec: 0.5, rel: 0.2 });
        e.tone({ dur: 0.6, f0: 132, f1: 60, amp: 0.3, atk: 0.003, dec: 0.2, rel: 0.15 });
        e.click(0, 0.3, 1400);
        e.rev({ mix: 0.22, rt: 1.0, damp: 0.55 });
      }
    },
    {
      id: 'metal-pipe', name: '쇠파이프 땡', cat: 'meme', dur: 1.8, tags: ['쇠파이프', '금속', '땡'],
      desc: '쨍- 하고 맞는 쇠파이프 소리. 해외 밈 단골.',
      use: '타격·웃긴 맞음·금속',
      make: function (e) {
        var f = 587.33, p = [[1, 1], [2.42, 0.6], [3.87, 0.4], [5.61, 0.24], [7.43, 0.14], [9.2, 0.08]];
        for (var i = 0; i < p.length; i++) {
          e.tone({ dur: 1.5 / (1 + i * 0.35), f0: f * p[i][0], f1: f * p[i][0] * 0.995, amp: 0.3 * p[i][1], atk: 0.0015, dec: 0.5 / (1 + i * 0.4), rel: 0.08, type: i % 2 ? 'sine' : 'sine' });
        }
        e.noise({ dur: 0.05, amp: 0.45, filter: 'hp', f0: 5000, q: 0.7, atk: 0.0005, dec: 0.012, seed: 8890 });
        e.rev({ mix: 0.3, rt: 1.3 });
      }
    },
    {
      id: 'error-win', name: '에러음 (삐빅)', cat: 'meme', dur: 1.0, tags: ['에러', '오류', '윈도우'],
      desc: '삐-빅 삐-빅 시스템 오류음. 컴퓨터 에러 연출.',
      use: '오류·에러·시스템',
      make: function (e) {
        for (var i = 0; i < 3; i++) {
          e.tone({ t0: i * 0.22, dur: 0.13, f0: 880, amp: 0.2, atk: 0.003, dec: 5, rel: 0.02, type: 'sq', lp: 3200 });
          e.tone({ t0: i * 0.22, dur: 0.13, f0: 932.33, amp: 0.16, atk: 0.003, dec: 5, rel: 0.02, type: 'sq', lp: 3200 });
        }
      }
    },
    {
      id: 'airhorn', name: '에어혼 (밈)', cat: 'meme', dur: 1.4, tags: ['에어혼', '밈', '축하'],
      desc: '빠앙- 터지는 에어혼. 해외 밈·하이라이트 강조.',
      use: '하이라이트·축하·강조',
      peak: 0.9,
      make: function (e) {
        e.tone({ dur: 1.15, f0: 466, f1: 476, amp: 0.26, atk: 0.03, dec: 0.9, rel: 0.15, type: 'saw', lp: 3600, vib: 0.012, vibRate: 8 });
        e.tone({ dur: 1.15, f0: 469, f1: 479, amp: 0.2, atk: 0.035, dec: 0.9, rel: 0.15, type: 'saw', lp: 3600, vib: 0.012, vibRate: 8.5 });
        e.tone({ dur: 1.15, f0: 233, f1: 238, amp: 0.16, atk: 0.04, dec: 0.9, rel: 0.15, type: 'saw', lp: 1800 });
        e.noise({ dur: 0.9, amp: 0.1, filter: 'bp', f0: 2200, q: 1.1, atk: 0.05, dec: 0.4, seed: 4477 });
        e.rev({ mix: 0.18, rt: 1.0 });
      }
    },
    {
      id: 'cartoon-slide', name: '카툰 미끄럼', cat: 'meme', dur: 1.3, tags: ['미끄럼', '휘파람', '카툰'],
      desc: '삐이이- 내려가는 만화 미끄럼 소리.',
      use: '미끄러짐·실망·추락',
      make: function (e) {
        e.tone({ dur: 1.1, f0: 1500, f1: 300, amp: 0.26, atk: 0.02, dec: 0.8, rel: 0.12, vib: 0.05, vibRate: 5.5 });
        e.tone({ dur: 1.1, f0: 3000, f1: 600, amp: 0.08, atk: 0.02, dec: 0.7, rel: 0.12, vib: 0.04, vibRate: 5.5 });
        e.rev({ mix: 0.18, rt: 0.9 });
      }
    },
    {
      id: 'cricket', name: '귀뚜라미 (어색)', cat: 'meme', dur: 2.2, tags: ['귀뚜라미', '어색', '정적'],
      desc: '어색한 정적에 깔리는 귀뚜라미 소리.',
      use: '어색·정적·아무 반응 없음',
      make: function (e) {
        var groups = [0, 0.75, 1.5];
        for (var g = 0; g < groups.length; g++) {
          for (var c = 0; c < 3; c++) {
            var t0 = groups[g] + c * 0.075;
            e.tone({ t0: t0, dur: 0.055, f0: 4300, f1: 4150, amp: 0.16, atk: 0.004, dec: 0.02, vib: 0.5, vibRate: 60 });
          }
        }
        e.noise({ dur: 2.0, amp: 0.02, filter: 'hp', f0: 3000, q: 0.6, atk: 0.2, dec: 0.8, seed: 5599 });
        e.rev({ mix: 0.2, rt: 1.2 });
      }
    },
    {
      id: 'plink', name: '플링크', cat: 'meme', dur: 0.35, tags: ['플링크', '작은', '실로폰'],
      desc: '딩- 작은 실로폰 한 음. 밈 카운트·포인트마다.',
      use: '포인트·카운트·작은 강조',
      make: function (e) {
        e.tone({ dur: 0.3, f0: 1318.5, amp: 0.34, atk: 0.002, dec: 0.1, rel: 0.06 });
        e.tone({ dur: 0.2, f0: 2637, amp: 0.12, atk: 0.002, dec: 0.06 });
        e.rev({ mix: 0.16, rt: 0.6 });
      }
    },
    {
      id: 'tada', name: '따란! (팡파레)', cat: 'meme', dur: 1.9, tags: ['따란', '팡파레', '축하'],
      desc: '따-란! 하고 울리는 짧은 팡파레.',
      use: '발표·축하·등장',
      make: function (e) {
        var ch = [261.63, 329.63, 392.0, 523.25];
        for (var i = 0; i < ch.length; i++) {
          e.tone({ dur: 1.2, f0: ch[i], f1: ch[i] * 0.998, amp: 0.16, atk: 0.02, dec: 0.7, rel: 0.2, type: 'saw', lp: 3000, vib: 0.006, vibRate: 5 });
          e.tone({ dur: 1.0, f0: ch[i] * 2, amp: 0.05, atk: 0.02, dec: 0.5, rel: 0.2, type: 'saw', lp: 4000 });
        }
        e.cymbal({ t0: 0, amp: 0.24, dur: 1.2 });
        e.rev({ mix: 0.3, rt: 1.4 });
      }
    },
    {
      id: 'bonk-meme', name: '본크 (밈)', cat: 'meme', dur: 0.5, tags: ['본크', '맞음', '밈'],
      desc: '봉- 하고 묵직하게 머리를 맞는 본크.',
      use: '머리 맞음·실수·웃김',
      make: function (e) {
        e.tone({ dur: 0.16, f0: 420, f1: 80, amp: 0.5, atk: 0.0015, dec: 0.05, type: 'tri' });
        e.tone({ dur: 0.3, f0: 1580, f1: 900, amp: 0.14, atk: 0.002, dec: 0.09, type: 'sine' });
        e.noise({ dur: 0.08, amp: 0.35, filter: 'bp', f0: 700, q: 1.2, atk: 0.001, dec: 0.02, seed: 6656 });
        e.rev({ mix: 0.16, rt: 0.6 });
      }
    },
    {
      id: 'dun-dun-dunnn', name: '두둥- (드라마)', cat: 'meme', dur: 2.2, tags: ['두둥', '드라마', '반전'],
      desc: '둥- 둥- 둥-- 하고 압박하는 세 음.',
      use: '반전·충격·드라마틱',
      make: function (e) {
        e.tone({ t0: 0, dur: 0.4, f0: 110, amp: 0.42, atk: 0.01, dec: 0.25, type: 'saw', lp: 900 });
        e.tone({ t0: 0.45, dur: 0.4, f0: 110, amp: 0.42, atk: 0.01, dec: 0.25, type: 'saw', lp: 900 });
        e.tone({ t0: 0.9, dur: 1.2, f0: 82.41, amp: 0.46, atk: 0.02, dec: 0.9, rel: 0.3, type: 'saw', lp: 800, vib: 0.01, vibRate: 5 });
        e.tone({ t0: 0.9, dur: 1.2, f0: 41.2, amp: 0.2, atk: 0.02, dec: 0.8, rel: 0.3, type: 'sine' });
        e.rev({ mix: 0.32, rt: 1.6, size: 1.2 });
      }
    },

    /* ---------- 게임 ---------- */
    {
      id: 'pickup', name: '아이템 먹기', cat: 'game', dur: 0.35, tags: ['아이템', '먹기', '획득'],
      desc: '빠밥- 하고 올라가는 아이템 획득음.',
      use: '아이템·획득·먹기',
      make: function (e) {
        e.tone({ dur: 0.07, f0: 880, amp: 0.28, atk: 0.002, dec: 0.03, type: 'sq', lp: 5000 });
        e.tone({ t0: 0.07, dur: 0.2, f0: 1318.5, amp: 0.3, atk: 0.002, dec: 0.07, type: 'sq', lp: 5000 });
        e.rev({ mix: 0.1, rt: 0.4 });
      }
    },
    {
      id: 'potion', name: '물약 마시기', cat: 'game', dur: 1.1, tags: ['물약', '회복', '꿀꺽'],
      desc: '꿀꺽꿀꺽 마시고 반짝 회복되는 물약 소리.',
      use: '물약·회복·버프',
      make: function (e) {
        for (var i = 0; i < 3; i++) {
          e.tone({ t0: i * 0.13, dur: 0.12, f0: 230 - i * 22, f1: 130 - i * 15, amp: 0.3, atk: 0.006, dec: 0.05, type: 'tri', lp: 900 });
          e.noise({ t0: i * 0.13, dur: 0.09, amp: 0.12, filter: 'lp', f0: 700, q: 1, atk: 0.005, dec: 0.03, seed: 300 + i });
        }
        var n = [1046.5, 1318.5, 1568];
        for (var j = 0; j < n.length; j++) e.tone({ t0: 0.48 + j * 0.07, dur: 0.28, f0: n[j], amp: 0.18, atk: 0.003, dec: 0.08 });
        e.rev({ mix: 0.2, rt: 0.8 });
      }
    },
    {
      id: 'heal', name: '회복', cat: 'game', dur: 1.1, tags: ['회복', '힐', '따뜻'],
      desc: '따뜻하게 올라가는 회복 사운드.',
      use: '회복·힐·치유',
      make: function (e) {
        var n = [523.25, 659.25, 783.99];
        for (var i = 0; i < n.length; i++) e.tone({ t0: i * 0.1, dur: 0.7, f0: n[i], amp: 0.2, atk: 0.03, dec: 0.3, rel: 0.15, type: 'sine' });
        e.tone({ t0: 0.3, dur: 0.7, f0: 1568, amp: 0.1, atk: 0.05, dec: 0.25, rel: 0.15 });
        e.rev({ mix: 0.28, rt: 1.2 });
      }
    },
    {
      id: 'damage', name: '대미지', cat: 'game', dur: 0.42, tags: ['데미지', '맞음', '아야'],
      desc: '퍽- 하고 긁히는 피격음.',
      use: '피격·데미지·아픔',
      make: function (e) {
        e.noise({ dur: 0.12, amp: 0.42, filter: 'bp', f0: 900, f1: 400, q: 1.1, atk: 0.001, dec: 0.03, seed: 7712 });
        e.tone({ dur: 0.2, f0: 240, f1: 70, amp: 0.4, atk: 0.001, dec: 0.06, type: 'sq', lp: 1600 });
        e.rev({ mix: 0.1, rt: 0.4 });
      }
    },
    {
      id: 'jump', name: '점프', cat: 'game', dur: 0.26, tags: ['점프', '뛰기', '게임'],
      desc: '뽁- 하고 뛰어오르는 점프음.',
      use: '점프·뛰기·이동',
      make: function (e) {
        e.tone({ dur: 0.16, f0: 320, f1: 760, amp: 0.3, atk: 0.002, dec: 0.05, type: 'sq', lp: 4000 });
        e.tone({ dur: 0.1, f0: 640, f1: 1520, amp: 0.08, atk: 0.002, dec: 0.03 });
      }
    },
    {
      id: 'powerup', name: '파워업', cat: 'game', dur: 1.0, tags: ['파워업', '강화', '변신'],
      desc: '도레미파솔라시도- 빠르게 올라가는 강화음.',
      use: '강화·변신·파워업',
      make: function (e) {
        var base = 523.25, r = Math.pow(2, 1 / 12);
        for (var i = 0; i < 12; i++) {
          e.tone({ t0: i * 0.045, dur: 0.09, f0: base * Math.pow(r, i), amp: 0.2, atk: 0.003, dec: 0.03, type: 'sq', lp: 5200 });
        }
        e.tone({ t0: 0.55, dur: 0.45, f0: 1046.5, amp: 0.16, atk: 0.005, dec: 0.18, rel: 0.1, type: 'tri' });
        e.rev({ mix: 0.18, rt: 0.8 });
      }
    },
    {
      id: 'gameover', name: '게임오버', cat: 'game', dur: 1.7, tags: ['게임오버', '실패', '끝'],
      desc: '도미레도- 내려가며 끝나는 게임오버.',
      use: '게임오버·실패·종료',
      make: function (e) {
        var n = [392, 349.23, 311.13, 233.08];
        for (var i = 0; i < n.length; i++) {
          e.tone({ t0: i * 0.22, dur: 0.3, f0: n[i], amp: 0.26, atk: 0.01, dec: 0.14, rel: 0.08, type: 'tri' });
        }
        e.tone({ t0: 0.88, dur: 0.8, f0: 155.56, f1: 116.54, amp: 0.22, atk: 0.02, dec: 0.5, rel: 0.2, type: 'tri' });
        e.rev({ mix: 0.24, rt: 1.2 });
      }
    },
    {
      id: 'stageclear', name: '스테이지 클리어', cat: 'game', dur: 1.9, tags: ['클리어', '승리', '팡파레'],
      desc: '따라라라- 짧은 승리 팡파레.',
      use: '클리어·승리·축하',
      make: function (e) {
        var seq = [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.3]];
        for (var i = 0; i < seq.length; i++) {
          e.tone({ t0: seq[i][1], dur: 0.16, f0: seq[i][0], amp: 0.26, atk: 0.006, dec: 0.06, type: 'sq', lp: 4800 });
        }
        var ch = [523.25, 659.25, 783.99, 1046.5];
        for (var j = 0; j < ch.length; j++) {
          e.tone({ t0: 0.42, dur: 0.9, f0: ch[j], amp: 0.14, atk: 0.01, dec: 0.4, rel: 0.2, type: 'sq', lp: 4200, vib: 0.006, vibRate: 6 });
        }
        e.cymbal({ t0: 0.42, amp: 0.24, dur: 1.0 });
        e.rev({ mix: 0.24, rt: 1.2 });
      }
    },
    {
      id: 'menu-move', name: '메뉴 이동', cat: 'game', dur: 0.09, tags: ['메뉴', '이동', '커서'],
      desc: '톡- 커서가 움직이는 아주 짧은 소리.',
      use: '메뉴·커서·선택 이동',
      make: function (e) {
        e.tone({ dur: 0.035, f0: 1200, amp: 0.24, atk: 0.001, dec: 9, rel: 0.008, type: 'sq', lp: 6000 });
        e.click(0, 0.15, 4000);
      }
    },
    {
      id: 'menu-select', name: '메뉴 선택', cat: 'game', dur: 0.3, tags: ['선택', '확인', '메뉴'],
      desc: '띠딩- 하고 선택을 확정하는 소리.',
      use: '선택·확정·확인',
      make: function (e) {
        e.tone({ dur: 0.08, f0: 660, amp: 0.24, atk: 0.002, dec: 9, rel: 0.02, type: 'sq', lp: 5200 });
        e.tone({ t0: 0.08, dur: 0.16, f0: 990, amp: 0.26, atk: 0.002, dec: 0.05, type: 'sq', lp: 5200 });
      }
    },
    {
      id: 'sword', name: '검 휘두름', cat: 'game', dur: 0.55, tags: ['검', '휘두름', '공격'],
      desc: '챙- 하고 칼을 휘두르는 소리.',
      use: '공격·휘두르기·베기',
      make: function (e) {
        e.noise({ dur: 0.3, amp: 0.4, filter: 'bp', f0: 3200, f1: 900, q: 1.4, atk: 0.02, dec: 0.1, seed: 4412 });
        e.tone({ dur: 0.35, f0: 2600, f1: 1700, amp: 0.1, atk: 0.004, dec: 0.12 });
        e.rev({ mix: 0.18, rt: 0.7 });
      }
    },
    {
      id: 'explosion', name: '폭발 (게임)', cat: 'game', dur: 1.5, tags: ['폭발', '쾅', '게임'],
      desc: '쾅- 하고 터지는 게임 폭발음.',
      use: '폭발·터짐·파괴',
      make: function (e) {
        e.noise({ dur: 1.1, amp: 0.6, filter: 'lp', f0: 1600, f1: 120, q: 0.7, atk: 0.004, dec: 0.35, seed: 9931 });
        e.tone({ dur: 0.7, f0: 110, f1: 32, amp: 0.7, atk: 0.003, dec: 0.25, rel: 0.15 });
        e.rev({ mix: 0.3, rt: 1.4 });
      }
    },
    {
      id: 'combo', name: '콤보', cat: 'game', dur: 0.65, tags: ['콤보', '연속', '점수'],
      desc: '따다다닥- 연속으로 올라가는 콤보음.',
      use: '콤보·연속·점수',
      make: function (e) {
        var n = [880, 1046.5, 1174.7, 1396.9, 1760];
        for (var i = 0; i < n.length; i++) {
          e.tone({ t0: i * 0.075, dur: 0.1, f0: n[i], amp: 0.22, atk: 0.002, dec: 0.035, type: 'sq', lp: 5600 });
        }
        e.rev({ mix: 0.14, rt: 0.6 });
      }
    }
  ];

  var CATS = [
    { id: 'cute', name: '귀여운 효과음', emoji: '🐰', short: '귀여운', color: '#7ee0b8' },
    { id: 'edit', name: '편집 기본 (유용한 거)', emoji: '🛠', short: '편집 기본', color: '#4fc3f7' },
    { id: 'fun', name: '예능·웃긴 거', emoji: '🤣', short: '예능', color: '#ffd166' },
    { id: 'game', name: '게임 (먹기·물약·레벨업)', emoji: '🎮', short: '게임', color: '#c084fc' },
    { id: 'meme', name: '해외 밈 (붐·본크·쇠파이프)', emoji: '🌍', short: '해외 밈', color: '#fb7185' },
    { id: 'call', name: '통화·디스코드 알림', emoji: '💬', short: '통화·디코', color: '#38bdf8' }
  ];

  var USER_CATS = [
    { id: 'clip', name: '유행·스트리머 대사', emoji: '🔥', short: '유행·대사', color: '#ff6b6b' },
    { id: 'cute', name: '귀여운', emoji: '🐰', short: '귀여운', color: '#7ee0b8' },
    { id: 'edit', name: '유용한 (편집 기본)', emoji: '🛠', short: '유용한', color: '#4fc3f7' },
    { id: 'fun', name: '예능·웃긴', emoji: '🤣', short: '예능', color: '#ffd166' },
    { id: 'game', name: '게임', emoji: '🎮', short: '게임', color: '#c084fc' },
    { id: 'call', name: '통화·디스코드', emoji: '💬', short: '통화·디코', color: '#38bdf8' },
    { id: 'bgm', name: '브금(BGM)', emoji: '🎵', short: '브금', color: '#a78bfa' },
    { id: 'etc', name: '기타', emoji: '📁', short: '기타', color: '#98a2b3' }
  ];

  var byId = {};
  for (var i = 0; i < DEFS.length; i++) byId[DEFS[i].id] = DEFS[i];

  function render(id, sr) {
    var d = byId[id];
    if (!d) return null;
    var e = new Engine(d.dur, sr || SR);
    d.make(e);
    return e.finish(d.peak || 0.92);
  }

  /* ---------------- WAV (16bit mono PCM) ---------------- */
  function toWav(buf, sr) {
    sr = sr || SR;
    var n = buf.length;
    var ab = new ArrayBuffer(44 + n * 2);
    var v = new DataView(ab);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    var o = 44;
    for (var i = 0; i < n; i++) {
      var s = clamp(buf[i], -1, 1);
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
    return ab;
  }

  function wavBlob(id, sr) {
    var buf = render(id, sr);
    if (!buf) return null;
    return new Blob([toWav(buf, sr || SR)], { type: 'audio/wav' });
  }

  function sizeOf(id) {
    var d = byId[id];
    return d ? Math.ceil((d.dur + 0.08) * SR) * 2 + 44 : 0;
  }

  function catOf(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return null;
  }

  return {
    SR: SR, CATS: CATS, USER_CATS: USER_CATS, list: DEFS, get: function (id) { return byId[id] || null; },
    render: render, toWav: toWav, wavBlob: wavBlob, sizeOf: sizeOf, catOf: catOf,
    count: DEFS.length
  };
});
