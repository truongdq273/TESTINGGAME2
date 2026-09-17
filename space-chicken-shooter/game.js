/**
 * Space Chicken Shooter - Gameplay logic inside iframe
 * Compliant with ClassroomGameSDK 1.0.0 and startup-reliability.md
 */

(function () {
  'use strict';

  // State
  let questions = [];
  let currentIndex = 0;
  let currentScore = 0;
  let isPlaying = false;
  let isAnsweringLocked = false;
  let questionStartTime = 0;
  let autoNextTimerInterval = null;
  let isMuted = localStorage.getItem('space_chicken_muted') === 'true';

  // Audio Context (Synthesizer via Web Audio API)
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSound(type) {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'laser') {
        // High-pitch pew-pew sweep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.18);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'explosion') {
        // Low boom + noise
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'correct') {
        // Happy major arpeggio (C5 -> E5 -> G5)
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.08);
          gain.gain.setValueAtTime(0.25, now + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.08);
          osc.stop(now + i * 0.08 + 0.2);
        });
      } else if (type === 'wrong') {
        // Descending boing
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // Starfield Canvas Background Animation
  function initStarfield() {
    const canvas = document.getElementById('star-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.8,
      speed: Math.random() * 0.6 + 0.2,
      opacity: Math.random() * 0.8 + 0.2
    }));

    function draw() {
      ctx.clearRect(0, 0, width, height);

      // Deep space nebula subtle glow
      const grad = ctx.createRadialGradient(width * 0.7, height * 0.3, 20, width * 0.7, height * 0.3, 350);
      grad.addColorStop(0, 'rgba(80, 40, 140, 0.25)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Stars
      ctx.fillStyle = '#ffffff';
      stars.forEach(s => {
        ctx.globalAlpha = s.opacity;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();

        s.y += s.speed;
        if (s.y > height) {
          s.y = 0;
          s.x = Math.random() * width;
        }
      });
      ctx.globalAlpha = 1.0;

      requestAnimationFrame(draw);
    }
    draw();
  }

  // DOM Elements
  const questionCounterEl = document.getElementById('question-counter');
  const hudScoreEl = document.getElementById('hud-score');
  const questionPromptEl = document.getElementById('question-prompt');
  const chickensGridEl = document.getElementById('chickens-grid');
  const playerSpaceshipEl = document.getElementById('player-spaceship');
  const toggleAudioBtn = document.getElementById('toggle-audio-btn');
  const feedbackOverlay = document.getElementById('feedback-overlay');
  const feedbackBox = document.getElementById('feedback-box');
  const feedbackTitle = document.getElementById('feedback-title');
  const feedbackExplanation = document.getElementById('feedback-explanation');
  const nextQBtn = document.getElementById('next-q-btn');
  const autoNextTimerSpan = document.getElementById('auto-next-timer');
  const missionCompleteCard = document.getElementById('mission-complete-card');
  const finalMissionScoreEl = document.getElementById('final-mission-score');

  // Update Audio Mute Button
  function updateAudioButton() {
    if (toggleAudioBtn) {
      toggleAudioBtn.textContent = isMuted ? '🔇' : '🔊';
    }
  }

  if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      localStorage.setItem('space_chicken_muted', String(isMuted));
      updateAudioButton();
    });
  }
  updateAudioButton();

  // Fire Laser Beam Animation
  function fireLaserBeam(targetElem, onHitCallback) {
    playSound('laser');
    const shipRect = playerSpaceshipEl.getBoundingClientRect();
    const targetRect = targetElem.getBoundingClientRect();

    const startX = shipRect.left + shipRect.width / 2;
    const startY = shipRect.top;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;

    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;

    // Slight ship rotation
    playerSpaceshipEl.style.transform = `rotate(${(angle - Math.PI / 2) * 15}deg)`;

    const laser = document.createElement('div');
    laser.className = 'laser-bolt';
    laser.style.left = startX + 'px';
    laser.style.top = startY + 'px';
    laser.style.transform = `rotate(${angle - Math.PI / 2}rad)`;
    document.body.appendChild(laser);

    // Fast CSS transition for laser travel
    const anim = laser.animate([
      { transform: `translate(0, 0) rotate(${angle - Math.PI / 2}rad)` },
      { transform: `translate(${dx}px, ${dy}px) rotate(${angle - Math.PI / 2}rad)` }
    ], {
      duration: 180,
      easing: 'ease-in'
    });

    anim.onfinish = () => {
      laser.remove();
      playerSpaceshipEl.style.transform = 'rotate(0deg)';
      if (typeof onHitCallback === 'function') onHitCallback();
    };
  }

  // Render Question and 4 Chickens
  function renderQuestion(index) {
    if (!questions || index >= questions.length) {
      showMissionComplete();
      return;
    }

    currentIndex = index;
    isAnsweringLocked = false;
    questionStartTime = Date.now();

    const q = questions[index];
    questionCounterEl.textContent = `CÂU ${index + 1} / ${questions.length}`;
    questionPromptEl.textContent = q.prompt;

    chickensGridEl.innerHTML = '';

    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, idx) => {
      const letter = letters[idx] || String.fromCharCode(65 + idx);

      const pod = document.createElement('div');
      pod.className = 'chicken-pod';
      pod.tabIndex = 0;
      pod.dataset.optionId = opt.id;

      function escapeHTML(s) {
        if (!s) return '';
        return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
      }

      pod.innerHTML = `
        <div class="option-key-badge">${letter}</div>
        <div class="chicken-avatar-wrapper">
          <img src="./assets/chicken.png" alt="Space Chicken" class="chicken-img">
          <img src="./assets/puff.gif" alt="Puff Explosion" class="puff-img">
          <img src="./assets/drumstick.png" alt="Drumstick Reward" class="drumstick-img">
        </div>
        <div class="option-text">${escapeHTML(opt.text)}</div>
      `;

      // Click or keyboard trigger
      function triggerChoice() {
        if (isAnsweringLocked || !isPlaying) return;
        isAnsweringLocked = true;

        // Disable all pods immediately to prevent double-submit
        document.querySelectorAll('.chicken-pod').forEach(p => p.classList.add('disabled'));
        pod.classList.add('selected');

        const timeMs = Date.now() - questionStartTime;

        fireLaserBeam(pod, () => {
          // Send answer attempt to parent host
          window.parent.postMessage({
            type: 'classroom-control',
            action: 'submitAttempt',
            payload: {
              questionId: q.id,
              answer: opt.id,
              timeMs
            }
          }, window.location.origin);
        });
      }

      pod.addEventListener('click', triggerChoice);
      pod.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerChoice();
        }
      });

      chickensGridEl.appendChild(pod);
    });
  }

  // Handle incoming Answer Result from Host / Authority
  function handleAnswerResult(res) {
    const chosenPod = document.querySelector(`.chicken-pod[data-option-id="${res.answer}"]`);
    const isCorrect = res.isCorrect;

    if (chosenPod) {
      const puff = chosenPod.querySelector('.puff-img');
      const drumstick = chosenPod.querySelector('.drumstick-img');
      const chickenImg = chosenPod.querySelector('.chicken-img');

      if (isCorrect) {
        chosenPod.classList.add('hit-correct');
        if (puff) puff.style.display = 'block';
        if (chickenImg) chickenImg.style.display = 'none';
        if (drumstick) drumstick.style.display = 'block';
        playSound('explosion');
        setTimeout(() => playSound('correct'), 150);

        currentScore = res.totalScore !== undefined ? res.totalScore : currentScore + 10;
        hudScoreEl.textContent = `${currentScore} ĐIỂM`;
      } else {
        chosenPod.classList.add('hit-wrong');
        playSound('wrong');
      }
    }

    // Show Educational Feedback Banner
    setTimeout(() => {
      showFeedbackBanner(res);
    }, 700);
  }

  function showFeedbackBanner(res) {
    feedbackBox.className = 'feedback-box ' + (res.isCorrect ? 'correct' : 'wrong');
    feedbackTitle.className = 'feedback-title ' + (res.isCorrect ? 'correct' : 'wrong');
    feedbackTitle.innerHTML = res.isCorrect
      ? '🎉 CHÍNH XÁC! (+10 ĐIỂM)'
      : `💫 CHƯA ĐÚNG RỒI! (Đáp án: ${String(res.correctOptionId).toUpperCase()})`;

    feedbackExplanation.textContent = res.explanation || 'Tiếp tục rèn luyện vũ trụ nhé!';
    feedbackOverlay.style.display = 'flex';

    // Auto-advance 4 seconds countdown
    let secondsLeft = 4;
    autoNextTimerSpan.textContent = String(secondsLeft);
    if (autoNextTimerInterval) clearInterval(autoNextTimerInterval);

    autoNextTimerInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(autoNextTimerInterval);
        closeFeedbackAndAdvance();
      } else {
        autoNextTimerSpan.textContent = String(secondsLeft);
      }
    }, 1000);
  }

  function closeFeedbackAndAdvance() {
    if (autoNextTimerInterval) {
      clearInterval(autoNextTimerInterval);
      autoNextTimerInterval = null;
    }
    feedbackOverlay.style.display = 'none';
    renderQuestion(currentIndex + 1);
  }

  if (nextQBtn) {
    nextQBtn.addEventListener('click', closeFeedbackAndAdvance);
  }

  // Mission Complete
  function showMissionComplete() {
    isPlaying = false;
    document.getElementById('question-card').style.display = 'none';
    chickensGridEl.style.display = 'none';
    document.querySelector('.bottom-hangar').style.display = 'none';
    finalMissionScoreEl.textContent = `Tổng điểm của bạn: ${currentScore} ĐIỂM`;
    missionCompleteCard.style.display = 'block';
  }

  // Keyboard shortcut for 1, 2, 3, 4 or A, B, C, D
  window.addEventListener('keydown', (e) => {
    if (isAnsweringLocked || !isPlaying) return;
    const keyMap = { '1': 0, 'a': 0, 'A': 0, '2': 1, 'b': 1, 'B': 1, '3': 2, 'c': 2, 'C': 2, '4': 3, 'd': 3, 'D': 3 };
    if (e.key in keyMap) {
      const idx = keyMap[e.key];
      const pods = document.querySelectorAll('.chicken-pod');
      if (pods[idx]) pods[idx].click();
    }
  });

  // ================= SDK & HOST HANDSHAKE ================= //
  let sdk = null;
  try {
    sdk = ClassroomGameSDK.create({ parentOrigin: window.location.origin });
    sdk.onMessage((msg) => {
      if (msg.type === 'loadContent') {
        if (msg.payload && Array.isArray(msg.payload.questions)) {
          questions = msg.payload.questions;
          console.log(`[Game] Loaded ${questions.length} learner-safe questions`);
          // ACK content acceptance via control channel
          window.parent.postMessage({
            type: 'classroom-control',
            action: 'contentAccepted',
            payload: { count: questions.length }
          }, window.location.origin);
        }
      } else if (msg.type === 'startGame') {
        isPlaying = true;
        currentScore = 0;
        hudScoreEl.textContent = '0 ĐIỂM';
        renderQuestion(0);
      } else if (msg.type === 'endGame') {
        showMissionComplete();
      }
    });
  } catch (err) {
    console.error('[Game] SDK Init error:', err);
  }

  // Window listener for control messages from parent (e.g. answerResult, mute)
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const data = e.data;
    if (!data || data.type !== 'classroom-control') return;

    if (data.action === 'answerResult' && data.payload) {
      handleAnswerResult(data.payload);
    } else if (data.action === 'setMute') {
      isMuted = !!data.payload.muted;
      localStorage.setItem('space_chicken_muted', String(isMuted));
      updateAudioButton();
    }
  });

  // Signal gameReady to parent
  initStarfield();
  if (sdk) {
    sdk.send({
      type: 'gameReady',
      payload: {
        gameId: 'space-chicken-shooter',
        version: '1.0.0'
      }
    });
  }
})();
