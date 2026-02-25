# Phase 4: Expo App — Scaffold + Map + Navigation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a React Native + Expo app with map display, location search, route display with color-graded curvature polylines, turn-by-turn instructions, curve cards with rally notation, and route preference selection.

**Architecture:** Expo managed workflow, react-native-maps (Apple Maps on iOS, Google Maps on Android), calls curves-engine API for routing. Expo MCP Server for autonomous development verification.

**Tech Stack:** Expo SDK 52+, React Native, TypeScript, react-native-maps, expo-location, expo-router

---

### Task 1: Create Expo project

**Step 1: Initialize Expo app**

```bash
cd /Users/milo/milodev/gits/routr
npx create-expo-app@latest app --template blank-typescript
```

**Step 2: Install dependencies**

```bash
cd app
npx expo install react-native-maps expo-location expo-router expo-haptics expo-av
npx expo install react-native-safe-area-context react-native-screens react-native-gesture-handler
bun add @types/react-native-maps
```

**Step 3: Verify Expo starts**

```bash
npx expo start --ios
```

Expected: App opens in iOS Simulator with default Expo blank screen

**Step 4: Take screenshot via Expo MCP or CLI**

```bash
xcrun simctl io booted screenshot /tmp/routr-initial.png
```

Expected: Screenshot shows blank Expo app

**Step 5: Commit**

```bash
cd /Users/milo/milodev/gits/routr
git add app/
git commit -m "Scaffold Expo app with dependencies"
```

---

### Task 2: Set up app structure with expo-router

**Files:**
- Create: `app/app/_layout.tsx`
- Create: `app/app/index.tsx`
- Create: `app/app/navigation.tsx`
- Create: `app/app/search.tsx`
- Create: `app/src/api.ts`
- Create: `app/src/types.ts`

**Step 1: Create types**

```typescript
// app/src/types.ts
export interface RouteSegment {
  from: [number, number];
  to: [number, number];
  radius: number;
  grade: string;
  color: string;
}

export interface CurveCard {
  type: string;
  direction: "L" | "R";
  grade: string;
  radius: number;
  lat: number;
  lng: number;
  distanceFromStart: number;
}

export interface TurnInstruction {
  type: string;
  modifier: string;
  exit?: number;
  name: string;
  distanceFromStart: number;
  duration: number;
  distance: number;
}

export interface RouteOption {
  label: string;
  curvatureScore: number;
  durationMin: number;
  distanceKm: number;
  geometry: string;
  segments: RouteSegment[];
  curves: CurveCard[];
  turns: TurnInstruction[];
  selected: boolean;
}

export interface RouteResponse {
  routes: RouteOption[];
}

export interface PoiData {
  id: string;
  type: string;
  typeCode: number;
  state: string;
  latitude: number;
  longitude: number;
  speedLimitKmh?: number;
  roadName?: string;
  city?: string;
}
```

**Step 2: Create API client**

```typescript
// app/src/api.ts
import type { RouteResponse, PoiData } from "./types";

const CURVES_URL = process.env.EXPO_PUBLIC_CURVES_URL || "http://localhost:3457";
const SAPHE_URL = process.env.EXPO_PUBLIC_SAPHE_URL || "http://localhost:3456";

export const api = {
  async getRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    preference: "curvy" | "balanced" | "fastest" = "balanced",
    exclude?: string
  ): Promise<RouteResponse> {
    const params = new URLSearchParams({
      from: `${from.lat},${from.lng}`,
      to: `${to.lat},${to.lng}`,
      preference,
    });
    if (exclude) params.set("exclude", exclude);
    const res = await fetch(`${CURVES_URL}/api/route?${params}`);
    if (!res.ok) throw new Error(`Route API error: ${res.status}`);
    return res.json();
  },

  async searchPlace(query: string): Promise<Array<{ name: string; lat: number; lng: number }>> {
    // Use Nominatim (free OSM geocoder)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=dk`,
      { headers: { "User-Agent": "Routr/1.0" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((r: any) => ({
      name: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
  },

  createPoiWebSocket(onPoi: (poi: PoiData) => void, onBatch?: (pois: PoiData[]) => void): WebSocket {
    const ws = new WebSocket(`${SAPHE_URL.replace("http", "ws")}/ws/pois`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "poi_update" && onPoi) onPoi(data.poi);
      if (data.type === "poi_batch" && onBatch) onBatch(data.pois);
    };
    return ws;
  },

  async startTrip(lat: number, lng: number, speedKmh: number = 80): Promise<any> {
    const res = await fetch(`${SAPHE_URL}/api/trip/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, speedKmh }),
    });
    return res.json();
  },

  async moveTrip(lat: number, lng: number, speedKmh?: number, heading?: number): Promise<void> {
    await fetch(`${SAPHE_URL}/api/trip/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, speedKmh, heading }),
    });
  },

  async stopTrip(): Promise<void> {
    await fetch(`${SAPHE_URL}/api/trip/stop`, { method: "POST" });
  },
};
```

**Step 3: Create root layout**

```typescript
// app/app/_layout.tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="search" options={{ presentation: "modal" }} />
      <Stack.Screen name="navigation" />
    </Stack>
  );
}
```

**Step 4: Create placeholder screens**

```typescript
// app/app/index.tsx
import { View, Text } from "react-native";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Routr - Home (Map goes here)</Text>
    </View>
  );
}
```

```typescript
// app/app/search.tsx
import { View, Text } from "react-native";

