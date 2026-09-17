/**
 * Transport layer for "Tìm Bò - Let's Save the Cows!"
 * Dual-Mode Architecture:
 * 1. Local Mode (Default): BroadcastChannel + localStorage fallback for zero-config multi-tab demo.
 * 2. WebSocket Mode (Production): Connects to real IT WebSocket server when GAME_WS_URL or ?ws= is configured.
 * 
 * Implements strict room isolation, recipient filtering, event deduplication, and host authentication tokens.
 */
(function (global) {
  'use strict';

  function createTransport(options = {}) {
    let currentRoom = null;
    let currentPlayer = null;
    let channel = null;
    let ws = null;
    let wsReconnectTimer = null;
    let isWsMode = false;
    let hostToken = null;

    const handlers = new Set();
    const seenEventIds = new Set();
    const MAX_SEEN_IDS = 1000;

    // Detect if WebSocket server is configured
    const urlParams = typeof global.location !== 'undefined' ? new URLSearchParams(global.location.search) : null;
    const wsUrlParam = urlParams ? urlParams.get('ws') : null;
    const configuredWsUrl = options.wsUrl || global.GAME_WS_URL || wsUrlParam;

    function dedupe(eventId) {
      if (!eventId) return false;
      if (seenEventIds.has(eventId)) return true;
      seenEventIds.add(eventId);
      if (seenEventIds.size > MAX_SEEN_IDS) {
        const first = seenEventIds.values().next().value;
        seenEventIds.delete(first);
      }
      return false;
    }

    function dispatch(envelope) {
      if (!envelope || typeof envelope !== 'object') return;
      if (envelope.roomCode !== currentRoom) return;
      if (dedupe(envelope.eventId)) return;

      // Filter recipient if specified
      if (envelope.recipientId && currentPlayer) {
        if (envelope.recipientId !== currentPlayer.id && envelope.recipientId !== 'all') {
          return;
        }
      }

      handlers.forEach(h => {
        try {
          h(envelope);
        } catch (err) {
          console.error('[Transport] Handler error:', err);
        }
      });
    }

    // -------------------------------------------------------------
    // LOCAL TRANSPORT (BroadcastChannel + localStorage)
    // -------------------------------------------------------------
    function onStorageEvent(e) {
      if (!currentRoom || isWsMode) return;
      const keyPrefix = `TIM_BO_EVENT_${currentRoom}_`;
      if (e.key && e.key.startsWith(keyPrefix) && e.newValue) {
        try {
          const envelope = JSON.parse(e.newValue);
          dispatch(envelope);
        } catch (err) {
          console.error('[Transport] Storage parse error:', err);
        }
      }
    }

    function initLocalChannel() {
      const channelName = `TIM_BO_ROOM_${currentRoom}`;
      if (typeof global.BroadcastChannel === 'function') {
        channel = new global.BroadcastChannel(channelName);
        channel.onmessage = (e) => {
          dispatch(e.data);
        };
      }
      global.addEventListener('storage', onStorageEvent);
    }

    // -------------------------------------------------------------
    // WEBSOCKET TRANSPORT (Production Server Mode)
    // -------------------------------------------------------------
    function initWebSocket(wsUrl) {
      isWsMode = true;
      try {
        console.log('[Transport] Connecting to WebSocket server:', wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[Transport] WebSocket connected successfully');
          // Gửi bản tin đăng ký tham gia phòng lên máy chủ
          ws.send(JSON.stringify({
            action: 'join',
            roomCode: currentRoom,
            player: currentPlayer,
            hostToken: hostToken
          }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.roomCode === currentRoom) {
              dispatch(data);
            }
          } catch (e) {
            console.error('[Transport] Failed to parse WebSocket message:', e);
          }
        };

        ws.onclose = () => {
          console.warn('[Transport] WebSocket closed. Auto-reconnecting in 2s...');
          if (currentRoom) {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = setTimeout(() => {
              if (currentRoom && isWsMode) {
                initWebSocket(wsUrl);
              }
            }, 2000);
          }
        };

        ws.onerror = (err) => {
          console.error('[Transport] WebSocket error:', err);
        };
      } catch (err) {
        console.error('[Transport] Could not initialize WebSocket:', err);
        // Fallback về chế độ local nếu kết nối thất bại
        isWsMode = false;
        initLocalChannel();
      }
    }

    function join(roomCode, player, joinOptions = {}) {
      if (!roomCode || typeof roomCode !== 'string') throw new TypeError('Invalid roomCode');
      if (!player || !player.id) throw new TypeError('Invalid player');

      leave();
      currentRoom = roomCode.toUpperCase().trim();
      currentPlayer = { ...player };
      if (joinOptions.hostToken) {
        hostToken = joinOptions.hostToken;
      }

      if (configuredWsUrl) {
        initWebSocket(configuredWsUrl);
      } else {
        initLocalChannel();
      }

      return { roomCode: currentRoom, playerId: currentPlayer.id, isWsMode };
    }

    function send(type, payload, sendOptions = {}) {
      if (!currentRoom) throw new Error('Cannot send: not joined to any room');

      const envelope = {
        eventId: 'evt_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
        roomCode: currentRoom,
        roundId: sendOptions.roundId || null,
        senderId: currentPlayer ? currentPlayer.id : 'unknown',
        recipientId: sendOptions.recipientId || 'all',
        type: type,
        payload: payload,
        meta: {
          hostToken: sendOptions.hostToken || hostToken || null,
          timestamp: Date.now()
        }
      };

      // Record own event id so we don't process it twice if echoed
      seenEventIds.add(envelope.eventId);

      // 1. Send via WebSocket if in WS mode
      if (isWsMode && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(envelope));
        } catch (err) {
          console.warn('[Transport] ws.send failed:', err);
        }
      }

      // 2. Broadcast via BroadcastChannel in local mode
      if (channel) {
        try {
          channel.postMessage(envelope);
        } catch (e) {
          console.warn('[Transport] channel.postMessage failed:', e);
        }
      }

      // 3. Fallback via localStorage for cross-tab storage event
      if (!isWsMode) {
        try {
          const storageKey = `TIM_BO_EVENT_${currentRoom}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
          localStorage.setItem(storageKey, JSON.stringify(envelope));
          setTimeout(() => {
            try { localStorage.removeItem(storageKey); } catch {}
          }, 3000);
        } catch (err) {
          console.warn('[Transport] localStorage setItem failed:', err);
        }
      }

      // 4. Local dispatch for same-tab listeners
      if (envelope.recipientId === 'all' || (currentPlayer && envelope.recipientId === currentPlayer.id)) {
        handlers.forEach(h => {
          try {
            h(envelope);
          } catch (err) {
            console.error('[Transport] Local handler error:', err);
          }
        });
      }

      return envelope;
    }

    function onEvent(handler) {
      if (typeof handler !== 'function') throw new TypeError('Handler must be a function');
      handlers.add(handler);
      return () => handlers.delete(handler);
    }

    function leave() {
      clearTimeout(wsReconnectTimer);
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
      if (channel) {
        try { channel.close(); } catch {}
        channel = null;
      }
      global.removeEventListener('storage', onStorageEvent);
      // DO NOT clear handlers here! Handlers are application callbacks that stay active across joins.
      seenEventIds.clear();
      currentRoom = null;
      currentPlayer = null;
      isWsMode = false;
      hostToken = null;
    }

    function destroy() {
      leave();
      handlers.clear();
    }

    return Object.freeze({
      join,
      send,
      onEvent,
      leave,
      destroy,
      getRoomCode: () => currentRoom,
      getPlayer: () => currentPlayer ? { ...currentPlayer } : null,
      isWebSocketMode: () => isWsMode,
      setHostToken: (t) => { hostToken = t; }
    });
  }

  global.RoomTransport = Object.freeze({
    create: createTransport
  });
})(typeof window !== 'undefined' ? window : this);