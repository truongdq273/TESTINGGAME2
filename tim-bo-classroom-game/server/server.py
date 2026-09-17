"""
Edupia Classroom Games - Python WebSocket Relay Server
"Tìm Bò - Let's Save the Cows!" Production Server Bridge

Usage:
  pip install websockets
  python server.py
Default Port: 3000 (or PORT environment variable)
"""

import asyncio
import json
import os
import websockets

PORT = int(os.environ.get("PORT", 3000))

# rooms: roomCode -> dict(playerId -> dict(ws=websocket, player=data))
rooms = {}

async def broadcast_to_room(room_code, envelope, exclude_ws=None):
    room = rooms.get(room_code)
    if not room:
        return
    msg_str = json.dumps(envelope) if isinstance(envelope, dict) else envelope
    recipient_id = envelope.get("recipientId", "all") if isinstance(envelope, dict) else "all"

    for p_id, client in list(room.items()):
        ws = client["ws"]
        if ws != exclude_ws and not ws.closed:
            if recipient_id == "all" or recipient_id == p_id:
                try:
                    await ws.send(msg_str)
                except Exception as e:
                    print(f"[WS] Send error to {p_id}: {e}")

async def handler(websocket):
    client_room = None
    client_player_id = None

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except Exception:
                continue

            # 1. Join room
            if data.get("action") == "join" and "roomCode" in data:
                client_room = data["roomCode"].upper().strip()
                player = data.get("player") or {}
                client_player_id = player.get("id") or f"client_{os.urandom(3).hex()}"

                if client_room not in rooms:
                    rooms[client_room] = {}

                rooms[client_room][client_player_id] = {
                    "ws": websocket,
                    "player": player
                }
                print(f"[WS] '{client_player_id}' joined room '{client_room}' (Total: {len(rooms[client_room])})")
                continue

            # 2. Envelope routing
            if "roomCode" in data:
                target_room = data["roomCode"].upper().strip()
                await broadcast_to_room(target_room, data, exclude_ws=websocket)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if client_room and client_player_id and client_room in rooms:
            if client_player_id in rooms[client_room]:
                del rooms[client_room][client_player_id]
                print(f"[WS] '{client_player_id}' left room '{client_room}'")

                await broadcast_to_room(client_room, {
                    "type": "playerLeave",
                    "roomCode": client_room,
                    "senderId": client_player_id
                })

                if not rooms[client_room]:
                    del rooms[client_room]
                    print(f"[WS] Room '{client_room}' cleaned up.")

async def main():
    print("=" * 55)
    print(f"🚀 Edupia Python WebSocket Server running on port {PORT}")
    print(f"📡 Endpoint: ws://localhost:{PORT}")
    print("=" * 55)
    async with websockets.serve(handler, "0.0.0.0", PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
