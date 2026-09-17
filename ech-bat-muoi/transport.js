/**
 * Classroom Game WebSocket Transport
 * Provides reliable envelope delivery using WebSockets connected to our backend relay server.
 */
(function (global) {
  'use strict';

  function createTransport() {
    const handlers = new Set();
    const seenEventIds = new Set();
    const MAX_SEEN = 300;

    let currentRoomCode = null;
    let currentPlayer = null;
    let socket = null;
    let generation = 0;

    function recordEventId(eventId) {
      if (!eventId) return false;
      if (seenEventIds.has(eventId)) return true;
      seenEventIds.add(eventId);
      if (seenEventIds.size > MAX_SEEN) {
        const first = seenEventIds.values().next().value;
        seenEventIds.delete(first);
      }
      return false;
    }

    function dispatch(envelope) {
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.roomCode !== currentRoomCode) return;
      if (recordEventId(envelope.eventId)) return; // duplicate

      // If private message, check recipient
      if (envelope.recipientId && currentPlayer && envelope.recipientId !== currentPlayer.id) {
        return;
      }

      handlers.forEach(h => {
        try {
          h(envelope);
        } catch (err) {
          console.error('[Transport handler error]', err);
        }
      });
    }

    function connectWebSocket(roomCode, player, gen) {
      // Xác định protocol và host phù hợp với giao diện hiện tại
      const protocol = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = global.location.host;
      const wsUrl = `${protocol}//${host}`;

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (generation !== gen) {
          socket.close();
          return;
        }
        // Notify server that we joined a room
        socket.send(JSON.stringify({
          type: 'transport:join',
          roomCode: roomCode,
          senderId: player ? player.id : 'anonymous'
        }));
      };

      socket.onmessage = (e) => {
        if (generation !== gen) return;
        try {
          const envelope = JSON.parse(e.data);
          dispatch(envelope);
        } catch (err) {
          console.error('[Transport] Invalid incoming message');
        }
      };

      socket.onclose = () => {
        if (generation === gen) {
          console.warn('[Transport] Disconnected from server. Trying to reconnect in 3s...');
          setTimeout(() => {
            if (generation === gen) {
              connectWebSocket(roomCode, player, gen);
            }
          }, 3000);
        }
      };
    }

    return Object.freeze({
      join(roomCode, player) {
        if (!roomCode) throw new TypeError('roomCode is required');
        this.leave();

        generation++;
        const currentGen = generation;
        currentRoomCode = String(roomCode).toUpperCase();
        currentPlayer = player ? { ...player } : null;

        connectWebSocket(currentRoomCode, currentPlayer, currentGen);

        return currentGen;
      },

      send(event) {
        if (!currentRoomCode) throw new Error('Cannot send without joining a room');
        const envelope = {
          eventId: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
          roomCode: currentRoomCode,
          roundId: event.roundId || null,
          senderId: currentPlayer ? currentPlayer.id : 'anonymous',
          recipientId: event.recipientId || null,
          type: event.type,
          payload: event.payload || {},
          sentAt: Date.now()
        };

        // Record locally to prevent self-loop dedupe (if server bounces it back, though our server doesn't send back to sender)
        recordEventId(envelope.eventId);

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(envelope));
        } else {
          console.warn('[Transport] WebSocket is not open. Message lost.');
          // In a production app, you might queue messages here
        }

        return envelope.eventId;
      },

      onEvent(handler) {
        if (typeof handler !== 'function') throw new TypeError('Handler must be a function');
        handlers.add(handler);
        return () => handlers.delete(handler);
      },

      leave() {
        generation++;
        if (socket) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'transport:leave', roomCode: currentRoomCode }));
          }
          socket.close();
          socket = null;
        }
        currentRoomCode = null;
        currentPlayer = null;
        // NOTE: handlers.clear() is deliberately NOT called per startup-reliability.md
      },

      get currentRoom() {
        return currentRoomCode;
      },

      get player() {
        return currentPlayer ? { ...currentPlayer } : null;
      }
    });
  }

  global.ClassroomTransport = Object.freeze({
    create: createTransport
  });
})(window);
