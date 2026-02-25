# Phase 5: Expo App — POI Radar + Alerts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add live Saphe POI radar to the navigation app — WebSocket connection to backend, POI markers on map, distance-based alerts with fullscreen overlay, sound, and vibration. Auto-dismiss when POI is behind the user.

**Architecture:** App connects to saphe backend via WebSocket. Receives POI positions. Calculates distance locally using haversine. Triggers alert thresholds. Fullscreen overlay component with countdown.

**Tech Stack:** Expo (expo-haptics, expo-av, expo-notifications), WebSocket, react-native-maps

---

### Task 1: Implement POI distance and alert logic with tests

**Files:**
- Create: `app/src/poi-radar.ts`
- Create: `app/src/poi-radar.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { haversineDistance, bearingBetween, isPoiBehind, getAlertLevel, type AlertLevel } from "./poi-radar";

describe("haversineDistance", () => {
  test("~111km for 1 degree latitude", () => {
    const d = haversineDistance(56.0, 9.0, 57.0, 9.0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("bearingBetween", () => {
  test("north is ~0", () => {
    const b = bearingBetween(56.0, 9.0, 56.1, 9.0);
    expect(Math.abs(b)).toBeLessThan(2);
  });
});

describe("isPoiBehind", () => {
  test("POI ahead returns false", () => {
    // User heading north (0°), POI is north
    expect(isPoiBehind(56.0, 9.0, 0, 56.1, 9.0)).toBe(false);
  });

  test("POI behind returns true", () => {
    // User heading north (0°), POI is south
    expect(isPoiBehind(56.1, 9.0, 0, 56.0, 9.0)).toBe(true);
  });
});

describe("getAlertLevel", () => {
  test("no alert for >5km", () => {
    expect(getAlertLevel(6000)).toBe("none");
  });

  test("dot for 2-5km", () => {
    expect(getAlertLevel(3000)).toBe("dot");
  });

  test("notification for 1-2km", () => {
    expect(getAlertLevel(1500)).toBe("notification");
  });

  test("fullscreen for <500m", () => {
    expect(getAlertLevel(300)).toBe("fullscreen");
  });
});
```

**Step 2: Run tests — should fail**

```bash
cd app && bun test src/poi-radar.test.ts
```

**Step 3: Implement poi-radar.ts**

```typescript
const EARTH_RADIUS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function isPoiBehind(
  userLat: number, userLng: number, userHeading: number,
  poiLat: number, poiLng: number
): boolean {
  const bearingToPoi = bearingBetween(userLat, userLng, poiLat, poiLng);
  let diff = Math.abs(bearingToPoi - userHeading);
  if (diff > 180) diff = 360 - diff;
  return diff > 90;
}

export type AlertLevel = "none" | "dot" | "notification" | "fullscreen";

export function getAlertLevel(distanceMeters: number): AlertLevel {
  if (distanceMeters > 5000) return "none";
  if (distanceMeters > 2000) return "dot";
  if (distanceMeters > 500) return "notification";
  return "fullscreen";
}

// POI type filter: Camera* or Law Enforcement
const ALERT_FILTER = (type: string): boolean => {
  return type.includes("Camera") || type === "Law Enforcement";
};

export interface TrackedPoi {
  id: string;
  type: string;
  typeCode: number;
  latitude: number;
  longitude: number;
  speedLimitKmh?: number;
  roadName?: string;
  city?: string;
  distance: number;
  alertLevel: AlertLevel;
  behind: boolean;
}

export function updateTrackedPois(
  pois: Map<string, any>,
  userLat: number,
  userLng: number,
  userHeading: number
): TrackedPoi[] {
  const tracked: TrackedPoi[] = [];

  for (const [id, poi] of pois) {
    if (!ALERT_FILTER(poi.type)) continue;
    if (!poi.latitude || !poi.longitude) continue;

    const distance = haversineDistance(userLat, userLng, poi.latitude, poi.longitude);
    const behind = isPoiBehind(userLat, userLng, userHeading, poi.latitude, poi.longitude);
    const alertLevel = behind ? "none" : getAlertLevel(distance);

    tracked.push({
      id,
      type: poi.type,
      typeCode: poi.typeCode,
      latitude: poi.latitude,
      longitude: poi.longitude,
      speedLimitKmh: poi.speedLimitKmh,
      roadName: poi.roadName,
      city: poi.city,
      distance,
      alertLevel,
      behind,
    });
  }

  return tracked.sort((a, b) => a.distance - b.distance);
}
```

**Step 4: Run tests**

```bash
cd app && bun test src/poi-radar.test.ts
```

Expected: All PASS

**Step 5: Commit**

```bash
git add app/src/poi-radar.ts app/src/poi-radar.test.ts
git commit -m "Implement POI radar logic: distance, bearing, alert levels"
```

---

### Task 2: Create fullscreen POI alert component

**Files:**
- Create: `app/src/components/PoiAlert.tsx`

**Step 1: Implement alert overlay**

