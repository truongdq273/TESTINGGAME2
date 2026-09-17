/**
 * Multi-tab transport layer using BroadcastChannel (with localStorage fallback).
 * Follows strict room lifecycle & connection generation tokens from startup-reliability.md.
 */

(function (global) {
  'use strict';

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  function createTransport() {
    const handlers = new Set();
    const seenEventIds = new Set();
    const MAX_SEEN_EVENTS = 500;

    let currentRoomCode = null;
    let currentPlayer = null;
    let channel = null;
    let storageListener = null;
    let connectionGeneration = 0;

    function recordSeen(id) {
      if (!id) return;
      seenEventIds.add(id);
      if (seenEventIds.size > MAX_SEEN_EVENTS) {
        const first = seenEventIds.values().next().value;
        seenEventIds.delete(first);
      }
    }

    function dispatchToHandlers(envelope, generationAtArrival) {
      if (generationAtArrival !== connectionGeneration) return;
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.roomCode !== currentRoomCode) return;

      // Deduplicate
      if (envelope.eventId) {
        if (seenEventIds.has(envelope.eventId)) return;
        recordSeen(envelope.eventId);
      }

      // Filter recipient: null means broadcast; otherwise must match currentPlayer.id
      if (envelope.recipientId && currentPlayer && envelope.recipientId !== currentPlayer.id) {
        return;
      }

      handlers.forEach(h => {
        try {
          h(envelope);
        } catch (err) {
          console.error('[Transport] Handler error:', err);
        }
      });
    }

    function leave() {
      connectionGeneration++;
      currentRoomCode = null;
      currentPlayer = null;

      if (channel) {
        try {
          channel.close();
        } catch (e) {}
        channel = null;
      }

      if (storageListener) {
        try {
          global.removeEventListener('storage', storageListener);
        } catch (e) {}
        storageListener = null;
      }
      // Note: As specified in startup-reliability.md, DO NOT call handlers.clear() here!
    }

    function join(roomCode, player) {
      if (currentRoomCode || channel) {
        leave();
      }

      currentRoomCode = String(roomCode || '').toUpperCase().trim();
      currentPlayer = player ? Object.freeze({ ...player }) : null;
      const gen = connectionGeneration;
      const channelName = `classroom_game_room_${currentRoomCode}`;
      
      // Socket.IO Integration
      if (typeof global.io !== 'undefined' && !channel) {
        try {
          channel = global.io(); // Connect to same host
          channel.on('message', (envelope) => {
            dispatchToHandlers(envelope, gen);
          });
          channel.emit('join', { roomCode: currentRoomCode });
        } catch (e) {
          console.warn('[Transport] Socket.IO failed, falling back to BroadcastChannel:', e);
          channel = null;
        }
      }

      if (!channel && typeof BroadcastChannel !== 'undefined') {
        try {
          channel = new BroadcastChannel(channelName);
          channel.onmessage = (event) => {
            dispatchToHandlers(event.data, gen);
          };
        } catch (e) {
          console.warn('[Transport] BroadcastChannel failed, falling back to storage:', e);
          channel = null;
        }
      }

      // Storage event listener fallback
      storageListener = (e) => {
        if (e.key === channelName && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            dispatchToHandlers(data, gen);
          } catch (err) {
            console.error('[Transport] Storage parse error:', err);
          }
        }
      };
      global.addEventListener('storage', storageListener);
    }

    function send(event) {
      if (!currentRoomCode) {
        throw new Error('[Transport] Cannot send: not joined to any room');
      }

      const eventId = event.eventId || generateUUID();
      const envelope = Object.freeze({
        eventId,
        roomCode: currentRoomCode,
        roundId: event.roundId || 'round-1',
        senderId: (currentPlayer && currentPlayer.id) || event.senderId || 'anonymous',
        recipientId: event.recipientId || null,
        type: event.type,
        payload: event.payload !== undefined ? event.payload : null,
        timestamp: Date.now()
      });

      const gen = connectionGeneration;
      const channelName = `classroom_game_room_${currentRoomCode}`;
      if (channel) {
        try {
          if (typeof channel.emit === 'function') {
            channel.emit('message', envelope); // Socket.IO
          } else {
            channel.postMessage(envelope); // BroadcastChannel
          }
        } catch (e) {
          console.error('[Transport] channel send failed:', e);
        }
      }

      // Always update localStorage as fallback for tabs in different contexts/windows
      try {
        localStorage.setItem(channelName, JSON.stringify(envelope));
      } catch (e) {}

      // Self-dispatch to local handlers on the sending tab
      dispatchToHandlers(envelope, gen);
    }

    function onEvent(handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('[Transport] Expected a function handler');
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }

    return Object.freeze({
      join,
      send,
      onEvent,
      leave,
      getRoomCode: () => currentRoomCode,
      getPlayer: () => currentPlayer,
      getGeneration: () => connectionGeneration
    });
  }

  global.ClassroomTransport = Object.freeze({
    create: createTransport,
    generateUUID
  });

})(typeof window !== 'undefined' ? window : this);
