import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const GATEWAY_HOST = "gateway.saphe.com";
const GATEWAY_PORT = 13377;
const PROTO_DIR = path.join(import.meta.dir, "..", "proto");

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

const proto = loadProto();
const saphe = (proto as any).saphe.protobuf;
const creds = grpc.credentials.createSsl();
const address = `${GATEWAY_HOST}:${GATEWAY_PORT}`;

const tripStub = new saphe.TripService(address, creds);
const appStub = new saphe.AppService(address, creds);

const appInstallationId = uuidv4();

function makeMetadata(token?: string): grpc.Metadata {
  const md = new grpc.Metadata();
  if (token) md.set("authorization", `Bearer ${token}`);
  md.set("appInstallationId", appInstallationId);
  md.set("appVersion", "6.2.1");
  md.set("clientPlatform", "Android");
  md.set("osVersion", "14");
  md.set("traceId", uuidv4());
  md.set("deviceSerialNumber", "");
  md.set("deviceModelNumber", "");
  return md;
}

// ============ Test 1: ValidateAppInstallation (no auth) ============
async function testValidateApp() {
  console.log("\n========================================");
  console.log("TEST 1: ValidateAppInstallation (no auth)");
  console.log("========================================");

  return new Promise<void>((resolve) => {
    const request = {
      appInstallationUuid: appInstallationId,
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

    appStub.ValidateAppInstallation(
      request,
      makeMetadata(),
      (err: any, response: any) => {
        if (err) {
          console.log("ERROR:", err.code, err.details);
        } else {
          console.log("SUCCESS! Response:");
          console.log(JSON.stringify(response, null, 2));
        }
        resolve();
      }
    );
  });
}

// ============ Test 2: TripService.Update WITHOUT auth ============
async function testTripUpdateNoAuth() {
  console.log("\n========================================");
  console.log("TEST 2: TripService.Update (NO auth)");
  console.log("========================================");

  return new Promise<void>((resolve) => {
    const metadata = makeMetadata(); // no token
    const stream = tripStub.Update(metadata);
    let gotResponse = false;

    const timeout = setTimeout(() => {
      if (!gotResponse) {
        console.log("TIMEOUT: No response after 8s");
        stream.cancel();
        resolve();
      }
    }, 8000);

    stream.on("data", (response: any) => {
      gotResponse = true;
      console.log("GOT DATA (no auth!):", JSON.stringify(response, null, 2).slice(0, 500));
    });

    stream.on("error", (err: any) => {
      gotResponse = true;
      clearTimeout(timeout);
      console.log("ERROR:", err.code, "-", err.details);
      resolve();
    });

    stream.on("end", () => {
      clearTimeout(timeout);
      if (!gotResponse) console.log("Stream ended with no data");
      resolve();
    });

    // Send a location update (Malmö, Sweden - Saphe is Swedish/Danish)
    const request = {
      locationInfo: {
        location: { longitude: 13.0038, latitude: 55.605 },
        timestamp: { seconds: String(Math.floor(Date.now() / 1000)), nanos: 0 },
        speed: { value: 22.2 }, // ~80 km/h
        heading: { value: 45.0 },
        locationAccuracy: { value: 10.0 },
      },
      tripUuid: uuidv4(),
      devices: [],
      roadSegmentId: "",
      driveType: 2,
    };

    console.log("Sending location: 55.605, 13.0038 (Malmö)...");
    stream.write(request);
  });
}

// ============ Test 3: TripService.Update with fake token ============
async function testTripUpdateFakeToken() {
  console.log("\n========================================");
  console.log("TEST 3: TripService.Update (fake token)");
  console.log("========================================");

  return new Promise<void>((resolve) => {
    const metadata = makeMetadata("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake.token");
    const stream = tripStub.Update(metadata);
    let gotResponse = false;

    const timeout = setTimeout(() => {
      if (!gotResponse) {
        console.log("TIMEOUT: No response after 8s");
        stream.cancel();
        resolve();
      }
    }, 8000);

    stream.on("data", (response: any) => {
      gotResponse = true;
      console.log("GOT DATA (fake token!):", JSON.stringify(response, null, 2).slice(0, 500));
    });

    stream.on("error", (err: any) => {
      gotResponse = true;
      clearTimeout(timeout);
      console.log("ERROR:", err.code, "-", err.details);
      resolve();
    });

    stream.on("end", () => {
      clearTimeout(timeout);
      resolve();
    });

    const request = {
      locationInfo: {
        location: { longitude: 13.0038, latitude: 55.605 },
        timestamp: { seconds: String(Math.floor(Date.now() / 1000)), nanos: 0 },
        speed: { value: 22.2 },
        heading: { value: 45.0 },
        locationAccuracy: { value: 10.0 },
      },
      tripUuid: uuidv4(),
      devices: [],
      roadSegmentId: "",
      driveType: 2,
    };

    console.log("Sending location with fake token...");
    stream.write(request);
  });
}

// ============ Test 4: GetTile without auth ============
async function testGetTileNoAuth() {
  console.log("\n========================================");
  console.log("TEST 4: TripService.GetTile (no auth)");
  console.log("========================================");

  return new Promise<void>((resolve) => {
    const metadata = makeMetadata(); // no token

    // Try some common tile ID formats
    const tileId = "55_13"; // lat_lng based guess
    console.log("Requesting tile:", tileId);

    const stream = tripStub.GetTile({ tileId }, metadata);
    let gotResponse = false;

    const timeout = setTimeout(() => {
      if (!gotResponse) {
        console.log("TIMEOUT: No response after 8s");
        stream.cancel();
        resolve();
      }
    }, 8000);

    stream.on("data", (response: any) => {
      gotResponse = true;
      console.log("GOT DATA:", JSON.stringify(response, null, 2).slice(0, 500));
    });

    stream.on("error", (err: any) => {
      gotResponse = true;
      clearTimeout(timeout);
      console.log("ERROR:", err.code, "-", err.details);
      resolve();
    });

    stream.on("end", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

// ============ Test 5: Check OIDC discovery endpoint ============
async function testOIDCDiscovery() {
  console.log("\n========================================");
  console.log("TEST 5: OIDC Discovery Endpoint");
  console.log("========================================");

  try {
    const res = await fetch("https://auth-gateway.saphe.com/.well-known/openid-configuration");
    console.log("Status:", res.status);
    if (res.ok) {
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log("Response:", await res.text().then(t => t.slice(0, 500)));
    }
  } catch (e: any) {
    console.log("ERROR:", e.message);
  }
}

// ============ Test 6: Try creating anonymous account via REST ============
async function testAnonymousAccount() {
  console.log("\n========================================");
  console.log("TEST 6: Anonymous account attempts");
  console.log("========================================");

  // Try client_credentials grant
  console.log("\n--- client_credentials grant ---");
  try {
    const res = await fetch("https://auth-gateway.saphe.com/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "android",
        grant_type: "client_credentials",
        scope: "openid profile app_gateway",
      }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.slice(0, 500));
  } catch (e: any) {
    console.log("ERROR:", e.message);
  }

  // Try device_code grant
  console.log("\n--- device authorization ---");
  try {
    const res = await fetch("https://auth-gateway.saphe.com/connect/deviceauthorization", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "android",
        scope: "openid profile app_gateway offline_access",
      }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.slice(0, 500));
  } catch (e: any) {
    console.log("ERROR:", e.message);
  }

  // Try register endpoint without data
  console.log("\n--- register user (empty) ---");
  try {
    const res = await fetch("https://auth-gateway.saphe.com/api/NativeAccount/RegisterUserAsync", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "android",
        Email: "",
      }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.slice(0, 500));
  } catch (e: any) {
    console.log("ERROR:", e.message);
  }
}

// ============ Run all tests ============
async function main() {
  console.log("Saphe Link API Probe");
  console.log("====================");
  console.log("App Installation ID:", appInstallationId);

  await testOIDCDiscovery();
  await testValidateApp();
  await testTripUpdateNoAuth();
  await testTripUpdateFakeToken();
  await testGetTileNoAuth();
  await testAnonymousAccount();

  console.log("\n\n========================================");
  console.log("ALL TESTS COMPLETE");
  console.log("========================================");

  process.exit(0);
}

main().catch(console.error);