```typescript
// app/src/components/PoiAlert.tsx
import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Dimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import type { TrackedPoi } from "../poi-radar";

const { width, height } = Dimensions.get("window");

const POI_COLORS: Record<string, string> = {
  "Fixed Speed Camera": "#f44336",
  "Mobile Speed Camera": "#ff5722",
  "Average Speed Camera": "#ff9800",
  "Red Light Camera": "#e91e63",
  "Speed & Red Light Camera": "#9c27b0",
  "Helicopter Camera": "#673ab7",
  "Distance Camera": "#3f51b5",
  "Law Enforcement": "#2196f3",
};

export default function PoiAlert({ poi, level }: { poi: TrackedPoi; level: "notification" | "fullscreen" }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const hapticInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const color = POI_COLORS[poi.type] || "#f44336";
  const distText = poi.distance > 1000
    ? `${(poi.distance / 1000).toFixed(1)} km`
    : `${Math.round(poi.distance)} m`;
  const isClose = poi.distance < 500;

  useEffect(() => {
    if (level === "fullscreen") {
      // Pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();

      // Haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      hapticInterval.current = setInterval(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }, isClose ? 500 : 2000);

      // Alert sound
      (async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            require("../../assets/alert.mp3"),
            { shouldPlay: true, isLooping: false }
          );
          soundRef.current = sound;
        } catch {
          // Sound file may not exist yet, that's OK
        }
      })();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    return () => {
      if (hapticInterval.current) clearInterval(hapticInterval.current);
      soundRef.current?.unloadAsync();
    };
  }, [level, isClose]);

  if (level === "notification") {
    return (
      <View style={[styles.notification, { borderLeftColor: color }]} testID="poi-notification">
        <Text style={[styles.notifType, { color }]}>{poi.type}</Text>
        <Text style={styles.notifDist}>{distText}</Text>
        {poi.speedLimitKmh ? <Text style={styles.notifSpeed}>{poi.speedLimitKmh} km/h</Text> : null}
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.fullscreen, { backgroundColor: color, transform: [{ scale: pulseAnim }] }]}
      testID="poi-fullscreen-alert"
    >
      <Text style={styles.warningIcon}>{"\u26a0\ufe0f"}</Text>
      <Text style={styles.poiType}>{poi.type.toUpperCase()}</Text>
      <Text style={styles.distance}>{distText}</Text>
      {poi.speedLimitKmh ? (
        <View style={styles.speedBadge}>
          <Text style={styles.speedText}>{poi.speedLimitKmh}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      ) : null}
      {poi.roadName ? <Text style={styles.road}>{poi.roadName}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notification: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 5,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  notifType: { fontSize: 14, fontWeight: "700", flex: 1 },
  notifDist: { fontSize: 16, fontWeight: "800", marginHorizontal: 8 },
  notifSpeed: { fontSize: 13, color: "#666" },

  fullscreen: {
    position: "absolute",
    top: 0,
    left: 0,
    width,
    height,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  warningIcon: { fontSize: 60, marginBottom: 16 },
  poiType: { fontSize: 26, fontWeight: "900", color: "#fff", textAlign: "center" },
  distance: { fontSize: 72, fontWeight: "900", color: "#fff", marginTop: 16 },
  speedBadge: {
    marginTop: 20,
    backgroundColor: "#fff",
    borderRadius: 40,
    width: 80,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  speedText: { fontSize: 28, fontWeight: "900", color: "#333" },
  speedUnit: { fontSize: 11, color: "#999" },
  road: { fontSize: 16, color: "rgba(255,255,255,0.8)", marginTop: 16 },
});
```

**Step 2: Create placeholder alert sound**

```bash
# Create a simple alert tone (or download a free one)
mkdir -p app/assets
# For now, create an empty placeholder — will add real sound later
touch app/assets/alert.mp3
```

**Step 3: Commit**

```bash
git add app/src/components/PoiAlert.tsx app/assets/alert.mp3
git commit -m "Implement fullscreen POI alert with haptics, sound, countdown"
```

---

### Task 3: Integrate POI radar into navigation screen

**Files:**
- Modify: `app/app/navigation.tsx`

**Step 1: Add POI radar state and WebSocket connection**

Add to the imports in navigation.tsx:

```typescript
import { updateTrackedPois, type TrackedPoi } from "../src/poi-radar";
import PoiAlert from "../src/components/PoiAlert";
import { Marker } from "react-native-maps";
```

Add state and WebSocket connection inside NavigationScreen component:

