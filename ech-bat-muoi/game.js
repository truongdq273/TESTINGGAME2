/**
 * Ếch Bắt Muỗi - Game Engine
 * Interacts with parent window via ClassroomGameSDK and handles animated frog mechanics.
 */
(function () {
  'use strict';

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let sdk = null;
  let questions = [];
  let currentIndex = 0;
  let currentScore = 0;
  let isAnswerLocked = false;
  let isMuted = localStorage.getItem('frog_game_muted') === 'true';
  let questionStartTime = Date.now();

  // Audio elements
  const audioCroak = new Audio('assets/sfx-croak.mp3');
  const audioBoing = new Audio('assets/sfx-boing.mp3');
  const audioHit = new Audio('assets/sfx-hit.mp3');
  const audioCheer = new Audio('assets/sfx-cheer.mp3');

  function playSound(sound) {
    if (isMuted || !sound) return;
    try {
      sound.currentTime = 0;
      sound.play().catch(() => {});
    } catch (e) {}
  }

  // DOM elements
  const hudQuestionIndex = document.getElementById('hud-question-index');
  const hudScore = document.getElementById('hud-score');
  const btnAudioToggle = document.getElementById('btn-audio-toggle');
  const questionPrompt = document.getElementById('question-prompt');
  const questionBadge = document.getElementById('question-badge');
  const optionsContainer = document.getElementById('options-container');
  const frogBox = document.getElementById('frog-box');
  const frogTongue = document.getElementById('frog-tongue');
  const mosquito = document.getElementById('mosquito');
  const frogEyesNormal = document.getElementById('frog-eyes-normal');
  const frogEyesCrying = document.getElementById('frog-eyes-crying');
  const frogMouthNormal = document.getElementById('frog-mouth-normal');
  const frogMouthOpen = document.getElementById('frog-mouth-open');
  const frogMouthSad = document.getElementById('frog-mouth-sad');
  const feedbackOverlay = document.getElementById('feedback-overlay');
  const feedbackTitle = document.getElementById('feedback-title');
  const feedbackSub = document.getElementById('feedback-sub');

  // Audio Toggle UI
  function updateAudioButton() {
    btnAudioToggle.textContent = isMuted ? '🔇' : '🔊';
  }
  btnAudioToggle.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('frog_game_muted', String(isMuted));
    updateAudioButton();
  });
  updateAudioButton();

  // Initialize SDK
  try {
    sdk = window.ClassroomGameSDK.create({ parentOrigin: window.location.origin });
  } catch (e) {
    console.warn('SDK running standalone or parent origin mismatch:', e);
  }

  // Listen to Host Messages
  if (sdk) {
    sdk.onMessage(msg => {
      if (msg.type === 'loadContent') {
        if (msg.payload && Array.isArray(msg.payload.questions)) {
          questions = msg.payload.questions;
          console.log('[Game] Loaded', questions.length, 'questions via SDK');
        }
      } else if (msg.type === 'startGame') {
        currentIndex = 0;
        currentScore = 0;
        renderCurrentQuestion();
      } else if (msg.type === 'endGame') {
        // Round end handled by parent
      }
    });

    // Send gameReady
    sdk.send({
      type: 'gameReady',
      payload: { gameId: 'ech-bat-muoi', version: '1.0.0' }
    });
  }

  // Also listen for custom authority result from student host adapter
  window.addEventListener('message', e => {
    if (e.origin !== window.location.origin) return;
    const data = e.data;
    if (data && data.type === 'authorityAnswerResult') {
      handleAuthorityResult(data.payload);
    }
  });

  function renderCurrentQuestion() {
    if (!questions || questions.length === 0) return;
    if (currentIndex >= questions.length) {
      showAllCompleted();
      return;
    }

    const q = questions[currentIndex];
    isAnswerLocked = false;
    questionStartTime = Date.now();

    // Reset animations
    resetFrogAppearance();
    mosquito.style.opacity = '1';
    mosquito.style.transform = 'none';
    mosquito.style.animation = 'buzzAround 3s ease-in-out infinite alternate';

    // Update HUD & Text
    hudQuestionIndex.textContent = `Câu ${currentIndex + 1}/${questions.length}`;
    hudScore.textContent = `${currentScore} điểm`;
    questionBadge.textContent = `Câu hỏi ${currentIndex + 1}`;
    questionPrompt.textContent = q.prompt;

    // Render 4 options
    optionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.id = opt.id;
      btn.innerHTML = `
        <span class="option-badge">${letters[idx] || (idx + 1)}</span>
        <span class="option-text">${escapeHTML(opt.text)}</span>
      `;
      btn.addEventListener('click', () => onOptionSelected(opt.id, btn));
      optionsContainer.appendChild(btn);
    });

    playSound(audioCroak);
  }

  function resetFrogAppearance() {
    frogEyesNormal.style.display = 'block';
    frogEyesCrying.style.display = 'none';
    frogMouthNormal.style.display = 'block';
    frogMouthOpen.style.display = 'none';
    frogMouthSad.style.display = 'none';
    frogBox.classList.remove('crying');
    frogTongue.style.opacity = '0';
    frogTongue.style.width = '0px';
    feedbackOverlay.classList.remove('active');
  }

  function onOptionSelected(optionId, selectedBtn) {
    if (isAnswerLocked) return;
    isAnswerLocked = true;

    // Lock all buttons immediately
    const allBtns = optionsContainer.querySelectorAll('.option-btn');
    allBtns.forEach(b => b.disabled = true);
    selectedBtn.classList.add('selected');

    const elapsedMs = Math.max(0, Date.now() - questionStartTime);
    const q = questions[currentIndex];

    // Post to parent student authority
    window.parent.postMessage({
      type: 'studentSubmitAttempt',
      payload: {
        questionId: q.id,
        optionId: optionId,
        timeMs: elapsedMs
      }
    }, window.location.origin);
  }

  function handleAuthorityResult(result) {
    const { isCorrect, correctOptionId, explanation, score, delta } = result;
    currentScore = score;
    hudScore.textContent = `${currentScore} điểm`;

    // Highlight correct & incorrect buttons
    const allBtns = optionsContainer.querySelectorAll('.option-btn');
    allBtns.forEach(btn => {
      if (btn.dataset.id.toLowerCase() === correctOptionId.toLowerCase()) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected') && !isCorrect) {
        btn.classList.add('incorrect');
      }
    });

    if (isCorrect) {
      animateFrogCatchMosquito(explanation);
    } else {
      animateMosquitoStingFrog(explanation);
    }
  }

  function animateFrogCatchMosquito(explanation) {
    // Open frog mouth
    frogMouthNormal.style.display = 'none';
    frogMouthOpen.style.display = 'block';

    // Calculate vector from frog mouth to mosquito
    const frogRect = frogBox.getBoundingClientRect();
    const mosqRect = mosquito.getBoundingClientRect();

    const dx = (mosqRect.left + mosqRect.width / 2) - (frogRect.left + frogRect.width / 2);
    const dy = (mosqRect.top + mosqRect.height / 2) - (frogRect.top + frogRect.height / 2);
    const distance = Math.hypot(dx, dy);
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * (180 / Math.PI);

    // Stretch tongue out
    frogTongue.style.transform = `rotate(${angleDeg}deg)`;
    frogTongue.style.opacity = '1';
    frogTongue.style.width = `${distance}px`;

    playSound(audioBoing);

    setTimeout(() => {
      // Hit mosquito!
      playSound(audioHit);
      mosquito.style.animation = 'none';
      mosquito.style.transform = 'scale(0.2)';
      mosquito.style.opacity = '0';

      // Retract tongue with mosquito
      frogTongue.style.width = '0px';

      setTimeout(() => {
        // Frog swallows, smiles happily
        resetFrogAppearance();
        playSound(audioCheer);

        feedbackTitle.textContent = 'BẮT ĐƯỢC MUỖI! +10 ĐIỂM 🎉';
        feedbackTitle.className = 'feedback-title correct';
        feedbackSub.textContent = explanation || 'Trả lời rất chính xác!';
        feedbackOverlay.classList.add('active');

        // Notify SDK
        if (sdk) {
          sdk.send({
            type: 'submitAnswer',
            payload: {
              playerId: 'local',
              questionId: questions[currentIndex].id,
              answer: 'correct',
              isCorrect: true,
              timeMs: Date.now() - questionStartTime
            }
          });
        }

        setTimeout(() => {
          currentIndex++;
          renderCurrentQuestion();
        }, 1800);
      }, 250);
    }, 220);
  }

  function animateMosquitoStingFrog(explanation) {
    // Mosquito swoops down and bites frog!
    mosquito.style.animation = 'none';
    mosquito.style.transform = 'translate(-40px, 90px) rotate(35deg) scale(1.15)';

    setTimeout(() => {
      // Frog flinches and cries
      frogEyesNormal.style.display = 'none';
      frogEyesCrying.style.display = 'block';
      frogMouthNormal.style.display = 'none';
      frogMouthSad.style.display = 'block';
      frogBox.classList.add('crying');

      feedbackTitle.textContent = 'MUỖI ĐỐT CON ẾCH RỒI! 😢';
      feedbackTitle.className = 'feedback-title incorrect';
      feedbackSub.textContent = explanation || 'Đáp án chưa đúng, cố gắng ở câu sau nhé!';
      feedbackOverlay.classList.add('active');

      // Fly mosquito back
      setTimeout(() => {
        mosquito.style.transform = 'translate(10px, -20px) rotate(-15deg)';
      }, 500);

      // Notify SDK
      if (sdk) {
        sdk.send({
          type: 'submitAnswer',
          payload: {
            playerId: 'local',
            questionId: questions[currentIndex].id,
            answer: 'incorrect',
            isCorrect: false,
            timeMs: Date.now() - questionStartTime
          }
        });
      }

      setTimeout(() => {
        currentIndex++;
        renderCurrentQuestion();
      }, 2200);
    }, 350);
  }

  function showAllCompleted() {
    resetFrogAppearance();
    questionBadge.textContent = 'Hoàn thành';
    questionPrompt.textContent = `Bạn đã hoàn thành tất cả các câu hỏi! Tổng điểm: ${currentScore} điểm. Đang chờ các bạn cùng phòng...`;
    optionsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 20px; background: rgba(255,255,255,0.9); border-radius: 12px;">
        <h3>🐸 Chú ếch đã no bụng!</h3>
        <p style="margin-top:8px; color:#1e6336; font-weight:700;">Đang đồng bộ kết quả tới bục vinh quang...</p>
      </div>
    `;
  }
})();
