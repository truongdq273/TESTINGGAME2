(function () {
  'use strict';
  const cg = ClassroomGameBridge.create({ gameId: 'tower-builder', version: '1.0.0' });
  const stage = document.getElementById('stage');
  
  const canvas = document.createElement('canvas');
  canvas.id = 'gameCanvas';
  const uiLayer = document.createElement('div');
  uiLayer.id = 'ui-layer';
  stage.appendChild(canvas);
  stage.appendChild(uiLayer);

  const ctx = canvas.getContext('2d');

  let questions = new Map(), current = null, advancing = null, locked = false, settings = { muted: false, reducedMotion: false }, timer = null, audio = null;

  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
  function beep(freq) {
    if (settings.muted) return;
    try { audio ||= new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; g.gain.value = 0.08; o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.15); } catch {}
  }
  function message(text) { 
    uiLayer.replaceChildren(h('p', 'big-msg', text)); 
  }

  // --- GAME LOGIC & PHYSICS ---
  let canvasW = 0, canvasH = 0;
  function resize() {
    canvasW = canvas.width = window.innerWidth;
    canvasH = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const BLOCK_W = 160;
  const BLOCK_H = 100;
  
  let tower = [];
  let fallingBlock = null;
  let crane = { x: canvasW / 2, angle: 0, time: 0 };
  let cameraY = 0;
  let windSpeed = 0;
  let windTarget = 0.5; // -1 to 1
  let windParticles = [];
  let clouds = [];
  
  for(let i=0; i<5; i++) {
    clouds.push({
      x: Math.random() * 2000 - 500,
      y: Math.random() * 300,
      s: Math.random() * 0.5 + 0.5,
      speed: Math.random() * 0.5 + 0.2
    });
  }

  function initGame() {
    tower = [{ x: canvasW / 2, y: canvasH - BLOCK_H/2, color: '#4b5563', windows: false }];
    cameraY = 0;
    fallingBlock = null;
    spawnParticles();
  }

  function spawnParticles() {
    windParticles = [];
    for(let i=0; i<30; i++) {
      windParticles.push({
        x: Math.random() * canvasW,
        y: Math.random() * canvasH,
        len: Math.random() * 50 + 20,
        speed: Math.random() * 2 + 1
      });
    }
  }
  
  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  function getNextColor() { return colors[tower.length % colors.length]; }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.arc(40, -10, 50, 0, Math.PI * 2);
    ctx.arc(80, 0, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBlock(x, y, color, angle = 0, isBase = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-BLOCK_W/2 + 5, -BLOCK_H/2 + 5, BLOCK_W, BLOCK_H);
    
    ctx.fillStyle = color;
    ctx.fillRect(-BLOCK_W/2, -BLOCK_H/2, BLOCK_W, BLOCK_H);
    
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-BLOCK_W/2, -BLOCK_H/2, BLOCK_W, 10);
    ctx.fillRect(-BLOCK_W/2, -BLOCK_H/2, 10, BLOCK_H);
    
    // Windows
    if (!isBase) {
      ctx.fillStyle = '#93c5fd';
      for(let wx = -BLOCK_W/2 + 20; wx < BLOCK_W/2 - 10; wx += 40) {
        for(let wy = -BLOCK_H/2 + 20; wy < BLOCK_H/2 - 10; wy += 35) {
          ctx.fillRect(wx, wy, 20, 25);
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(wx, wy, 5, 25);
          ctx.fillStyle = '#93c5fd';
        }
      }
    }
    ctx.restore();
  }

  let lastTime = 0;
  function updatePhysics(dt) {
    if(dt > 100) dt = 16; // prevent giant steps
    crane.time += dt * 0.002;
    
    // Wind changes smoothly
    if (Math.random() < 0.01) {
      windTarget = (Math.random() - 0.5) * 2; // -1 to 1
    }
    windSpeed += (windTarget - windSpeed) * 0.01;
    
    // Crane swings
    let sway = Math.sin(crane.time) * 100;
    crane.x = canvasW/2 + sway;
    crane.angle = windSpeed * 0.2 + Math.sin(crane.time*2) * 0.05;

    // Camera follow top of tower
    let targetCameraY = Math.max(0, tower.length * BLOCK_H - canvasH/2);
    cameraY += (targetCameraY - cameraY) * 0.05;

    // Falling block
    if (fallingBlock) {
      fallingBlock.vy += 0.001 * dt; // gravity
      fallingBlock.vx += windSpeed * 0.0005 * dt; // wind push
      
      fallingBlock.x += fallingBlock.vx * dt;
      fallingBlock.y += fallingBlock.vy * dt;
      fallingBlock.angle += fallingBlock.va * dt;
      
      // Check collision / drop end
      if (fallingBlock.correct) {
         // Guided to landing position if correct
         let targetX = canvasW / 2;
         let targetY = canvasH - BLOCK_H/2 - tower.length * BLOCK_H;
         
         // Pull towards center
         fallingBlock.x += (targetX - fallingBlock.x) * 0.05;
         fallingBlock.angle *= 0.9; // upright

         if (fallingBlock.y >= targetY) {
           // Landed!
           tower.push({ x: targetX, y: targetY, color: fallingBlock.color });
           fallingBlock = null;
         }
      } else {
         // Falling off screen
         if (fallingBlock.y > canvasH + cameraY + 200) {
           fallingBlock = null;
         }
      }
    }

    // Update clouds & particles
    clouds.forEach(c => {
      c.x += c.speed * dt * 0.05 + windSpeed * dt * 0.1;
      if (c.x > canvasW + 200) c.x = -200;
      if (c.x < -200) c.x = canvasW + 200;
    });

    windParticles.forEach(p => {
      p.x += windSpeed * p.speed * dt * 0.5;
      if (windSpeed > 0 && p.x > canvasW) p.x = 0, p.y = Math.random()*canvasH;
      if (windSpeed < 0 && p.x < 0) p.x = canvasW, p.y = Math.random()*canvasH;
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvasW, canvasH);
    
    // Background sky gradient
    let grd = ctx.createLinearGradient(0, 0, 0, canvasH);
    grd.addColorStop(0, "#38bdf8");
    grd.addColorStop(1, "#bae6fd");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Sun
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(100, 100, 50, 0, Math.PI*2);
    ctx.fill();

    // Clouds
    clouds.forEach(c => drawCloud(c.x, c.y, c.s));

    ctx.save();
    ctx.translate(0, cameraY); // Scroll up as tower grows

    // Tower base block
    tower.forEach((b, i) => {
      drawBlock(b.x, b.y, b.color, 0, i === 0);
    });

    // Falling block
    if (fallingBlock) {
      drawBlock(fallingBlock.x, fallingBlock.y, fallingBlock.color, fallingBlock.angle);
    }
    
    ctx.restore();

    // Crane (fixed at top)
    ctx.save();
    ctx.translate(crane.x, 0);
    
    // Rail
    ctx.fillStyle = '#475569';
    ctx.fillRect(-canvasW, 0, canvasW*2, 20);
    
    // Crane body
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-30, 20, 60, 40);
    
    // Cable
    let cableLen = 150;
    let hookX = Math.sin(crane.angle) * cableLen;
    let hookY = Math.cos(crane.angle) * cableLen + 60;
    
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.lineTo(hookX, hookY);
    ctx.stroke();

    // Hanging block (if playing and not falling)
    if (current && !fallingBlock && !locked) {
      // draw block attached to crane
      drawBlock(hookX, hookY + BLOCK_H/2, getNextColor(), crane.angle);
    }
    
    ctx.restore();

    // Wind particles
    if (Math.abs(windSpeed) > 0.2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      windParticles.forEach(p => {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len * (windSpeed > 0 ? 1 : -1), p.y);
      });
      ctx.stroke();
    }
  }

  function loop(timestamp) {
    let dt = timestamp - lastTime;
    lastTime = timestamp;
    updatePhysics(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --- GAME BRIDGE INTEGRATION ---

  cg.on('settings', s => { settings = s; document.body.classList.toggle('reduced', !!s.reducedMotion); });
  cg.on('content', ({ questions: list }) => { 
    questions = new Map(list.map(q => [q.id, q])); 
    current = null; 
    advancing = null; 
    initGame();
    message('Sẵn sàng!'); 
  });
  
  cg.on('start', () => { 
    if (!current) message('Bắt đầu xây tháp nào!'); 
  });
  
  cg.on('end', () => { 
    clearInterval(timer); 
    locked = true; 
    message('Hết giờ chơi! Xem bảng tổng kết nhé.'); 
  });
  
  cg.on('error', e => { 
    locked = false; 
    uiLayer.querySelectorAll('button').forEach(b => { b.disabled = false; }); 
    uiLayer.append(h('p', 'error', e.message)); 
  });

  cg.on('state', s => {
    if (s.status !== 'playing') return;
    const q = s.question && questions.get(s.question.id);
    if (!q) { 
      if (!s.question) message('Em đã làm xong! Chờ các bạn nhé.'); 
      return; 
    }
    if (current?.id === q.id || advancing === q.id) return; // same question, keep the screen
    current = q; locked = s.question.answered;
    
    // Make sure falling block is reset if new question appears
    if(!locked) fallingBlock = null;

    renderQuestion(q, s.question);
  });

  cg.on('result', r => {
    if (!current || r.questionId !== current.id) return;
    clearInterval(timer);
    
    uiLayer.querySelectorAll('.opt').forEach(b => {
      if (b.dataset.id === r.correctOptionId) b.classList.add('right');
      else if (b.dataset.id === r.answer) b.classList.add('wrong');
    });
    
    const text = r.status === 'correct' ? `Đúng rồi! +${r.delta}` : r.status === 'timeout' ? `Hết giờ! Đáp án: ${r.correctText}` : `Chưa đúng. Đáp án: ${r.correctText}`;
    uiLayer.querySelector('.question-box').append(h('p', `feedback ${r.status}`, text));
    if (r.explanation) uiLayer.querySelector('.question-box').append(h('p', 'explain', r.explanation));
    
    beep(r.status === 'correct' ? 880 : 220);
    
    const qid = r.questionId;
    advancing = qid;

    // Trigger physics drop
    let cableLen = 150;
    let hookX = crane.x + Math.sin(crane.angle) * cableLen;
    let hookY = 60 + Math.cos(crane.angle) * cableLen + BLOCK_H/2;
    
    fallingBlock = {
      x: hookX,
      y: hookY - cameraY, // Convert screen space to world space
      vx: r.status === 'correct' ? 0 : windSpeed * 2,
      vy: 0,
      va: r.status === 'correct' ? 0 : (Math.random() - 0.5) * 0.01,
      angle: crane.angle,
      color: getNextColor(),
      correct: r.status === 'correct'
    };

    // Delay before next question to allow animation to play
    setTimeout(() => { 
      if (current?.id === qid) { 
        current = null; 
        if (cg.state?.pace !== 'teacher') cg.advance(qid); 
      } 
    }, settings.reducedMotion ? 900 : 3000); // 3 seconds for block to drop and land
  });

  function renderQuestion(q, meta) {
    clearInterval(timer);
    const box = h('div', 'question-box');
    box.append(h('p', 'counter', `Tầng ${meta.index + 1}`), h('h1', 'prompt', q.prompt));
    
    const opts = h('div', 'options');
    q.options.forEach((o, i) => {
      const b = h('button', 'opt', `${String.fromCharCode(65 + i)}. ${o.text}`);
      b.type = 'button'; b.dataset.id = o.id; b.disabled = locked;
      b.addEventListener('click', () => choose(q.id, o.id, b));
      opts.append(b);
    });
    box.append(opts);
    
    if (q.timeLimitMs) {
      // Timebar implementation if needed, skipped for simplicity here or add simple css bar
    }
    
    uiLayer.replaceChildren(box);
  }

  function lockButtons() { uiLayer.querySelectorAll('.opt').forEach(b => { b.disabled = true; }); }
  function choose(qid, optionId, btn) {
    if (locked) return;
    locked = true; lockButtons(); btn.classList.add('picked');
    cg.attempt(qid, optionId);
  }
  
  document.addEventListener('keydown', e => {
    const n = '1234'.indexOf(e.key); const btn = uiLayer.querySelectorAll('.opt')[n];
    if (n >= 0 && btn && !btn.disabled) btn.click();
  });
  
  initGame();

})();
