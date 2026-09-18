/* MOTORBIKE RUNNER - ENDLESS GAME - CLASSROOM GAME V1 */
(function () {
  'use strict';
  const cg = ClassroomGameBridge.create({ gameId: 'motorbike-runner', version: '1.0.0' });
  const stage = document.getElementById('stage');
  
  let questions = new Map(), current = null, advancing = null, locked = false, settings = { muted: false, reducedMotion: false };
  let audio = null;

  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  
  // Game state
  let gameState = 'riding'; // riding, jumping, crashing
  let obstacleX = -200;
  let obstacleType = 0; // 0: rào chắn, 1: ổ gà
  let motorbikeY = 0;
  let motorbikeVY = 0;
  let motorbikeAngle = 0;
  let bgOffset = 0;
  
  // Canvas Setup
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.borderRadius = '16px';
  canvas.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
  
  const ctx = canvas.getContext('2d');
  
  const gameContainer = h('div', 'game-container');
  gameContainer.appendChild(canvas);
  
  const uiContainer = h('div', 'ui-container');
  
  stage.replaceChildren(gameContainer, uiContainer);

  // Drawing functions
  function drawSky() {
    let grad = ctx.createLinearGradient(0, 0, 0, 250);
    grad.addColorStop(0, '#87CEEB');
    grad.addColorStop(1, '#E0F6FF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 250);
  }

  function drawCity(offset) {
    ctx.save();
    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for(let i=0; i<5; i++) {
       let cx = (i * 300 - offset * 0.1) % 1500;
       if (cx < -200) cx += 1500;
       ctx.beginPath();
       ctx.arc(cx, 100 + (i%2)*20, 40, 0, Math.PI*2);
       ctx.arc(cx+40, 90 + (i%2)*20, 50, 0, Math.PI*2);
       ctx.arc(cx+80, 100 + (i%2)*20, 40, 0, Math.PI*2);
       ctx.fill();
    }

    // Parallax background (tube houses)
    for(let i=0; i<20; i++) {
       let x = (i * 65 - offset * 0.3) % 1300;
       if (x < -100) x += 1300;
       let h = 80 + (i % 4) * 40 + (i % 3) * 30;
       ctx.fillStyle = ['#f5f5dc', '#ffe4b5', '#e0ffff', '#ffb6c1'][i % 4]; 
       ctx.fillRect(x, 250 - h, 60, h);
       ctx.fillStyle = '#c0392b'; 
       ctx.fillRect(x - 5, 250 - h - 10, 70, 10); // roof
       ctx.fillStyle = '#34495e';
       for(let wy = 250 - h + 20; wy < 230; wy += 35) {
           ctx.fillRect(x + 10, wy, 15, 20); // windows
           ctx.fillRect(x + 35, wy, 15, 20);
       }
    }
    // Power lines
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for(let i=0; i<=800; i+=20) {
       let y = 100 + Math.sin((i + offset*0.3)*0.02) * 15;
       if (i===0) ctx.moveTo(i, y);
       else ctx.lineTo(i, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRoad(offset) {
    ctx.fillStyle = '#666'; // Sidewalk
    ctx.fillRect(0, 250, 800, 30);
    
    // Sidewalk tiles
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    for(let i=0; i<30; i++) {
        let x = (i * 40 - offset) % 1200;
        if (x < -100) x += 1200;
        ctx.beginPath(); ctx.moveTo(x, 250); ctx.lineTo(x-10, 280); ctx.stroke();
    }

    ctx.fillStyle = '#333'; // Road
    ctx.fillRect(0, 280, 800, 120);

    // Lane markings
    ctx.fillStyle = '#FFD700';
    for(let i=0; i<10; i++) {
       let x = (i * 150 - offset * 1.5) % 1500;
       if (x < -150) x += 1500;
       ctx.fillRect(x, 335, 80, 5);
    }
  }

  function drawMotorbike(y, angle) {
    ctx.save();
    ctx.translate(150, 295 + y);
    ctx.rotate(angle * Math.PI / 180);
    
    // Wheels
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(-30, 25, 18, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 25, 18, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.beginPath(); ctx.arc(-30, 25, 10, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 25, 10, 0, Math.PI*2); ctx.fill();
    
    // Body
    ctx.fillStyle = '#d32f2f'; 
    ctx.beginPath();
    ctx.moveTo(-45, 10); ctx.lineTo(-35, -5); ctx.lineTo(10, -5); ctx.lineTo(20, 10);
    ctx.lineTo(35, 10); ctx.lineTo(45, -15); ctx.lineTo(35, -25); ctx.lineTo(25, -10);
    ctx.lineTo(-45, 10); ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(38, -22, 4, 0, Math.PI*2); ctx.fill(); // headlight

    // Seat
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.moveTo(-35, -5); ctx.lineTo(5, -5); ctx.lineTo(0, -15); ctx.lineTo(-30, -15); ctx.fill();

    // Rider
    ctx.fillStyle = '#1976D2'; // Shirt
    ctx.beginPath(); ctx.moveTo(-10, -15); ctx.lineTo(-15, -45); ctx.lineTo(5, -45); ctx.lineTo(15, -15); ctx.fill();

    ctx.fillStyle = '#388E3C'; // Pants
    ctx.beginPath(); ctx.moveTo(-10, -15); ctx.lineTo(15, -15); ctx.lineTo(25, 5); ctx.lineTo(15, 15); ctx.lineTo(5, 5); ctx.fill();
    
    // Helmet
    ctx.fillStyle = '#FFB300';
    ctx.beginPath(); ctx.arc(-5, -50, 12, Math.PI, 0); ctx.lineTo(7, -45); ctx.lineTo(-17, -45); ctx.fill();
    
    ctx.fillStyle = '#FFCCBC'; ctx.fillRect(-12, -45, 15, 10); // Face
    
    // Arm
    ctx.strokeStyle = '#FFCCBC'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(15, -25); ctx.stroke();
    
    // Handlebar
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(15, -25); ctx.lineTo(30, -15); ctx.stroke();

    ctx.restore();
  }

  function drawObstacle(x, type) {
    ctx.save();
    ctx.translate(x, 325);
    if (type === 0) { // Barrier
       ctx.fillStyle = '#e74c3c';
       ctx.fillRect(0, -40, 10, 40); ctx.fillRect(50, -40, 10, 40);
       ctx.fillStyle = '#fff'; ctx.fillRect(0, -30, 60, 10);
       ctx.fillStyle = '#e74c3c'; ctx.fillRect(0, -20, 60, 10);
       ctx.fillStyle = '#f1c40f';
       ctx.beginPath(); ctx.moveTo(30, -55); ctx.lineTo(15, -30); ctx.lineTo(45, -30); ctx.fill();
    } else { // Pothole
       ctx.fillStyle = '#1a1a1a';
       ctx.beginPath(); ctx.ellipse(30, 5, 35, 10, 0, 0, Math.PI*2); ctx.fill();
       ctx.fillStyle = '#2a2a2a';
       ctx.beginPath(); ctx.ellipse(30, 5, 25, 6, 0, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function gameLoop() {
    if (!settings.reducedMotion) {
      if (gameState === 'riding') {
        bgOffset += 5;
      } else if (gameState === 'jumping') {
        bgOffset += 5;
        motorbikeY += motorbikeVY;
        motorbikeVY += 1.5; 
        if (motorbikeY < -10) motorbikeAngle = -15;
        else if (motorbikeY > -10 && motorbikeVY > 0) motorbikeAngle = 10;
        if (motorbikeY >= 0) {
           motorbikeY = 0;
           motorbikeVY = 0;
           motorbikeAngle = 0;
           gameState = 'riding';
        }
      } else if (gameState === 'crashing') {
        motorbikeAngle = Math.min(motorbikeAngle + 8, 80);
        motorbikeY += 2;
        if (motorbikeY > 30) motorbikeY = 30;
      }
      
      if (obstacleX > -200) {
        if (gameState !== 'crashing') obstacleX -= 15;
      }
    }
    
    ctx.clearRect(0,0,800,400);
    drawSky();
    drawCity(bgOffset);
    drawRoad(bgOffset);
    if (obstacleX > -200) drawObstacle(obstacleX, obstacleType);
    drawMotorbike(motorbikeY, motorbikeAngle);
    
    requestAnimationFrame(gameLoop);
  }
  requestAnimationFrame(gameLoop);

  // Audio
  function beep(type) {
    if (settings.muted) return;
    try { 
       audio ||= new AudioContext(); 
       const o = audio.createOscillator(), g = audio.createGain(); 
       if (type === 'correct') {
          o.frequency.setValueAtTime(440, audio.currentTime);
          o.frequency.exponentialRampToValueAtTime(880, audio.currentTime + 0.1);
          o.type = 'sine';
       } else if (type === 'crash') {
          o.frequency.setValueAtTime(150, audio.currentTime);
          o.frequency.exponentialRampToValueAtTime(40, audio.currentTime + 0.3);
          o.type = 'sawtooth';
       } else {
          o.frequency.value = 300;
       }
       g.gain.value = 0.1; 
       o.connect(g).connect(audio.destination); 
       o.start(); o.stop(audio.currentTime + 0.4); 
    } catch {}
  }

  function message(text) { uiContainer.replaceChildren(h('div', 'big-msg', text)); }

  cg.on('settings', s => { settings = s; document.body.classList.toggle('reduced', !!s.reducedMotion); });
  cg.on('content', ({ questions: list }) => { questions = new Map(list.map(q => [q.id, q])); current = null; advancing = null; message('Sẵn sàng!'); });
  cg.on('start', () => { if (!current) message('Bắt đầu!'); });
  cg.on('end', () => { locked = true; message('Hết giờ chơi! Xem bảng tổng kết nhé.'); });
  cg.on('error', e => { locked = false; stage.querySelectorAll('button').forEach(b => { b.disabled = false; }); uiContainer.append(h('p', 'error', e.message)); });

  cg.on('state', s => {
    if (s.status !== 'playing') return;
    const q = s.question && questions.get(s.question.id);
    if (!q) { if (!s.question) message('Em đã làm xong! Chờ các bạn nhé.'); return; }
    if (current?.id === q.id || advancing === q.id) return; 
    current = q; locked = s.question.answered;
    
    gameState = 'riding';
    motorbikeY = 0;
    motorbikeAngle = 0;
    obstacleX = -200;
    
    renderQuestion(q, s.question);
  });

  cg.on('result', r => {
    if (!current || r.questionId !== current.id) return;
    const isCorrect = r.status === 'correct';
    
    uiContainer.querySelectorAll('.opt').forEach(b => {
      if (b.dataset.id === r.correctOptionId) b.classList.add('right');
      else if (b.dataset.id === r.answer) b.classList.add('wrong');
    });

    const text = isCorrect ? `Tuyệt vời! Né thành công (+${r.delta})` : `Rất tiếc! Đáp án đúng: ${r.correctText}`;
    uiContainer.querySelector('.question').append(h('p', `feedback ${r.status}`, text));
    
    if (isCorrect) {
       beep('correct');
       obstacleType = Math.random() > 0.5 ? 0 : 1;
       obstacleX = 850;
       setTimeout(() => {
          gameState = 'jumping';
          motorbikeVY = -18;
       }, 500); 
    } else {
       beep('crash');
       obstacleType = 0; 
       obstacleX = 850;
       setTimeout(() => {
          gameState = 'crashing';
       }, 680); // aligns with obstacle reaching x=150
    }
    
    const qid = r.questionId;
    advancing = qid;
    setTimeout(() => { 
       if (current?.id === qid) { 
          current = null; 
          if (cg.state?.pace !== 'teacher') cg.advance(qid); 
       } 
    }, settings.reducedMotion ? 900 : (isCorrect ? 2000 : 2500));
  });

  function renderQuestion(q, meta) {
    const box = h('div', 'question');
    box.append(h('p', 'counter', `Chướng ngại vật số ${meta.index + 1}`), h('h2', 'prompt', q.prompt));
    const opts = h('div', 'options');
    q.options.forEach((o, i) => {
      const b = h('button', 'opt', `${String.fromCharCode(65 + i)}. ${o.text}`);
      b.type = 'button'; b.dataset.id = o.id; b.disabled = locked;
      b.addEventListener('click', () => choose(q.id, o.id, b));
      opts.append(b);
    });
    box.append(opts);
    uiContainer.replaceChildren(box);
  }
  
  function lockButtons() { uiContainer.querySelectorAll('.opt').forEach(b => { b.disabled = true; }); }
  function choose(qid, optionId, btn) {
    if (locked) return;
    locked = true; lockButtons(); btn.classList.add('picked');
    cg.attempt(qid, optionId);
  }
  document.addEventListener('keydown', e => {
    const n = '1234'.indexOf(e.key); const btn = uiContainer.querySelectorAll('.opt')[n];
    if (n >= 0 && btn && !btn.disabled) btn.click();
  });
})();
