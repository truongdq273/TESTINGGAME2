/**
 * Room Controller: Single source of truth for Room State, Authority grading,
 * Roster, Snapshot reconciliation, and Leaderboard ranking.
 */

(function (global) {
  'use strict';

  function computeLeaderboard(roster) {
    const list = Object.values(roster).map(p => ({
      playerId: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score || 0,
      correctCount: p.correctCount || 0,
      wrongCount: p.wrongCount || 0,
      progress: p.progress || 0,
      totalQuestions: p.totalQuestions || 0,
      status: p.status || 'ready'
    }));

    // Sort descending by score, stable tie-breaker by playerId
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.playerId.localeCompare(b.playerId);
    });

    // Assign standard ranking (1224 format)
    let currentRank = 1;
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && list[i].score < list[i - 1].score) {
        currentRank = i + 1;
      }
      list[i].rank = currentRank;
    }
    return list;
  }

  function escapeCsvCell(val) {
    let str = String(val === undefined || val === null ? '' : val);
    // Neutralize formula injection
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function generateCsvReport(roomCode, roundId, leaderboard, totalQuestions) {
    const headers = [
      'Hạng',
      'Mã học sinh (ID)',
      'Tên học sinh',
      'Điểm số',
      'Số câu đúng',
      'Số câu sai',
      'Số câu chưa làm',
      'Tiến độ',
      'Tỷ lệ đúng (%)'
    ];

    const rows = leaderboard.map(p => {
      const unanswered = Math.max(0, totalQuestions - (p.correctCount + p.wrongCount));
      const accuracy = (p.correctCount + p.wrongCount) > 0
        ? Math.round((p.correctCount / (p.correctCount + p.wrongCount)) * 100) + '%'
        : '0%';
      return [
        p.rank,
        p.playerId,
        p.name,
        p.score,
        p.correctCount,
        p.wrongCount,
        unanswered,
        `${p.progress}/${totalQuestions}`,
        accuracy
      ].map(escapeCsvCell).join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    return csvContent;
  }

  // ================= TEACHER AUTHORITY CONTROLLER ================= //
  function createTeacherController({ transport, contentData, onSnapshot }) {
    let roomCode = '';
    let roundId = 'round-1';
    let revision = 1;
    let state = 'waiting'; // 'waiting' | 'playing' | 'ended'
    let questionBank = contentData.questions || [];
    let contentVersion = contentData.contentVersion || 'v1';
    let title = contentData.title || 'Vũ trụ & Thiên văn học';

    let roster = {}; // playerId -> player state
    const evaluatedKeys = new Set(); // dedupe set: roomCode:roundId:playerId:questionId
    const perQuestionStats = {}; // questionId -> { submitted: 0, correct: 0 }

    questionBank.forEach(q => {
      perQuestionStats[q.id] = { submitted: 0, correct: 0 };
    });

    const secretAnswerKey = new Map();
    questionBank.forEach(q => {
      secretAnswerKey.set(q.id, {
        correctOptionId: q.correctOptionId,
        points: q.points || 10,
        explanation: q.explanation || ''
      });
    });

    function getSnapshot() {
      return {
        roomCode,
        roundId,
        revision,
        state,
        title,
        contentVersion,
        totalQuestions: questionBank.length,
        roster: Object.values(roster),
        leaderboard: computeLeaderboard(roster),
        timestamp: Date.now()
      };
    }

    function broadcastSnapshot() {
      revision++;
      const snap = getSnapshot();
      transport.send({
        type: 'roomSnapshot',
        roundId,
        payload: snap
      });
      // Save state to sessionStorage for reload recovery
      try {
        sessionStorage.setItem(`teacher_room_${roomCode}`, JSON.stringify({
          roomCode, roundId, revision, state, roster
        }));
      } catch (e) {}

      if (typeof onSnapshot === 'function') {
        try {
          onSnapshot(snap);
        } catch (err) {
          console.error('[TeacherController] onSnapshot error:', err);
        }
      }
      return snap;
    }

    function initRoom(code, restoredData = null) {
      roomCode = code.toUpperCase().trim();
      if (restoredData && restoredData.roundId) {
        roundId = restoredData.roundId;
        revision = restoredData.revision || 1;
        state = restoredData.state || 'waiting';
        roster = restoredData.roster || {};
      } else {
        roundId = 'round-' + Date.now().toString(36);
        state = 'waiting';
        revision = 1;
        roster = {};
      }

      transport.join(roomCode, { id: 'teacher', name: 'Giáo viên', role: 'teacher' });

      // Listen to player events
      transport.onEvent(envelope => {
        if (envelope.roomCode !== roomCode) return;

        if (envelope.type === 'playerJoin') {
          handlePlayerJoin(envelope.payload);
        } else if (envelope.type === 'answerAttempt') {
          handleAnswerAttempt(envelope.senderId, envelope.payload);
        } else if (envelope.type === 'requestSnapshot') {
          broadcastSnapshot();
        }
      });

      broadcastSnapshot();
    }

    function updateQuestionBank(newContent) {
      questionBank = newContent.questions;
      contentVersion = newContent.contentVersion;
      title = newContent.title;

      secretAnswerKey.clear();
      questionBank.forEach(q => {
        secretAnswerKey.set(q.id, {
          correctOptionId: q.correctOptionId,
          points: q.points || 10,
          explanation: q.explanation || ''
        });
        if (!perQuestionStats[q.id]) {
          perQuestionStats[q.id] = { submitted: 0, correct: 0 };
        }
      });
      broadcastSnapshot();
    }

    function handlePlayerJoin(playerInfo) {
      if (!playerInfo || !playerInfo.id) return;
      const id = playerInfo.id;
      if (!roster[id]) {
        roster[id] = {
          id,
          name: playerInfo.name || 'Học sinh',
          avatar: playerInfo.avatar || 'avatar-cadet-red.png',
          score: 0,
          progress: 0,
          correctCount: 0,
          wrongCount: 0,
          currentQuestionIndex: 0,
          status: 'ready',
          joinedAt: Date.now()
        };
      } else {
        // Update reconnection
        roster[id].name = playerInfo.name || roster[id].name;
        roster[id].avatar = playerInfo.avatar || roster[id].avatar;
      }
      broadcastSnapshot();
    }

    function addMockStudent(name = 'Minh Khang (Demo)', avatar = 'avatar-cadet-red.png') {
      const id = 'mock_' + Date.now().toString(36);
      handlePlayerJoin({ id, name, avatar });
      return id;
    }

    function handleAnswerAttempt(senderId, payload) {
      if (state !== 'playing') return;
      if (!payload || !payload.questionId) return;

      const playerId = senderId;
      const questionId = payload.questionId;
      const answer = payload.answer;
      const timeMs = payload.timeMs || 0;

      const dedupeKey = `${roomCode}:${roundId}:${playerId}:${questionId}`;
      if (evaluatedKeys.has(dedupeKey)) {
        console.warn(`[Authority] Duplicate answer attempt ignored: ${dedupeKey}`);
        return;
      }
      evaluatedKeys.add(dedupeKey);

      const secret = secretAnswerKey.get(questionId);
      if (!secret) return;

      const isCorrect = (String(answer).toLowerCase() === String(secret.correctOptionId).toLowerCase());
      const pointsAwarded = isCorrect ? secret.points : 0;

      const player = roster[playerId];
      if (player) {
        player.score += pointsAwarded;
        if (isCorrect) player.correctCount++;
        else player.wrongCount++;
        player.progress = Math.min(questionBank.length, player.progress + 1);
        player.currentQuestionIndex = player.progress;
        if (player.progress >= questionBank.length) {
          player.status = 'completed';
        } else {
          player.status = 'answering';
        }
      }

      // Update question stats
      if (perQuestionStats[questionId]) {
        perQuestionStats[questionId].submitted++;
        if (isCorrect) perQuestionStats[questionId].correct++;
      }

      // Send private answerResult directly to the student
      transport.send({
        type: 'answerResult',
        roundId,
        recipientId: playerId,
        payload: {
          questionId,
          answer,
          isCorrect,
          correctOptionId: secret.correctOptionId,
          pointsAwarded,
          totalScore: player ? player.score : 0,
          explanation: secret.explanation,
          timeMs
        }
      });

      // Broadcast updated snapshot to update leaderboard and teacher table
      broadcastSnapshot();

      // Check if all players completed
      const playerList = Object.values(roster);
      if (playerList.length > 0 && playerList.every(p => p.progress >= questionBank.length)) {
        endGame();
      }
    }

    function startGame() {
      const count = Object.keys(roster).length;
      if (count === 0) {
        throw new Error('Cần có ít nhất 1 học sinh tham gia phòng để bắt đầu. Bạn có thể mở tab student.html hoặc bấm Thêm học sinh thử nghiệm.');
      }
      state = 'playing';
      // Reset player progress for this round
      Object.values(roster).forEach(p => {
        p.score = 0;
        p.progress = 0;
        p.correctCount = 0;
        p.wrongCount = 0;
        p.currentQuestionIndex = 0;
        p.status = 'answering';
      });
      evaluatedKeys.clear();
      questionBank.forEach(q => {
        perQuestionStats[q.id] = { submitted: 0, correct: 0 };
      });

      transport.send({
        type: 'gameStarted',
        roundId,
        payload: {
          contentVersion,
          totalQuestions: questionBank.length,
          questions: window.ContentLoader ? window.ContentLoader.getLearnerSafeQuestions(questionBank) : questionBank.map(q => {
            const safeQ = { ...q };
            delete safeQ.correctOptionId;
            return safeQ;
          })
        }
      });
      broadcastSnapshot();
    }

    function endGame() {
      state = 'ended';
      Object.values(roster).forEach(p => {
        p.status = 'completed';
      });
      transport.send({
        type: 'gameEnded',
        roundId,
        payload: {
          leaderboard: computeLeaderboard(roster)
        }
      });
      broadcastSnapshot();
    }

    function resetNewRound() {
      roundId = 'round-' + Date.now().toString(36);
      state = 'waiting';
      evaluatedKeys.clear();
      Object.values(roster).forEach(p => {
        p.score = 0;
        p.progress = 0;
        p.correctCount = 0;
        p.wrongCount = 0;
        p.currentQuestionIndex = 0;
        p.status = 'ready';
      });
      broadcastSnapshot();
    }

    return Object.freeze({
      initRoom,
      startGame,
      endGame,
      resetNewRound,
      updateQuestionBank,
      addMockStudent,
      getSnapshot,
      broadcastSnapshot,
      getPerQuestionStats: () => ({ ...perQuestionStats }),
      getSecretAnswerKey: () => new Map(secretAnswerKey),
      getQuestionBank: () => [...questionBank],
      generateCsv: () => generateCsvReport(roomCode, roundId, computeLeaderboard(roster), questionBank.length)
    });
  }

  // ================= STUDENT CLIENT CONTROLLER ================= //
  function createStudentController({ transport, onStateReconciled }) {
    let roomCode = '';
    let currentPlayer = null;
    let currentRoundId = '';
    let lastRevision = 0;
    let latestSnapshot = null;

    function joinRoom(code, player) {
      roomCode = code.toUpperCase().trim();
      currentPlayer = { ...player };
      transport.join(roomCode, currentPlayer);

      // Listen for snapshots and results
      transport.onEvent(envelope => {
        if (envelope.roomCode !== roomCode) return;

        if (envelope.type === 'roomSnapshot') {
          reconcileRoomState(envelope.payload);
        } else if (envelope.type === 'gameStarted') {
          if (latestSnapshot) {
            latestSnapshot.state = 'playing';
            if (envelope.payload && envelope.payload.questions) {
              latestSnapshot.questions = envelope.payload.questions;
            }
            if (typeof onStateReconciled === 'function') onStateReconciled(latestSnapshot);
          }
        } else if (envelope.type === 'gameEnded') {
          if (latestSnapshot) {
            latestSnapshot.state = 'ended';
            if (typeof onStateReconciled === 'function') onStateReconciled(latestSnapshot);
          }
        }
      });

      // Announce arrival
      transport.send({
        type: 'playerJoin',
        payload: currentPlayer
      });

      // Request latest snapshot in case teacher is already open
      transport.send({
        type: 'requestSnapshot',
        payload: { playerId: currentPlayer.id }
      });
    }

    function reconcileRoomState(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      if (snapshot.roomCode !== roomCode) return;
      if (snapshot.revision <= lastRevision && snapshot.roundId === currentRoundId) return;

      lastRevision = snapshot.revision;
      currentRoundId = snapshot.roundId;
      latestSnapshot = snapshot;

      if (typeof onStateReconciled === 'function') {
        onStateReconciled(snapshot);
      }
    }

    function submitAnswerAttempt(questionId, answer, timeMs) {
      transport.send({
        type: 'answerAttempt',
        roundId: currentRoundId,
        payload: {
          questionId,
          answer,
          timeMs
        }
      });
    }

    return Object.freeze({
      joinRoom,
      reconcileRoomState,
      submitAnswerAttempt,
      getPlayer: () => currentPlayer,
      getRoomCode: () => roomCode,
      getSnapshot: () => latestSnapshot
    });
  }

  global.RoomController = Object.freeze({
    createTeacherController,
    createStudentController,
    computeLeaderboard,
    generateCsvReport
  });

})(typeof window !== 'undefined' ? window : this);
