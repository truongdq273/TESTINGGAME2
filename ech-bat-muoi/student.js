(function () {
      'use strict';

      const transport = ClassroomTransport.create();
      const controller = ClassroomRoomController.create({ role: 'student', transport });

      const viewJoin = document.getElementById('view-join');
      const viewLobby = document.getElementById('view-student-lobby');
      const viewGameplay = document.getElementById('view-gameplay');
      const viewPodium = document.getElementById('view-podium');
      const joinForm = document.getElementById('join-form');
      const inputRoomCode = document.getElementById('input-room-code');
      const inputStudentName = document.getElementById('input-student-name');
      const studentDispRoomCode = document.getElementById('student-disp-room-code');
      const studentRosterContainer = document.getElementById('student-roster-container');
      const gameIframe = document.getElementById('game-iframe');
      const podiumSteps = document.getElementById('podium-steps');
      const canvasConfetti = document.getElementById('canvas-confetti');

      let currentQuestions = [];

      // Check URL query parameters (e.g. ?room=FROG)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('room')) {
        inputRoomCode.value = urlParams.get('room').toUpperCase();
      }

      const btnBackHome = document.getElementById('btn-back-home');
      if (btnBackHome) {
        btnBackHome.addEventListener('click', () => window.location.reload());
      }

      joinForm.addEventListener('submit', e => {
        e.preventDefault();
        const code = inputRoomCode.value.trim().toUpperCase();
        const name = inputStudentName.value.trim();
        if (!code || !name) return;

        studentDispRoomCode.textContent = code;
        controller.initStudent(code, name);

        viewJoin.style.display = 'none';
        viewLobby.style.display = 'block';
      });

      function updateRoster(list) {
        studentRosterContainer.innerHTML = '';
        list.forEach(p => {
          const div = document.createElement('div');
          div.className = 'student-chip ready';
          div.innerHTML = `
            <div class="student-avatar">🐸</div>
            <div class="student-info">
              <div class="student-name">${escapeHTML(p.name)}</div>
              <div class="student-score">${p.score} điểm</div>
            </div>
          `;
          studentRosterContainer.appendChild(div);
        });
      }

      function escapeHTML(str) {
        return String(str || '').replace(/[&<>'"]/g, tag => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
      }

      // Controller Event Listeners
      controller.on((evt, data) => {
        if (evt === 'rosterChange') {
          updateRoster(data);
        } else if (evt === 'roundStarted') {
          currentQuestions = data.questions;
          startGameplay();
        } else if (evt === 'snapshotReconciled') {
          if (data.state === 'playing') {
            currentQuestions = data.questions;
            startGameplay();
          } else if (data.state === 'ended') {
            showPodium(data.rosterList);
          }
        } else if (evt === 'answerResult') {
          // Pass private answer result into the game iframe
          if (gameIframe && gameIframe.contentWindow) {
            gameIframe.contentWindow.postMessage({
              type: 'authorityAnswerResult',
              payload: data
            }, window.location.origin);
          }
        } else if (evt === 'gameEnded') {
          showPodium(data.leaderboard);
        }
      });

      function startGameplay() {
        viewLobby.style.display = 'none';
        viewJoin.style.display = 'none';
        viewPodium.style.display = 'none';
        viewGameplay.style.display = 'block';

        // Deliver questions and startGame to embedded iframe
        setTimeout(() => {
          if (gameIframe && gameIframe.contentWindow) {
            gameIframe.contentWindow.postMessage({
              type: 'loadContent',
              payload: { questions: currentQuestions }
            }, window.location.origin);

            setTimeout(() => {
              gameIframe.contentWindow.postMessage({
                type: 'startGame'
              }, window.location.origin);
            }, 100);
          }
        }, 200);
      }

      // Listen for submit attempt from iframe
      window.addEventListener('message', e => {
        if (e.origin !== window.location.origin) return;
        if (e.data && e.data.type === 'studentSubmitAttempt') {
          const { questionId, optionId, timeMs } = e.data.payload;
          controller.submitStudentAnswer(questionId, optionId, timeMs);
        }
      });

      function showPodium(leaderboard) {
        viewGameplay.style.display = 'none';
        viewLobby.style.display = 'none';
        viewPodium.style.display = 'block';

        podiumSteps.innerHTML = '';
        const sorted = (leaderboard || []).sort((a, b) => b.score - a.score);

        // Visual order for top 3: 2nd on left, 1st in center, 3rd on right
        const visualOrder = [];
        if (sorted[1]) visualOrder.push({ ...sorted[1], rank: 2 });
        if (sorted[0]) visualOrder.push({ ...sorted[0], rank: 1 });
        if (sorted[2]) visualOrder.push({ ...sorted[2], rank: 3 });
        if (sorted[3]) visualOrder.push({ ...sorted[3], rank: 4 });

        visualOrder.forEach(p => {
          const step = document.createElement('div');
          step.className = 'podium-step';
          step.innerHTML = `
            <div style="font-size:2rem; margin-bottom:4px;">🐸</div>
            <div class="podium-player-name">${escapeHTML(p.name)}</div>
            <div class="podium-player-score">${p.score} điểm</div>
            <div class="podium-pedestal podium-rank-${p.rank}">${p.rank}</div>
          `;
          podiumSteps.appendChild(step);
        });

        startConfetti();
      }

      function startConfetti() {
        canvasConfetti.style.display = 'block';
        const ctx = canvasConfetti.getContext('2d');
        const W = canvasConfetti.width = window.innerWidth;
        const H = canvasConfetti.height = window.innerHeight;

        const pieces = [];
        const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];

        for (let i = 0; i < 100; i++) {
          pieces.push({
            x: Math.random() * W,
            y: Math.random() * H - H,
            r: Math.random() * 6 + 4,
            d: Math.random() * 40,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.random() * 10 - 10,
            tiltAngleIncremental: Math.random() * 0.07 + 0.05,
            tiltAngle: 0
          });
        }

        let animationFrame;
        let count = 0;
        function draw() {
          ctx.clearRect(0, 0, W, H);
          pieces.forEach(p => {
            p.tiltAngle += p.tiltAngleIncremental;
            p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
            p.tilt = Math.sin(p.tiltAngle - (count / 3)) * 15;
            ctx.beginPath();
            ctx.lineWidth = p.r / 2;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
            ctx.stroke();
          });
          count++;
          if (count < 280) {
            animationFrame = requestAnimationFrame(draw);
          } else {
            canvasConfetti.style.display = 'none';
          }
        }
        draw();
      }
    })();