export default function SearchScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Search destination</Text>
    </View>
  );
}
```

```typescript
// app/app/navigation.tsx
import { View, Text } from "react-native";

export default function NavigationScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Navigation (active route)</Text>
    </View>
  );
}
```

**Step 5: Verify app loads with expo-router**

```bash
cd app && npx expo start --ios
```

Take screenshot: `xcrun simctl io booted screenshot /tmp/routr-scaffold.png`

Expected: Shows "Routr - Home (Map goes here)"

**Step 6: Commit**

```bash
cd /Users/milo/milodev/gits/routr
git add app/
git commit -m "Set up expo-router screens, API client, types"
```

---

### Task 3: Implement home screen with map

**Files:**
- Modify: `app/app/index.tsx`

**Step 1: Implement map with current location**

```typescript
// app/app/index.tsx
import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MapView, { PROVIDER_DEFAULT, Region } from "react-native-maps";
import * as Location from "expo-location";
import { router } from "expo-router";

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: 56.1694,
    longitude: 9.5518,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    })();
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        region={region}
        showsUserLocation
        showsMyLocationButton
        onRegionChangeComplete={setRegion}
      />

      <TouchableOpacity
        style={styles.searchBar}
        onPress={() => router.push("/search")}
        testID="search-bar"
      >
        <Text style={styles.searchText}>Where to?</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchBar: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  searchText: {
    fontSize: 17,
    color: "#999",
  },
});
```

**Step 2: Verify map renders**

```bash
cd app && npx expo start --ios
```

Take screenshot: `xcrun simctl io booted screenshot /tmp/routr-map.png`

Expected: Apple Maps visible with "Where to?" search bar

**Step 3: Commit**

```bash
git add app/app/index.tsx
git commit -m "Implement home screen with Apple Maps and search bar"
```

---

### Task 4: Implement search screen

**Files:**
- Modify: `app/app/search.tsx`

**Step 1: Implement search with Nominatim autocomplete**

```typescript
// app/app/search.tsx
import { useState, useCallback } from "react";
import {
  View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet, SafeAreaView,
} from "react-native";
import { router } from "expo-router";
import { api } from "../src/api";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (text: string) => {
    setQuery(text);
    if (text.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const places = await api.searchPlace(text);
      setResults(places);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  const selectPlace = (place: { name: string; lat: number; lng: number }) => {
    router.replace({
      pathname: "/navigation",
      params: { toLat: place.lat.toString(), toLng: place.lng.toString(), toName: place.name },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn">
          <Text style={styles.backBtn}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Search destination..."
        value={query}
        onChangeText={search}
        autoFocus
        testID="search-input"
      />

      {loading && <Text style={styles.loading}>Searching...</Text>}

      <FlatList
        data={results}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.result}
            onPress={() => selectPlace(item)}
            testID={`result-${item.name.slice(0, 20)}`}
          >
            <Text style={styles.resultName} numberOfLines={1}>{item.name.split(",")[0]}</Text>
            <Text style={styles.resultDetail} numberOfLines={1}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { flexDirection: "row", padding: 16, alignItems: "center" },
  backBtn: { fontSize: 17, color: "#007aff" },
  input: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    fontSize: 17,
  },
  loading: { padding: 16, color: "#999", textAlign: "center" },
  result: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  resultName: { fontSize: 16, fontWeight: "600" },
  resultDetail: { fontSize: 13, color: "#999", marginTop: 2 },
});
```

**Step 2: Verify search works**

Launch app, tap "Where to?", type "København". Should show results.

Take screenshot: `xcrun simctl io booted screenshot /tmp/routr-search.png`

**Step 3: Commit**

```bash
git add app/app/search.tsx
git commit -m "Implement search screen with Nominatim geocoding"
```

---

### Task 5: Implement navigation screen with route display

**Files:**
- Modify: `app/app/navigation.tsx`
- Create: `app/src/polyline.ts`
- Create: `app/src/components/CurveCard.tsx`
- Create: `app/src/components/TurnInstruction.tsx`
- Create: `app/src/components/RouteSelector.tsx`

**Step 1: Port polyline decoder to app**

```typescript
// app/src/polyline.ts
export function decodePolyline(encoded: string, precision: number = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  const coords: [number, number][] = [];
  let lat = 0, lng = 0, i = 0;

  while (i < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(i++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}
```

**Step 2: Create CurveCard component**

```typescript
// app/src/components/CurveCard.tsx
import { View, Text, StyleSheet } from "react-native";
import type { CurveCard as CurveCardType } from "../types";

const GRADE_COLORS: Record<string, string> = {
  hairpin: "#9c27b0",
  "1": "#f44336",
  "2": "#ff5722",
  "3": "#ff9800",
  "4": "#ffc107",
  "5": "#cddc39",
  "6": "#8bc34a",
};

export default function CurveCard({ curve, distanceAway }: { curve: CurveCardType; distanceAway: number }) {
  const color = GRADE_COLORS[curve.grade] || "#999";
  const arrow = curve.direction === "L" ? "\u2B05" : "\u27A1";
  const distText = distanceAway > 1000
    ? `${(distanceAway / 1000).toFixed(1)} km`
    : `${Math.round(distanceAway)} m`;

  return (
    <View style={[styles.card, { borderLeftColor: color }]} testID="curve-card">
      <Text style={[styles.arrow, { color }]}>{arrow}</Text>
      <View style={styles.info}>
        <Text style={[styles.grade, { color }]}>{curve.type}</Text>
        <Text style={styles.distance}>in {distText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  arrow: { fontSize: 28, marginRight: 12 },
  info: { flex: 1 },
  grade: { fontSize: 22, fontWeight: "800" },
  distance: { fontSize: 14, color: "#666", marginTop: 2 },
});
```

**Step 3: Create TurnInstruction component**

```typescript
// app/src/components/TurnInstruction.tsx
import { View, Text, StyleSheet } from "react-native";
import type { TurnInstruction as TurnType } from "../types";

const TURN_ICONS: Record<string, string> = {
  "turn-left": "\u2B05",
  "turn-right": "\u27A1",
  "turn-sharp-left": "\u2196",
  "turn-sharp-right": "\u2197",
  "turn-slight-left": "\u2199",
  "turn-slight-right": "\u2198",
  "roundabout": "\ud83d\udd04",
  "rotary": "\ud83d\udd04",
  "straight": "\u2B06",
  "fork-left": "\u2196",
  "fork-right": "\u2197",
};

function RoundaboutIcon({ exit }: { exit: number }) {
  return (
    <View style={styles.roundabout} testID="roundabout-icon">
      <Text style={styles.roundaboutCircle}>{"\ud83d\udd04"}</Text>
      <View style={styles.exitBadge}>
        <Text style={styles.exitText}>{exit}</Text>
      </View>
    </View>
  );
}

export default function TurnInstruction({ turn, distanceAway }: { turn: TurnType; distanceAway: number }) {
  const isRoundabout = turn.type === "roundabout" || turn.type === "rotary";
  const icon = TURN_ICONS[`${turn.type}-${turn.modifier}`] || TURN_ICONS[turn.type] || "\u2B06";
  const distText = distanceAway > 1000
    ? `${(distanceAway / 1000).toFixed(1)} km`
    : `${Math.round(distanceAway)} m`;

  return (
    <View style={styles.card} testID="turn-instruction">
      {isRoundabout && turn.exit ? (
        <RoundaboutIcon exit={turn.exit} />
      ) : (
        <Text style={styles.icon}>{icon}</Text>
      )}
      <View style={styles.info}>
        <Text style={styles.action}>
          {isRoundabout ? `Exit ${turn.exit}` : `${turn.modifier || turn.type}`}
        </Text>
        {turn.name ? <Text style={styles.road}>{turn.name}</Text> : null}
        <Text style={styles.distance}>in {distText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  icon: { fontSize: 24, marginRight: 10, width: 36, textAlign: "center" },
  roundabout: { width: 36, height: 36, marginRight: 10, alignItems: "center", justifyContent: "center" },
  roundaboutCircle: { fontSize: 30 },
  exitBadge: {
    position: "absolute",
    backgroundColor: "#007aff",
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  exitText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  info: { flex: 1 },
  action: { fontSize: 15, fontWeight: "700", textTransform: "capitalize" },
  road: { fontSize: 13, color: "#333", marginTop: 1 },
  distance: { fontSize: 12, color: "#999", marginTop: 2 },
});
```

**Step 4: Create RouteSelector component**

```typescript
// app/src/components/RouteSelector.tsx
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import type { RouteOption } from "../types";

const LABEL_COLORS: Record<string, string> = {
  Scenic: "#9c27b0",
  Balanced: "#ff9800",
  Fastest: "#4caf50",
  Route: "#007aff",
};

export default function RouteSelector({
  routes,
  onSelect,
}: {
  routes: RouteOption[];
  onSelect: (index: number) => void;
}) {
  return (
    <ScrollView horizontal style={styles.container} showsHorizontalScrollIndicator={false}>
      {routes.map((route, i) => (
        <TouchableOpacity
          key={i}
          style={[
            styles.card,
            route.selected && styles.selectedCard,
            { borderColor: LABEL_COLORS[route.label] || "#007aff" },
          ]}
          onPress={() => onSelect(i)}
          testID={`route-option-${route.label}`}
        >
          <Text style={[styles.label, { color: LABEL_COLORS[route.label] }]}>{route.label}</Text>
          <Text style={styles.duration}>{route.durationMin} min</Text>
          <Text style={styles.detail}>{route.distanceKm} km</Text>
          <View style={styles.scoreBar}>
            <View
              style={[styles.scoreFill, {
                width: `${Math.min(100, route.curvatureScore / 50)}%`,
                backgroundColor: LABEL_COLORS[route.label],
              }]}
            />
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginRight: 10,
    width: 120,
    borderWidth: 2,
    borderColor: "#e0e0e0",
  },
  selectedCard: { borderWidth: 3 },
  label: { fontSize: 14, fontWeight: "800" },
  duration: { fontSize: 20, fontWeight: "700", marginTop: 4 },
  detail: { fontSize: 12, color: "#999", marginTop: 2 },
  scoreBar: { height: 4, backgroundColor: "#f0f0f0", borderRadius: 2, marginTop: 6 },
  scoreFill: { height: 4, borderRadius: 2 },
});
```

**Step 5: Implement navigation screen**

```typescript
// app/app/navigation.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import MapView, { Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "../src/api";
import { decodePolyline } from "../src/polyline";
import CurveCard from "../src/components/CurveCard";
import TurnInstruction from "../src/components/TurnInstruction";
import RouteSelector from "../src/components/RouteSelector";
import type { RouteOption, CurveCard as CurveCardType, TurnInstruction as TurnType } from "../src/types";

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function NavigationScreen() {
  const { toLat, toLng, toName } = useLocalSearchParams<{ toLat: string; toLng: string; toName: string }>();
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const mapRef = useRef<MapView>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);

  // Fetch route on mount
  useEffect(() => {
    (async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });

        const result = await api.getRoute(
          { lat: loc.coords.latitude, lng: loc.coords.longitude },
          { lat: parseFloat(toLat!), lng: parseFloat(toLng!) },
          "balanced"
        );
        setRoutes(result.routes);
        const idx = result.routes.findIndex(r => r.selected);
        setSelectedIndex(idx >= 0 ? idx : 0);
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    })();
  }, [toLat, toLng]);

  // Track location
  useEffect(() => {
    (async () => {
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
        (loc) => {
          const newLoc = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setUserLocation(prev => {
            if (prev) {
              const d = haversine(prev.lat, prev.lng, newLoc.lat, newLoc.lng);
              setDistanceTraveled(dt => dt + d);
            }
            return newLoc;
          });
        }
      );
    })();
    return () => { locationSub.current?.remove(); };
  }, []);

  const selectedRoute = routes[selectedIndex];

  // Find next curve card and turn instruction based on distance traveled
  const nextCurve = selectedRoute?.curves.find(c => c.distanceFromStart > distanceTraveled);
  const nextTurn = selectedRoute?.turns.find(t => t.distanceFromStart > distanceTraveled);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Calculating routes...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.backLink}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  // Build polyline coordinates with color segments
  const routeCoords = selectedRoute ? decodePolyline(selectedRoute.geometry).map(([lat, lng]) => ({ latitude: lat, longitude: lng })) : [];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        showsUserLocation
        followsUserLocation
        initialRegion={userLocation ? {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        } : undefined}
      >
        {/* Color-graded route segments */}
        {selectedRoute?.segments.map((seg, i) => (
          <Polyline
            key={i}
            coordinates={[
              { latitude: seg.from[0], longitude: seg.from[1] },
              { latitude: seg.to[0], longitude: seg.to[1] },
            ]}
            strokeColor={seg.color}
            strokeWidth={5}
          />
        ))}
      </MapView>

      {/* Overlay UI */}
      <View style={styles.overlay}>
        {nextCurve && (
          <CurveCard
            curve={nextCurve}
            distanceAway={nextCurve.distanceFromStart - distanceTraveled}
          />
        )}
        {nextTurn && (
          <TurnInstruction
            turn={nextTurn}
            distanceAway={nextTurn.distanceFromStart - distanceTraveled}
          />
        )}
      </View>

      {/* Route selector at bottom */}
      <View style={styles.bottom}>
        {routes.length > 1 && (
          <RouteSelector
            routes={routes}
            onSelect={(i) => {
              setSelectedIndex(i);
              setRoutes(prev => prev.map((r, j) => ({ ...r, selected: j === i })));
            }}
          />
        )}
        <View style={styles.footer}>
          <Text style={styles.eta}>
            {selectedRoute?.durationMin} min \u00b7 {selectedRoute?.distanceKm} km
            {toName ? ` \u00b7 ${toName.split(",")[0]}` : ""}
          </Text>
          <TouchableOpacity style={styles.stopBtn} onPress={() => router.replace("/")} testID="stop-nav">
            <Text style={styles.stopText}>Stop</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 16, color: "#666" },
  errorText: { fontSize: 16, color: "red" },
  backLink: { marginTop: 12, fontSize: 16, color: "#007aff" },
  overlay: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34, // safe area
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  eta: { fontSize: 15, fontWeight: "600", color: "#333" },
  stopBtn: { backgroundColor: "#f44336", borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  stopText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
```

**Step 6: Verify navigation screen**

Launch app → tap "Where to?" → type "København" → select result → should see map with route

Take screenshot: `xcrun simctl io booted screenshot /tmp/routr-navigation.png`

**Step 7: Commit**

```bash
git add app/
git commit -m "Implement navigation screen with color-graded routes, curve cards, turn instructions"
```

---

### Phase 4 Verification Checklist

Via Expo MCP screenshot or `xcrun simctl io booted screenshot`:

- [ ] Home screen: map renders with "Where to?" search bar
- [ ] Search screen: typing shows autocomplete results from Nominatim
- [ ] Navigation screen: color-graded route polyline visible on map
- [ ] Navigation screen: curve card shows rally notation (e.g., "L3 in 200m")
- [ ] Navigation screen: turn instruction shows road name and direction
- [ ] Navigation screen: roundabout instruction shows exit number
- [ ] Navigation screen: route selector shows Scenic/Balanced/Fastest cards
- [ ] Navigation screen: tapping different route option changes displayed route
- [ ] Navigation screen: Stop button returns to home screen

Maestro flow:

```yaml
appId: com.routr.app
---
- launchApp
- tapOn:
    id: "search-bar"
- inputText: "København"
- tapOn:
    id: "result-København"
- assertVisible:
    id: "curve-card"
- assertVisible:
    id: "turn-instruction"
- tapOn:
    id: "route-option-Scenic"
- tapOn:
    id: "stop-nav"
- assertVisible:
    id: "search-bar"
```
