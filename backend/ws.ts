import { WebSocketServer, WebSocket } from "ws";
import type http from "http";
import type { SessionManager } from "./session-manager";

let wss: WebSocketServer | null = null;
let mgr: SessionManager | null = null;

export function createWSServer(server: http.Server, sessionManager: SessionManager): WebSocketServer {
  mgr = sessionManager;
  wss = new WebSocketServer({ server, path: "/ws/pois" });

  wss.on("connection", async (ws) => {
    console.log("[WS] Client connected, creating session...");

    const session = await mgr!.create(ws);
    if (!session) {
      ws.send(JSON.stringify({ type: "session:error", message: "No accounts available" }));
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: "session:ready", sessionId: session.id }));
    console.log(`[WS] Session ${session.id} ready (account: ${session.account.username})`);

    // Error-reporting health check: confirm the error pipeline is alive every 2 min
    const healthInterval = setInterval(() => {
      session.sendMessage({
        type: "backend_error",
        source: "health-check",
        message: "Errors can be reported successfully",
        timestamp: Date.now(),
      });
    }, 2 * 60 * 1000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "trip:start": {
            const { lat, lng, speedKmh = 80, heading = 0 } = msg;
            if (lat == null || lng == null) {
              session.sendMessage({ type: "backend_error", source: "trip", message: "lat and lng required", timestamp: Date.now() });
              return;
            }
            session.startTrip(lat, lng, speedKmh, heading);
            session.sendMessage({ type: "trip:started", tripUuid: session.tripUuid });
            break;
          }
          case "trip:move": {
            const { lat, lng, speedKmh, heading } = msg;
            session.moveTrip(lat, lng, speedKmh, heading);
            break;
          }
          case "trip:stop": {
            session.stopTrip();
            session.sendMessage({ type: "trip:stopped" });
            break;
          }
          default:
            console.log(`[WS] Unknown message type: ${msg.type}`);
        }
      } catch (err: any) {
        console.error(`[WS] Message parse error: ${err.message}`);
      }
    });

    ws.on("close", () => {
      clearInterval(healthInterval);
      console.log(`[WS] Session ${session.id} disconnected`);
      mgr!.destroy(session.id);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Session ${session.id} error: ${err.message}`);
    });
  });

  return wss;
}

export function getConnectedClients(): number {
  return wss?.clients.size || 0;
}
