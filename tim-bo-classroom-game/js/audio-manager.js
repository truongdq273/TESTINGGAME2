/**
 * Audio Manager for "Tìm Bò - Let's Save the Cows!"
 * Combines PPTX extracted sounds (cow moo, explosion, ufo, boing, correct, incorrect)
 * with gentle background music (BGM), audio ducking, Web Audio synthesizer fallbacks,
 * and persistent Mute state across tabs.
 */
(function (global) {
  'use strict';

  const MUTE_KEY = 'TIM_BO_MUTED';
  const BGM_VOLUME = 0.14; // Âm lượng nền nhỏ nhẹ, êm tai cho lớp học tiểu học

  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === 'true';
  } catch {}

  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Preloaded audio elements
  const audioMap = {
    cow: new Audio('assets/audio/media7.m4a'),
    correct: new Audio('assets/audio/media8.m4a'),
    wrong: new Audio('assets/audio/media2.m4a'),
    explode: new Audio('assets/audio/media4.m4a'),
    boing: new Audio('assets/audio/media5.m4a'),
    ufo: new Audio('assets/audio/media1.m4a'),
    click: new Audio('assets/audio/media3.m4a'),
    yes: new Audio('assets/audio/media8.m4a')
  };

  // Set SFX volumes
  Object.values(audioMap).forEach(a => {
    a.volume = 0.65;
    a.preload = 'auto';
  });

  // -------------------------------------------------------------
  // BACKGROUND MUSIC (BGM) SYSTEM
  // -------------------------------------------------------------
  let bgmAudio = null;
  let bgmStarted = false;
  let bgmSynthActive = false;
  let synthTimer = null;

  function initBgmAudio() {
    if (bgmAudio) return bgmAudio;
    try {
      bgmAudio = new Audio('assets/audio/bgm.wav');
      bgmAudio.loop = true;
      bgmAudio.volume = muted ? 0 : BGM_VOLUME;
      bgmAudio.preload = 'auto';
    } catch {
      bgmAudio = null;
    }
    return bgmAudio;
  }

  function startBgm() {
    bgmStarted = true;
    if (muted) return;

    const bgm = initBgmAudio();
    if (bgm) {
      bgm.volume = BGM_VOLUME;
      const playPromise = bgm.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Trình duyệt chặn autoplay âm thanh file, bật bộ phát Web Audio dịu êm
          startSynthBgmFallback();
        });
      }
    } else {
      startSynthBgmFallback();
    }
  }

  function stopBgm() {
    bgmStarted = false;
    if (bgmAudio) {
      try {
        bgmAudio.pause();
      } catch {}
    }
    stopSynthBgmFallback();
  }

  // Khi có âm thanh hiệu ứng lớn (bò kêu, nổ, bắt alien), nhẹ nhàng giảm BGM
  function duckBgm(durationMs = 1200) {
    if (muted || !bgmAudio) return;
    try {
      bgmAudio.volume = BGM_VOLUME * 0.35;
      setTimeout(() => {
        if (!muted && bgmAudio && bgmStarted) {
          bgmAudio.volume = BGM_VOLUME;
        }
      }, durationMs);
    } catch {}
  }

  // Fallback: Bộ phát nhạc nền không gian du dương bằng Web Audio API
  function startSynthBgmFallback() {
    if (bgmSynthActive || muted) return;
    bgmSynthActive = true;
    const ctx = getAudioContext();
    if (!ctx) return;

    const chords = [
      [261.63, 329.63, 392.00, 493.88], // Cmaj7
      [174.61, 220.00, 261.63, 329.63], // Fmaj7
      [220.00, 261.63, 329.63, 392.00], // Am7
      [196.00, 246.94, 293.66, 392.00]  // G6
    ];
    let step = 0;

    function playChord() {
      if (!bgmSynthActive || muted) return;
      try {
        const now = ctx.currentTime;
        const currentChord = chords[step % chords.length];
        step++;

        currentChord.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(650, now);

          const vol = 0.022 / currentChord.length;
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(vol, now + 0.5);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.08);
          osc.stop(now + 3.9);
        });
      } catch {}
    }

    playChord();
    synthTimer = setInterval(playChord, 3800);
  }

  function stopSynthBgmFallback() {
    bgmSynthActive = false;
    if (synthTimer) {
      clearInterval(synthTimer);
      synthTimer = null;
    }
  }

  // -------------------------------------------------------------
  // SOUND EFFECTS (SFX)
  // -------------------------------------------------------------
  function playSound(name) {
    if (muted) return;
    duckBgm();

    const sound = audioMap[name];
    if (sound) {
      try {
        sound.currentTime = 0;
        const p = sound.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => playSynthFallback(name));
        }
      } catch {
        playSynthFallback(name);
      }
    } else {
      playSynthFallback(name);
    }
  }

  function playSynthFallback(name) {
    if (muted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (name === 'correct' || name === 'yes') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (name === 'wrong' || name === 'nope') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(140, now + 0.25);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (name === 'explode') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (name === 'cow') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.2);
        osc.frequency.exponentialRampToValueAtTime(260, now + 0.4);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else {
        // Simple click
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch {}
  }

  function toggleMute() {
    muted = !muted;
    try {
      localStorage.setItem(MUTE_KEY, String(muted));
    } catch {}

    if (muted) {
      if (bgmAudio) {
        bgmAudio.volume = 0;
        try { bgmAudio.pause(); } catch {}
      }
      stopSynthBgmFallback();
    } else {
      if (bgmAudio) {
        bgmAudio.volume = BGM_VOLUME;
        if (bgmStarted) {
          try { bgmAudio.play(); } catch {}
        }
      }
      if (bgmStarted && !bgmAudio) {
        startSynthBgmFallback();
      }
    }
    return muted;
  }

  function isMuted() {
    return muted;
  }

  // Tự động mở AudioContext và kích hoạt BGM nhẹ nhàng khi người dùng tương tác lần đầu
  function handleUserGesture() {
    getAudioContext();
    if (!bgmStarted) {
      startBgm();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleUserGesture, { once: true });
    window.addEventListener('keydown', handleUserGesture, { once: true });
  }

  global.AudioManager = Object.freeze({
    play: playSound,
    startBgm,
    stopBgm,
    duckBgm,
    toggleMute,
    isMuted,
    initUserGesture: handleUserGesture
  });
})(typeof window !== 'undefined' ? window : this);
