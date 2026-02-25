import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { TokenResponse } from "./auth";

const GATEWAY_HOST = "gateway.saphe.com";
const GATEWAY_PORT = 13377;
const PROTO_DIR = path.join(import.meta.dir, "..", "proto");

// POI type hex codes to human-readable names
export const POI_TYPE_NAMES: Record<number, string> = {
  0x000000: "Unknown",
  0x010000: "Law Enforcement",
  0x010100: "Camera",
  0x010101: "Mobile Speed Camera",
  0x010102: "Fixed Speed Camera",
  0x010103: "Average Speed Camera",
  0x010104: "Red Light Camera",
  0x010105: "Speed & Red Light Camera",
  0x010106: "Helicopter Speed Camera",
  0x010107: "Distance Control Camera",
  0x010200: "Spot Check",
  0x020000: "Danger",
  0x020100: "Car On Shoulder",
  0x020200: "Accident",
  0x020300: "Animal Nearby",
  0x020400: "School Road",
  0x020500: "Emergency Vehicle",
  0x030000: "Delay",
  0x030101: "Congestion",
  0x030202: "Roadworks",
};

function getPoiTypeName(typeValue: number): string {
  return POI_TYPE_NAMES[typeValue] || `Unknown (0x${typeValue.toString(16)})`;
}

function loadProto() {
  const packageDef = protoLoader.loadSync(
    [
      path.join(PROTO_DIR, "TripService.proto"),
      path.join(PROTO_DIR, "AppService.proto"),
    ],
    {
      keepCase: true,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    }
  );
  return grpc.loadPackageDefinition(packageDef);
}

function createMetadata(
  accessToken: string,
  appInstallationId: string
): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.set("authorization", `Bearer ${accessToken}`);
  metadata.set("appInstallationId", appInstallationId);
  metadata.set("appVersion", "6.2.1");
  metadata.set("clientPlatform", "Android");
  metadata.set("osVersion", "14");
  metadata.set("traceId", uuidv4());
  metadata.set("deviceSerialNumber", "");
  metadata.set("deviceModelNumber", "");
  return metadata;
}

export interface PoiData {
  id: string;
  type: string;
  typeCode: number;
  state: string;
  latitude?: number;
  longitude?: number;
  speedLimitKmh?: number;
  roadName?: string;
  city?: string;
  countryCode?: string;
  geometry?: any;
  isTest: boolean;
  version: number;
  hash: number;
}

export interface StaticPoiData {
  id: string;
  type: string;
  typeCode: number;
  latitude?: number;
  longitude?: number;
  geometry?: any;
  isTest: boolean;
}

const POI_CLIENT_STATE_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "Pending",
  2: "Active",
  3: "Deleted",
  4: "OutOfRange",
};

function extractLocation(geometry: any): {
  latitude?: number;
  longitude?: number;
} {
  if (!geometry) return {};

  const geo = geometry.value || geometry;

  if (geo.pointPoiGeometry?.location) {
    return {
      latitude: geo.pointPoiGeometry.location.latitude,
      longitude: geo.pointPoiGeometry.location.longitude,
    };
  }
  if (geo.circularPoiGeometry?.center) {
    return {
      latitude: geo.circularPoiGeometry.center.latitude,
      longitude: geo.circularPoiGeometry.center.longitude,
    };
  }
  if (
    geo.lineStringPoiGeometry?.lineString?.length &&
    geo.lineStringPoiGeometry.lineString.length > 0
  ) {
    const first = geo.lineStringPoiGeometry.lineString[0];
    return { latitude: first.latitude, longitude: first.longitude };
  }
  if (geo.polygonalPoiGeometry?.centroid) {
    return {
      latitude: geo.polygonalPoiGeometry.centroid.latitude,
      longitude: geo.polygonalPoiGeometry.centroid.longitude,
    };
  }
  if (geo.encodedPolylinePoiGeometry?.encodedPolyline) {
    // Would need to decode the polyline - return raw for now
    return {};
  }
  return {};
}

