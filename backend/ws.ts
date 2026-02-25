import { WebSocketServer, WebSocket } from "ws";
import type http from "http";

let wss: WebSocketServer | null = null;

export function createWSServer(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws/pois" });

  wss.on("connection", (ws) => {
    console.log("[WS] Client connected");
    ws.on("close", () => console.log("[WS] Client disconnected"));
    ws.on("error", (err) => console.error("[WS] Error:", err.message));
  });

  return wss;
}

export function broadcastPoi(poi: any): void {
  if (!wss) return;
  const message = JSON.stringify({ type: "poi_update", poi, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function broadcastPoiBatch(pois: any[]): void {
  if (!wss) return;
  const message = JSON.stringify({ type: "poi_batch", pois, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function broadcastError(source: string, message: string): void {
  if (!wss) return;
  const payload = JSON.stringify({
    type: "backend_error",
    source,
    message,
    timestamp: Date.now(),
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getConnectedClients(): number {
  return wss?.clients.size || 0;
}
