(async function () {
      'use strict';

      function generateRoomCode() {
        const words = ['FROG', 'LILY', 'POND', 'TOAD', 'RAIN', 'JUMP', 'LEAF', 'SWIM'];
        return words[Math.floor(Math.random() * words.length)];
      }

      const roomCode = generateRoomCode();
      document.getElementById('disp-room-code').textContent = roomCode;

      // Load Question Bank
      let questionBank;
      try {
        questionBank = await ClassroomContentLoader.loadQuestionBank('./content.json');
      } catch (err) {
        alert('Lỗi tải câu hỏi: ' + err.message);
        return;
      }

      const transport = ClassroomTransport.create();
      const controller = ClassroomRoomController.create({ role: 'teacher', transport });
      controller.initTeacher(roomCode, questionBank);

      // DOM Elements
      const viewLobby = document.getElementById('view-lobby');
      const viewGame = document.getElementById('view-game');
      const viewSummary = document.getElementById('view-summary');
      const rosterContainer = document.getElementById('roster-container');
      const rosterCount = document.getElementById('roster-count');
      const btnStartGame = document.getElementById('btn-start-game');
      const btnForceEnd = document.getElementById('btn-force-end');
      const btnExportCsv = document.getElementById('btn-export-csv');
      const btnPlayAgain = document.getElementById('btn-play-again');
      const roomStatusBadge = document.getElementById('room-status-badge');
      const teacherMonitoringTbody = document.getElementById('teacher-monitoring-tbody');
      const summaryTbody = document.getElementById('summary-tbody');

      function updateRosterUI(roster) {
        rosterCount.textContent = roster.length;
        btnStartGame.disabled = roster.length === 0;

        if (roster.length === 0) {
          rosterContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 24px;">Đang chờ học sinh tham gia phòng...</div>';
          return;
        }

        rosterContainer.innerHTML = '';
        roster.forEach(p => {
          const div = document.createElement('div');
          div.className = 'student-chip ready';
          div.innerHTML = `
            <div class="student-avatar">🐸</div>
            <div class="student-info">
              <div class="student-name">${escapeHTML(p.name)}</div>
              <div class="student-score">${p.score} điểm</div>
            </div>
          `;
          rosterContainer.appendChild(div);
        });

        updateMonitoringTable(roster);
      }

      function updateMonitoringTable(roster) {
        teacherMonitoringTbody.innerHTML = '';
        const totalQ = questionBank.questions.length;

        roster.forEach(p => {
          const answered = p.correctCount + p.incorrectCount;
          const accuracy = answered > 0 ? Math.round((p.correctCount / answered) * 100) : 0;
          const isDone = answered >= totalQ;

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight:700;">${escapeHTML(p.name)}</td>
            <td style="font-weight:800; color:var(--primary);">${p.score}</td>
            <td>${p.currentQ || 0}/${totalQ} câu</td>
            <td><span style="color:#28a745;">✓ ${p.correctCount}</span> - <span style="color:#dc3545;">✗ ${p.incorrectCount}</span></td>
            <td><strong>${accuracy}%</strong></td>
            <td><span class="badge-status ${isDone ? 'badge-done' : 'badge-playing'}">${isDone ? 'Hoàn thành' : 'Đang chơi'}</span></td>
          `;
          teacherMonitoringTbody.appendChild(tr);
        });
      }

      function escapeHTML(str) {
        return String(str || '').replace(/[&<>'"]/g, tag => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
      }

      function escapeCSV(field) {
        let str = String(field == null ? '' : field);
        // Protect against formula injection
        if (/^[=+@\-]/.test(str)) {
          str = "'" + str;
        }
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }

      // Controller events
      controller.on((evt, data) => {
        if (evt === 'rosterChange') {
          updateRosterUI(data);
        } else if (evt === 'studentAnswered') {
          updateMonitoringTable(controller.roster);
        } else if (evt === 'gameEnded') {
          showSummary(data.leaderboard);
        }
      });

      btnStartGame.addEventListener('click', () => {
        controller.startRound();
        viewLobby.style.display = 'none';
        viewGame.style.display = 'block';
        viewSummary.style.display = 'none';
        roomStatusBadge.className = 'badge-status badge-playing';
        roomStatusBadge.textContent = 'Đang Chơi';
        updateMonitoringTable(controller.roster);
      });

      btnForceEnd.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn kết thúc trò chơi ngay bây giờ?')) {
          controller.endGameDirectly();
        }
      });

      function showSummary(leaderboard) {
        viewLobby.style.display = 'none';
        viewGame.style.display = 'none';
        viewSummary.style.display = 'block';
        roomStatusBadge.className = 'badge-status badge-done';
        roomStatusBadge.textContent = 'Tổng Kết';

        summaryTbody.innerHTML = '';
        leaderboard.forEach(p => {
          const tr = document.createElement('tr');
          const medal = p.rank === 1 ? '🥇' : (p.rank === 2 ? '🥈' : (p.rank === 3 ? '🥉' : '🎖️'));
          tr.innerHTML = `
            <td style="font-weight:900; font-size:1.1rem;">${medal} Top ${p.rank}</td>
            <td style="font-weight:700;">${escapeHTML(p.name)}</td>
            <td style="font-weight:800; color:var(--primary); font-size:1.1rem;">${p.score}</td>
            <td style="color:#28a745; font-weight:700;">${p.correctCount}</td>
            <td style="color:#dc3545; font-weight:700;">${p.incorrectCount}</td>
          `;
          summaryTbody.appendChild(tr);
        });
      }

      btnExportCsv.addEventListener('click', () => {
        const rows = [
          ['Rank', 'PlayerId', 'Name', 'Score', 'Correct', 'Incorrect', 'TotalQuestions']
        ];
        const roster = controller.roster.sort((a, b) => b.score - a.score);
        const totalQ = questionBank.questions.length;

        roster.forEach((p, idx) => {
          rows.push([
            idx + 1,
            p.id,
            p.name,
            p.score,
            p.correctCount,
            p.incorrectCount,
            totalQ
          ]);
        });

        const csvContent = '\uFEFF' + rows.map(r => r.map(escapeCSV).join(',')).join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Ech_Bat_Muoi_Ket_Qua_${roomCode}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });

      btnPlayAgain.addEventListener('click', () => {
        viewSummary.style.display = 'none';
        viewLobby.style.display = 'block';
        roomStatusBadge.className = 'badge-status badge-ready';
        roomStatusBadge.textContent = 'Phòng Chờ';
        updateRosterUI(controller.roster);
      });
    })();
