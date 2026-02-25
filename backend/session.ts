import type { WebSocket } from "ws";
import type { Account } from "./accounts";
import type { SapheGrpcClient, PoiData, StaticPoiData } from "./grpc-client";

const UPDATE_INTERVAL_MS = 60000;

export class Session {
  public id: string;
  public ws: WebSocket;
  public account: Account;
  public grpcClient: SapheGrpcClient;
  public tripUuid: string | null = null;

  private tripInterval: ReturnType<typeof setInterval> | null = null;
  private lat = 0;
  private lng = 0;
  private speed = 0;
  private heading = 0;

  // Tile queue per session
  private tileQueue: string[] = [];
  private tileProcessing = false;

  constructor(id: string, ws: WebSocket, account: Account, grpcClient: SapheGrpcClient) {
    this.id = id;
    this.ws = ws;
    this.account = account;
    this.grpcClient = grpcClient;

    // Wire POI callbacks to this session's WS only
    this.grpcClient.onPoiUpdate = (poi: PoiData) => {
      console.log(`[Session ${this.id}] POI ${poi.state} ${poi.type} at ${poi.latitude?.toFixed(5)}, ${poi.longitude?.toFixed(5)}`);
      this.sendMessage({ type: "poi_update", poi, timestamp: Date.now() });
    };

    this.grpcClient.onTileVersion = (tile: { id: string; version: number }) => {
      if (!this.tileQueue.includes(tile.id)) {
        this.tileQueue.push(tile.id);
      }
      this.processTileQueue();
    };

    this.grpcClient.onError = (err: Error) => {
      console.error(`[Session ${this.id}] gRPC error: ${err.message}`);
      this.sendMessage({ type: "backend_error", source: "grpc", message: err.message, timestamp: Date.now() });
    };
  }

  startTrip(lat: number, lng: number, speedKmh: number, headingDeg: number): void {
    this.stopTrip();

    this.lat = lat;
    this.lng = lng;
    this.speed = speedKmh / 3.6;
    this.heading = headingDeg;
    this.tripUuid = crypto.randomUUID();

    this.grpcClient.startTrip(this.lat, this.lng, this.speed, this.heading);

    this.tripInterval = setInterval(() => {
      if (this.tripUuid) {
        this.grpcClient.sendLocationUpdate(this.tripUuid, this.lat, this.lng, this.speed, this.heading);
      }
    }, UPDATE_INTERVAL_MS);
  }

  moveTrip(lat: number, lng: number, speedKmh?: number, headingDeg?: number): void {
    if (!this.tripUuid) return;

    this.lat = lat;
    this.lng = lng;
    if (speedKmh != null) this.speed = speedKmh / 3.6;
    if (headingDeg != null) this.heading = headingDeg;

    this.grpcClient.sendLocationUpdate(this.tripUuid, this.lat, this.lng, this.speed, this.heading);
  }

  stopTrip(): void {
    if (this.tripInterval) {
      clearInterval(this.tripInterval);
      this.tripInterval = null;
    }
    this.grpcClient.stopTrip();
    this.tripUuid = null;
  }

  cleanup(): void {
    this.stopTrip();
    this.grpcClient.close();
  }

  sendMessage(msg: any): void {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async processTileQueue(): Promise<void> {
    if (this.tileProcessing || this.tileQueue.length === 0) return;
    this.tileProcessing = true;

    while (this.tileQueue.length > 0) {
      const tileId = this.tileQueue.shift()!;
      try {
        const result = await this.grpcClient.getTile(tileId);
        if (result.staticPois.length > 0) {
          this.sendMessage({ type: "poi_batch", pois: result.staticPois, timestamp: Date.now() });
        }
      } catch (err: any) {
        console.warn(`[Session ${this.id}] Tile ${tileId} failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    this.tileProcessing = false;
  }
}