function parsePoiUpdate(poiUpdate: any): PoiData {
  const typeVal = poiUpdate.type?.value ?? 0;
  const stateVal = poiUpdate.clientState?.value ?? 0;
  const loc = extractLocation(poiUpdate.geometry);
  const speedLimitMs = poiUpdate.speedLimit?.value?.value;

  return {
    id: poiUpdate.newId || String(poiUpdate.id),
    type: getPoiTypeName(typeVal),
    typeCode: typeVal,
    state: POI_CLIENT_STATE_NAMES[stateVal] || `Unknown(${stateVal})`,
    latitude: loc.latitude,
    longitude: loc.longitude,
    speedLimitKmh: speedLimitMs ? Math.round(speedLimitMs * 3.6) : undefined,
    roadName: poiUpdate.roadName?.value,
    city: poiUpdate.city?.value,
    countryCode: poiUpdate.countryCode?.value,
    geometry: poiUpdate.geometry,
    isTest: poiUpdate.isTest || false,
    version: poiUpdate.version,
    hash: poiUpdate.hash,
  };
}

function parseStaticPoi(staticPoi: any): StaticPoiData {
  const typeVal = staticPoi.poiType ?? 0;
  const loc = extractLocation(staticPoi.geometry);

  return {
    id: staticPoi.id,
    type: getPoiTypeName(typeVal),
    typeCode: typeVal,
    latitude: loc.latitude,
    longitude: loc.longitude,
    geometry: staticPoi.geometry,
    isTest: staticPoi.isTest || false,
  };
}

export class SapheGrpcClient {
  private proto: any;
  private channel: grpc.ChannelCredentials;
  private tripStub: any;
  private appStub: any;
  private accessToken: string;
  private appInstallationId: string;
  private tripStream: any = null;

  // Collected POIs
  public dynamicPois: Map<string, PoiData> = new Map();
  public staticPois: Map<string, StaticPoiData> = new Map();

  // Callbacks
  public onPoiUpdate?: (poi: PoiData) => void;
  public onStaticPoi?: (poi: StaticPoiData) => void;
  public onTileVersion?: (tile: { id: string; version: number }) => void;
  public onConfig?: (config: any) => void;
  public onError?: (error: Error) => void;

  constructor(accessToken: string, appInstallationId: string) {
    this.accessToken = accessToken;
    this.appInstallationId = appInstallationId;
    this.proto = loadProto();
    this.channel = grpc.credentials.createSsl();

    const saphe = (this.proto as any).saphe.protobuf;
    const address = `${GATEWAY_HOST}:${GATEWAY_PORT}`;

    this.tripStub = new saphe.TripService(address, this.channel);
    this.appStub = new saphe.AppService(address, this.channel);
  }

  updateToken(accessToken: string) {
    this.accessToken = accessToken;
  }

  private getMetadata(): grpc.Metadata {
    return createMetadata(this.accessToken, this.appInstallationId);
  }

  async validateAppInstallation(): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = {
        appInstallationUuid: this.appInstallationId,
        app: {
          name: "Saphe Link",
          osFamily: 1, // Android
          version: {
            semanticVersion: { major: 6, minor: 2, patch: 1 },
            build: 621,
          },
          releaseType: 1, // Production
        },
        mobileDevice: {
          identifier: uuidv4(),
          displayName: "Pixel 7",
          model: { name: "Pixel 7", manufacturerName: "Google" },
          os: { family: 1, version: "14" },
          language: "en",
          country: "SE",
        },
      };

      // ValidateAppInstallation does NOT require auth
      const metadata = new grpc.Metadata();
      metadata.set("appInstallationId", this.appInstallationId);
      metadata.set("appVersion", "6.2.1");
      metadata.set("clientPlatform", "Android");
      metadata.set("osVersion", "14");
      metadata.set("traceId", uuidv4());