```typescript
  // POI radar state
  const [pois, setPois] = useState<Map<string, any>>(new Map());
  const [trackedPois, setTrackedPois] = useState<TrackedPoi[]>([]);
  const [activeAlert, setActiveAlert] = useState<TrackedPoi | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const headingRef = useRef(0);

  // Connect WebSocket to saphe backend
  useEffect(() => {
    wsRef.current = api.createPoiWebSocket(
      (poi) => {
        setPois(prev => {
          const next = new Map(prev);
          next.set(poi.id, poi);
          return next;
        });
      },
      (batch) => {
        setPois(prev => {
          const next = new Map(prev);
          for (const poi of batch) next.set(poi.id, poi);
          return next;
        });
      }
    );
    return () => { wsRef.current?.close(); };
  }, []);

  // Start trip when navigation begins
  useEffect(() => {
    if (userLocation) {
      api.startTrip(userLocation.lat, userLocation.lng);
    }
    return () => { api.stopTrip(); };
  }, []);

  // Update location on saphe backend + heading tracking
  useEffect(() => {
    if (!userLocation) return;
    api.moveTrip(userLocation.lat, userLocation.lng);

    // Update tracked POIs with current position
    const tracked = updateTrackedPois(pois, userLocation.lat, userLocation.lng, headingRef.current);
    setTrackedPois(tracked);

    // Determine active alert (highest priority non-behind POI)
    const alertPoi = tracked.find(p => p.alertLevel === "fullscreen" && !p.behind)
      || tracked.find(p => p.alertLevel === "notification" && !p.behind);
    setActiveAlert(alertPoi || null);
  }, [userLocation, pois]);

  // Track heading from location updates
  useEffect(() => {
    (async () => {
      const sub = await Location.watchHeadingAsync((heading) => {
        headingRef.current = heading.trueHeading;
      });
      return () => sub.remove();
    })();
  }, []);
```

Add POI markers and alert overlay to the JSX, before the closing `</View>`:

```typescript
      {/* POI markers on map */}
      {trackedPois.filter(p => p.alertLevel !== "none").map(poi => (
        <Marker
          key={poi.id}
          coordinate={{ latitude: poi.latitude, longitude: poi.longitude }}
          title={poi.type}
          description={`${poi.distance > 1000 ? (poi.distance/1000).toFixed(1) + " km" : Math.round(poi.distance) + " m"}${poi.speedLimitKmh ? " · " + poi.speedLimitKmh + " km/h" : ""}`}
          pinColor={poi.alertLevel === "fullscreen" ? "red" : poi.alertLevel === "notification" ? "orange" : "yellow"}
        />
      ))}

      {/* POI Alert overlay */}
      {activeAlert && activeAlert.alertLevel === "fullscreen" && (
        <PoiAlert poi={activeAlert} level="fullscreen" />
      )}
      {activeAlert && activeAlert.alertLevel === "notification" && (
        <View style={{ position: "absolute", top: 130, left: 16, right: 16 }}>
          <PoiAlert poi={activeAlert} level="notification" />
        </View>
      )}
```

**Step 2: Verify in simulator**

Launch app, navigate to a route. If saphe backend has POIs, they should appear on map. The fullscreen alert triggers when within 500m.

Take screenshot: `xcrun simctl io booted screenshot /tmp/routr-poi-alert.png`

**Step 3: Commit**

```bash
git add app/app/navigation.tsx
git commit -m "Integrate POI radar into navigation: WebSocket, markers, fullscreen alerts"
```

---

### Task 4: Add alert sound file

**Files:**
- Replace: `app/assets/alert.mp3`

**Step 1: Generate or download a short alert tone**

```bash
# Use ffmpeg to generate a simple beep tone (440Hz, 0.5s)
ffmpeg -f lavfi -i "sine=frequency=880:duration=0.3" -af "afade=t=out:st=0.2:d=0.1" app/assets/alert.mp3 -y 2>/dev/null || echo "ffmpeg not available, use placeholder"
```

If ffmpeg isn't available, download a free alert sound or leave the placeholder (the app handles missing sound gracefully).

**Step 2: Commit**

```bash
git add app/assets/alert.mp3
git commit -m "Add alert sound for POI warnings"
```

---

### Phase 5 Verification Checklist

```bash
# Unit tests
cd app && bun test src/poi-radar.test.ts && echo "PASS: radar logic" || echo "FAIL"
```

Via Expo MCP screenshot or Maestro:

- [ ] POI markers appear on map when trip is active and backend has POIs
- [ ] Notification card appears when within 1-2km of a POI
- [ ] Fullscreen alert appears when within 500m of a POI
- [ ] Fullscreen alert shows: POI type, distance countdown, speed limit, road name
- [ ] Vibration triggers on alert
- [ ] Alert auto-dismisses when POI is behind (bearing > 90°)

Maestro flow (with mocked GPS):

```yaml
appId: com.routr.app
---
- launchApp
- tapOn:
    id: "search-bar"
- inputText: "Silkeborg"
- tapOn:
    index: 0
- assertVisible:
    id: "curve-card"
    optional: true
# Simulate approaching a POI (requires GPS mock)
# - assertVisible:
#     id: "poi-notification"
# - assertVisible:
#     id: "poi-fullscreen-alert"
```

Note: Full POI alert testing requires either:
1. A mock GPS location near known Saphe POIs
2. Xcode's GPX simulation file
3. The saphe backend having an active trip with nearby POIs
