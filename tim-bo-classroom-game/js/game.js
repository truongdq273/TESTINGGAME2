/**
 * Game logic inside game.html (iframe)
 * Communicates with parent host via ClassroomGameSDK and direct postMessage fallback
 */
(function (global) {
  'use strict';

  const PLANET_IMAGES = [
    'assets/images/image21.svg',
    'assets/images/image22.svg',
    'assets/images/image23.svg',
    'assets/images/image24.svg'
  ];

  let sdk = null;
  let questions = [];
  let currentQIndex = 0;
  let playerId = 'player_' + Math.random().toString(36).substr(2, 6);
  let qStartTime = 0;
  let inputLocked = false;
  let currentScore = 0;
  let rescuedCount = 0;
  let gameStarted = false;

  // DOM Elements
  const elProgress = document.getElementById('q-progress');
  const elPrompt = document.getElementById('q-prompt');
  const elPlanets = document.getElementById('planets-grid');
  const elCowCount = document.getElementById('cow-count');
  const elScore = document.getElementById('player-score');
  const elOverlay = document.getElementById('rescue-overlay');
  const elFeedback = document.getElementById('action-feedback');
  const elWaiting = document.getElementById('waiting-screen');
  const elGameArea = document.getElementById('game-area');
  const elFinish = document.getElementById('finish-screen');

  // Space Characters (Alien on Left, Astronaut on Right)
  const elAlienImg = document.getElementById('alien-img');
  const elAlienCage = document.getElementById('alien-cage');
  const elAlienSpeech = document.getElementById('alien-speech');
  const elAstronautImg = document.getElementById('astronaut-img');
  const elAstronautSpeech = document.getElementById('astronaut-speech');

  function handleLoadContent(payload) {
    if (payload && Array.isArray(payload.questions) && payload.questions.length > 0) {
      questions = payload.questions;
      console.log('[Game] Loaded', questions.length, 'questions');
    }
  }

  function handleStartGame() {
    if (gameStarted && currentQIndex < questions.length) return;
    gameStarted = true;

    // Nếu chưa có câu hỏi từ parent, tải dự phòng từ content.json
    if (!questions || questions.length === 0) {
      console.warn('[Game] Questions empty on start, fetching fallback content.json...');
      fetch('content.json')
        .then(r => r.json())
        .then(data => {
          if (data && Array.isArray(data.questions)) {
            questions = data.questions.map(q => ({
              id: q.id,
              type: q.type,
              prompt: q.prompt,
              options: q.options,
              points: q.points || 10
            }));
            launchQuestionScene();
          }
        })
        .catch(err => {
          console.error('[Game] Failed to fetch fallback content.json:', err);
        });
      return;
    }

    launchQuestionScene();
  }

  function launchQuestionScene() {
    currentQIndex = 0;
    currentScore = 0;
    rescuedCount = 0;
    updateStatsUI();
    if (elWaiting) elWaiting.style.display = 'none';
    if (elFinish) elFinish.style.display = 'none';
    if (elGameArea) elGameArea.style.display = 'flex';
    AudioManager.startBgm();
    showQuestion(0);
  }

  function handleEndGame() {
    gameStarted = false;
    showFinished();
  }

  function initSDK() {
    try {
      sdk = ClassroomGameSDK.create({ parentOrigin: window.location.origin });
      
      sdk.onMessage((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'loadContent') {
          handleLoadContent(msg.payload);
        } else if (msg.type === 'startGame') {
          handleStartGame();
        } else if (msg.type === 'endGame') {
          handleEndGame();
        }
      });

      sendReadySignal();
    } catch (err) {
      console.warn('[Game] SDK init fallback (running direct message mode):', err);
      sendReadySignal();
    }
  }

  function sendReadySignal() {
    const readyMsg = {
      type: 'gameReady',
      payload: {
        gameId: 'tim-bo-save-cows',
        version: '1.0.0'
      }
    };

    if (sdk) {
      try { sdk.send(readyMsg); } catch {}
    }
    // Gửi trực tiếp tới parent qua window.parent.postMessage
    try {
      window.parent.postMessage(readyMsg, window.location.origin);
    } catch {}
  }

  // Nhận thông tin học sinh từ query param
  const params = new URLSearchParams(window.location.search);
  if (params.get('playerId')) {
    playerId = params.get('playerId');
  }
  if (params.get('autostart') === '1') {
    setTimeout(handleStartGame, 250);
  }

  // Lắng nghe thông điệp trực tiếp từ student.html host adapter
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'loadContent') {
      handleLoadContent(data.payload);
    } else if (data.type === 'startGame') {
      handleStartGame();
    } else if (data.type === 'endGame') {
      handleEndGame();
    } else if (data.type === 'answerResult' && data.payload) {
      handleAnswerResult(data.payload);
    } else if (data.type === 'setPlayer' && data.payload) {
      playerId = data.payload.playerId || playerId;
    }
  });

  function updateStatsUI() {
    if (elCowCount) elCowCount.textContent = String(rescuedCount);
    if (elScore) elScore.textContent = String(currentScore);
  }

  function showQuestion(index) {
    if (!questions || questions.length === 0) return;
    if (index >= questions.length) {
      showFinished();
      return;
    }

    currentQIndex = index;
    inputLocked = false;
    qStartTime = Date.now();
    const q = questions[index];

    // Khởi tạo trạng thái nhân vật cho câu hỏi mới
    resetActorsForQuestion(index);

    if (elProgress) {
      elProgress.textContent = `Nhiệm vụ ${index + 1}/${questions.length}: Quét radar tìm bò!`;
    }
    if (elPrompt) {
      elPrompt.textContent = q.prompt;
    }

    if (elPlanets) {
      elPlanets.innerHTML = '';
      const letters = ['A', 'B', 'C', 'D'];

      q.options.forEach((opt, idx) => {
        const letter = letters[idx] || String(idx + 1);
        const planetImg = PLANET_IMAGES[idx % PLANET_IMAGES.length];

        const card = document.createElement('div');
        card.className = 'planet-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.dataset.optionId = opt.id;
        card.id = `planet-opt-${opt.id}`;

        card.innerHTML = `
          <div class="option-badge">${letter}</div>
          <div class="planet-icon-wrapper">
            <img class="planet-img" src="${planetImg}" alt="Hành tinh ${letter}" />
          </div>
          <div class="option-text">${escapeHtml(opt.text)}</div>
        `;

        card.addEventListener('click', () => onSelectOption(opt.id, card));
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectOption(opt.id, card);
          }
        });

        elPlanets.appendChild(card);
      });
    }

    if (elFeedback) elFeedback.innerHTML = '';
  }

  function resetActorsForQuestion(qIndex) {
    // Mở khóa lồng Alien
    if (elAlienCage) elAlienCage.classList.remove('active');

    // Reset Alien về bay lơ lửng bên trái
    if (elAlienImg) {
      const wasEscaped = elAlienImg.classList.contains('escaped');
      elAlienImg.classList.remove('captured', 'escaped');

      // Nếu vừa thoát ở vòng trước, bay swoop trở lại vũ đài
      if (wasEscaped || qIndex > 0) {
        elAlienImg.classList.add('entering');
        setTimeout(() => {
          if (elAlienImg) elAlienImg.classList.remove('entering');
        }, 850);
      }
    }

    // Reset Phi hành gia về bay lơ lửng bên phải
    if (elAstronautImg) {
      elAstronautImg.classList.remove('cheering', 'sad');
    }

    // Câu thoại ngẫu nhiên sinh động cho học sinh tiểu học
    const alienLines = [
      'Hehe! Đố bạn tìm ra bò! 🛸',
      'Ta giấu đàn bò kỹ lắm! 👾',
      'Bò ngon tuyệt là của ta! 🐮',
      'Thử chọn xem nào! 👀'
    ];
    const astroLines = [
      'Cứu các chú bò nào! 🚀',
      'Quét radar cẩn thận nhé! 🛰️',
      'Bắt tên Alien trộm bò! ⚡',
      'Chọn hành tinh đúng nhé! ⭐'
    ];

    if (elAlienSpeech) {
      elAlienSpeech.textContent = alienLines[qIndex % alienLines.length];
    }
    if (elAstronautSpeech) {
      elAstronautSpeech.textContent = astroLines[qIndex % astroLines.length];
    }
  }

  function onSelectOption(optionId, cardElem) {
    if (inputLocked) return;
    inputLocked = true;

    AudioManager.initUserGesture();
    AudioManager.play('click');

    const timeMs = Math.max(0, Date.now() - qStartTime);
    const q = questions[currentQIndex];

    // Khóa giao diện các hành tinh
    const cards = elPlanets.querySelectorAll('.planet-card');
    cards.forEach(c => c.classList.add('disabled'));

    // Gửi attempt lên host adapter (student.html)
    const attemptData = {
      type: 'gameAnswerAttempt',
      payload: {
        playerId,
        questionId: q.id,
        answer: optionId,
        timeMs
      }
    };

    window.parent.postMessage(attemptData, window.location.origin);

    if (elFeedback) {
      elFeedback.innerHTML = '<p style="color: var(--gold); font-weight: 600;">Đang gửi tín hiệu quét hành tinh...</p>';
    }
  }

  function handleAnswerResult(res) {
    const q = questions[currentQIndex];
    if (!q || q.id !== res.questionId) return;

    const chosenCard = document.getElementById(`planet-opt-${res.answer}`);
    const correctCard = document.getElementById(`planet-opt-${res.correctOptionId}`);

    if (res.isCorrect) {
      currentScore = res.score;
      rescuedCount = res.cowsRescued || (rescuedCount + 1);
      updateStatsUI();

      if (chosenCard) chosenCard.classList.add('correct');
      if (elFeedback) {
        elFeedback.innerHTML = `
          <p style="color: #38b000; font-weight: bold; font-size: 1.15rem;">
            🎉 CHÍNH XÁC! Cứu được 1 chú bò và Bắt được Alien! (+${res.delta || 10} điểm)
          </p>`;
      }

      // Phát âm thanh chiến thắng
      AudioManager.play('correct');
      setTimeout(() => AudioManager.play('boing'), 200);
      setTimeout(() => AudioManager.play('cow'), 550);
      setTimeout(() => AudioManager.play('yes'), 850);

      // Hiệu ứng: Cứu bò bay lên
      triggerRescueAnimation();

      // Hiệu ứng: Bắt người ngoài hành tinh bằng lồng laser
      triggerAlienCapture();

      // Hiệu ứng: Phi hành gia ăn mừng
      triggerAstronautCheer();

    } else {
      if (chosenCard) {
        chosenCard.classList.add('wrong');
        const boom = document.createElement('img');
        boom.src = 'assets/images/image25.svg';
        boom.className = 'explosion-overlay';
        chosenCard.appendChild(boom);
      }

      if (correctCard) {
        correctCard.classList.add('correct');
      }

      if (elFeedback) {
        elFeedback.innerHTML = `
          <p style="color: #ff5964; font-weight: bold; font-size: 1.15rem;">
            💥 Ôi không! Hành tinh bị nổ, Alien đã bay đi mất rồi! (Đáp án đúng: ${res.correctOptionId.toUpperCase()})
          </p>`;
      }

      // Phát âm thanh sai & nổ
      AudioManager.play('wrong');
      setTimeout(() => AudioManager.play('explode'), 200);

      // Hiệu ứng: Alien bay đi mất (thoát khỏi vũ đài)
      triggerAlienEscape();

      // Hiệu ứng: Phi hành gia tiếc nuối
      triggerAstronautOops();
    }

    // Thời gian chờ để quan sát hoạt cảnh cứu bò & bắt/thoát alien
    setTimeout(() => {
      showQuestion(currentQIndex + 1);
    }, 2600);
  }

  function triggerRescueAnimation() {
    if (!elOverlay) return;
    elOverlay.classList.add('active');
    elOverlay.innerHTML = `
      <div class="rescue-beam"></div>
      <img src="assets/images/image18.svg" class="floating-cow" alt="Chú bò được cứu" />
    `;
    setTimeout(() => {
      elOverlay.classList.remove('active');
      elOverlay.innerHTML = '';
    }, 1600);
  }

  function triggerAlienCapture() {
    if (elAlienCage) elAlienCage.classList.add('active');
    if (elAlienImg) {
      elAlienImg.classList.remove('escaped', 'entering');
      elAlienImg.classList.add('captured');
    }
    if (elAlienSpeech) {
      const trappedLines = [
        'ỐI THA CHO TA! ⚡😱',
        'KHÔNG THỂ NÀO! BỊ BẮT RỒI! 🚨',
        'ÁAAA! LỒNG NĂNG LƯỢNG! 💥'
      ];
      elAlienSpeech.textContent = trappedLines[Math.floor(Math.random() * trappedLines.length)];
    }
  }

  function triggerAlienEscape() {
    if (elAlienCage) elAlienCage.classList.remove('active');
    if (elAlienImg) {
      elAlienImg.classList.remove('captured', 'entering');
      elAlienImg.classList.add('escaped');
    }
    if (elAlienSpeech) {
      const escapeLines = [
        'HAHA TRƯỢT RỒI! BYE BYE! 🚀',
        'LÊU LÊU, KHÔNG BẮT ĐƯỢC TA! 😜',
        'VỤT BAY MẤT RỒI! 💨'
      ];
      elAlienSpeech.textContent = escapeLines[Math.floor(Math.random() * escapeLines.length)];
    }
  }

  function triggerAstronautCheer() {
    if (elAstronautImg) {
      elAstronautImg.classList.remove('sad');
      elAstronautImg.classList.add('cheering');
    }
    if (elAstronautSpeech) {
      elAstronautSpeech.textContent = 'TUYỆT VỜI! ĐÃ CỨU ĐƯỢC BÒ! 🐮🎉';
    }
  }

  function triggerAstronautOops() {
    if (elAstronautImg) {
      elAstronautImg.classList.remove('cheering');
      elAstronautImg.classList.add('sad');
    }
    if (elAstronautSpeech) {
      elAstronautSpeech.textContent = 'Tiếc quá! Alien trốn mất rồi! 🛸';
    }
  }

  function showFinished() {
    if (elGameArea) elGameArea.style.display = 'none';
    if (elWaiting) elWaiting.style.display = 'none';
    if (elFinish) {
      elFinish.style.display = 'block';
      const finishScore = document.getElementById('final-cows-score');
      if (finishScore) {
        finishScore.textContent = `Bạn đã giải cứu thành công ${rescuedCount} chú bò và đạt ${currentScore} điểm!`;
      }
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Keyboard shortcut listener
  window.addEventListener('keydown', (e) => {
    if (inputLocked || !elPlanets) return;
    const key = e.key.toUpperCase();
    const keyMap = { '1': 0, 'A': 0, '2': 1, 'B': 1, '3': 2, 'C': 2, '4': 3, 'D': 3 };
    if (Object.hasOwn(keyMap, key)) {
      const idx = keyMap[key];
      const cards = elPlanets.querySelectorAll('.planet-card');
      if (cards[idx]) {
        cards[idx].click();
      }
    }
  });

  // Init
  window.addEventListener('DOMContentLoaded', () => {
    initSDK();

    // Re-check if game started after 1 second if still in waiting
    const checkTimer = setInterval(() => {
      if (gameStarted) {
        clearInterval(checkTimer);
      } else {
        sendReadySignal();
      }
    }, 1200);
  });
})(typeof window !== 'undefined' ? window : this);