      this.appStub.ValidateAppInstallation(
        request,
        metadata,
        (err: any, response: any) => {
          if (err) reject(err);
          else resolve(response);
        }
      );
    });
  }

  startTrip(
    latitude: number,
    longitude: number,
    speedMs: number = 0,
    headingDeg: number = 0
  ): void {
    const tripUuid = uuidv4();
    const metadata = this.getMetadata();

    this.tripStream = this.tripStub.Update(metadata);

    this.tripStream.on("data", (response: any) => {
      const responseType = response.response;

      if (responseType === "poiUpdate" && response.poiUpdate) {
        const poi = parsePoiUpdate(response.poiUpdate);
        if (poi.state === "Deleted") {
          this.dynamicPois.delete(poi.id);
        } else {
          this.dynamicPois.set(poi.id, poi);
        }
        this.onPoiUpdate?.(poi);
      } else if (
        responseType === "relevantTileVersion" &&
        response.relevantTileVersion
      ) {
        const tile = {
          id: response.relevantTileVersion.id,
          version: response.relevantTileVersion.version,
        };
        this.onTileVersion?.(tile);
      } else if (
        responseType === "poiUpdateChecksum" &&
        response.poiUpdateChecksum
      ) {
        // Checksum verification - could validate POI integrity
      } else if (
        responseType === "tripConfigurationDto" &&
        response.tripConfigurationDto
      ) {
        this.onConfig?.(response.tripConfigurationDto);
      }
    });

    this.tripStream.on("error", (err: any) => {
      this.onError?.(err);
    });

    this.tripStream.on("end", () => {
      console.log("[gRPC] Trip stream ended");
    });

    // Send initial location update
    this.sendLocationUpdate(
      tripUuid,
      latitude,
      longitude,
      speedMs,
      headingDeg
    );
  }

  sendLocationUpdate(
    tripUuid: string,
    latitude: number,
    longitude: number,
    speedMs: number = 0,
    headingDeg: number = 0
  ): void {
    if (!this.tripStream) {
      throw new Error("Trip stream not started. Call startTrip() first.");
    }

    const request = {
      locationInfo: {
        location: { longitude, latitude },
        timestamp: {
          seconds: Math.floor(Date.now() / 1000).toString(),
          nanos: 0,
        },
        speed: { value: speedMs },
        heading: { value: headingDeg },
        locationAccuracy: { value: 10.0 },
      },
      tripUuid,
      devices: [],
      roadSegmentId: "",
      driveType: 2, // DriveTypeUnknown
    };

    this.tripStream.write(request);
  }

  async getTile(tileId: string): Promise<{
    metadata?: any;
    ways: any[];
    staticPois: StaticPoiData[];
  }> {
    return new Promise((resolve, reject) => {
      const metadata = this.getMetadata();
      const request = { tileId };
      const ways: any[] = [];
      const pois: StaticPoiData[] = [];
      let tileMeta: any;

      const stream = this.tripStub.GetTile(request, metadata);

      stream.on("data", (response: any) => {
        const type = response.response;
        if (type === "tileMetaData" && response.tileMetaData) {
          tileMeta = response.tileMetaData;
        } else if (type === "tileElement" && response.tileElement) {
          const elem = response.tileElement;
          if (elem.value === "way" && elem.way) {
            ways.push(elem.way);
          } else if (elem.value === "staticPoi" && elem.staticPoi) {
            const poi = parseStaticPoi(elem.staticPoi);
            pois.push(poi);
            this.staticPois.set(poi.id, poi);
            this.onStaticPoi?.(poi);
          }
        }
      });

      stream.on("error", (err: any) => reject(err));
      stream.on("end", () =>
        resolve({ metadata: tileMeta, ways, staticPois: pois })
      );
    });
  }

  stopTrip(): void {
    if (this.tripStream) {
      this.tripStream.end();
      this.tripStream = null;
    }
  }

  close(): void {
    this.stopTrip();
    this.tripStub?.close?.();
    this.appStub?.close?.();
  }

  getAllPois(): {
    dynamic: PoiData[];
    static: StaticPoiData[];
  } {
    return {
      dynamic: Array.from(this.dynamicPois.values()),
      static: Array.from(this.staticPois.values()),
    };
  }
}
