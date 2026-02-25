import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { api, type AuthStatus, type PoiData } from './api';
import { getPoiColor } from './poi-colors';
import LoginModal from './components/LoginModal';
import AutoRegisterModal from './components/AutoRegisterModal';
import TripControls from './components/TripControls';
import PoiFilters from './components/PoiFilters';
import PoiList from './components/PoiList';
import EventLog from './components/EventLog';

type LogEntry = { time: string; msg: string };

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showAutoReg, setShowAutoReg] = useState(false);
  const [tripActive, setTripActive] = useState(false);
  const [allPois, setAllPois] = useState<PoiData[]>([]);
  const [poiTypes, setPoiTypes] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<Record<number, boolean>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([56.1694, 9.5518]);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ time, msg }, ...prev].slice(0, 60));
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuth(status);
    } catch { setAuth(null); }
  }, []);

  useEffect(() => {
    checkAuth();
    api.getPoiTypes().then(types => {
      setPoiTypes(types);
      const f: Record<number, boolean> = {};
      for (const [code, name] of Object.entries(types)) {
        const c = Number(code);
        if (c === 0) continue;
        f[c] = (name as string).includes('Camera') || name === 'Law Enforcement';
      }
      setFilters(f);
    }).catch(() => {});
  }, [checkAuth]);

  // POI polling
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const data = await api.getPois();
        setAllPois([...(data.dynamic || []), ...(data.static || [])]);
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => { return () => stopPolling(); }, [stopPolling]);

  const handleStartTrip = useCallback(async (speedKmh: number, intervalS: number) => {
    const [lat, lng] = mapCenter;
    try {
      const res = await api.startTrip(lat, lng, speedKmh, 0, intervalS * 1000);
      if (res.ok) {
        setTripActive(true);
        startPolling();
        addLog(`Trip started at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      } else {
        addLog(`Trip failed: ${res.error}`);
      }
    } catch (e: any) { addLog(`Trip error: ${e.message}`); }
  }, [mapCenter, startPolling, addLog]);

  const handleStopTrip = useCallback(async () => {
    await api.stopTrip();
    setTripActive(false);
    stopPolling();
    addLog('Trip stopped');
  }, [stopPolling, addLog]);

  const handleMapMove = useCallback(async (lat: number, lng: number) => {
    setMapCenter([lat, lng]);
    if (tripActive) {
      await api.moveTrip(lat, lng);
    }
  }, [tripActive]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setTripActive(false);
    stopPolling();
    setAllPois([]);
    await checkAuth();
    addLog('Logged out');
  }, [stopPolling, checkAuth, addLog]);

  const handleRefresh = useCallback(async () => {
    try {
      const res = await api.refresh();
      if (res.ok) { addLog('Token refreshed'); await checkAuth(); }
      else addLog(`Refresh failed: ${res.error}`);
    } catch (e: any) { addLog(`Refresh error: ${e.message}`); }
  }, [checkAuth, addLog]);

  const handleExport = useCallback(async () => {
    try {
      const data = await api.getPois();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `saphe-pois-${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      addLog('POIs exported');
    } catch { addLog('Export failed'); }
  }, [addLog]);

  const filteredPois = allPois.filter(p => filters[p.typeCode] !== false && p.state !== 'Deleted');

  return (
    <div className="app-layout">
      <div className="map-area">
        <MapContainer center={[56.1694, 9.5518]} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapEvents onMoveEnd={handleMapMove} />
          <PoiMarkers pois={filteredPois} />
          {tripActive && <TripMarker center={mapCenter} />}
          {flyTarget && <FlyTo target={flyTarget} onDone={() => setFlyTarget(null)} />}
        </MapContainer>
        <div className="map-overlay">
          {mapCenter[0].toFixed(5)}, {mapCenter[1].toFixed(5)}
        </div>
        {tripActive && (
          <div className="map-trip-indicator">
            <span className="pulse-dot" />
            TRIP ACTIVE
          </div>
        )}
      </div>

      <div className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="logo-text">SAPHE RADAR</div>
            <div className="logo-sub">poi explorer</div>
          </div>
          <span className={`status-badge ${auth?.authenticated ? 'connected' : 'offline'}`}>
            {auth?.authenticated ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/* Auth panel */}
        <div className="panel">
          <div className="panel-title">Account</div>
          {auth?.authenticated ? (
            <div className="row">
              <span style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--accent-cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {auth.username}
              </span>
              <button className="btn btn-sm btn-cyan" onClick={handleRefresh}>Refresh</button>
              <button className="btn btn-sm btn-red" onClick={handleLogout}>Logout</button>
            </div>
          ) : (
            <>
              <div className="row">
                <button className="btn btn-block btn-cyan" onClick={() => setShowLogin(true)}>Login with Email</button>
              </div>
              <div className="row">
                <button className="btn btn-block btn-amber" onClick={() => setShowAutoReg(true)}>Auto-Register</button>
              </div>
            </>
          )}
        </div>

        <TripControls
          tripActive={tripActive}
          authenticated={!!auth?.authenticated}
          onStart={handleStartTrip}
          onStop={handleStopTrip}
        />

        <PoiFilters
          poiTypes={poiTypes}
          filters={filters}
          setFilters={setFilters}
          totalCount={allPois.length}
          filteredCount={filteredPois.length}
          onExport={handleExport}
        />

        <PoiList
          pois={filteredPois}
          onFlyTo={(lat, lng) => setFlyTarget([lat, lng])}
        />

        <div className="panel">
          <div className="panel-title">Log</div>
          <EventLog entries={logs} />
        </div>
      </div>

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => { setShowLogin(false); checkAuth(); }}
          addLog={addLog}
        />
      )}
      {showAutoReg && (
        <AutoRegisterModal
          onClose={() => setShowAutoReg(false)}
          onSuccess={() => { checkAuth(); }}
          addLog={addLog}
        />
      )}
    </div>
  );
}

// Map helper components
function MapEvents({ onMoveEnd }: { onMoveEnd: (lat: number, lng: number) => void }) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMapEvents({
    moveend(e) {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        const c = e.target.getCenter();
        onMoveEnd(c.lat, c.lng);
      }, 800);
    },
  });
  return null;
}

function PoiMarkers({ pois }: { pois: PoiData[] }) {
  const map = useMap();
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const current = markersRef.current;
    const seen = new Set<string>();

    for (const p of pois) {
      if (!p.latitude || !p.longitude) continue;
      seen.add(p.id);

      if (current.has(p.id)) {
        current.get(p.id)!.setLatLng([p.latitude, p.longitude]);
      } else {
        const color = getPoiColor(p.typeCode);
        const icon = L.divIcon({
          className: '',
          html: `<div class="poi-marker" style="background:${color};"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const meta = [
          p.speedLimitKmh ? `${p.speedLimitKmh} km/h` : '',
          p.roadName || '',
          p.city || '',
        ].filter(Boolean).join(' \u00b7 ');
        const marker = L.marker([p.latitude, p.longitude], { icon })
          .bindPopup(
            `<div style="font-family:Outfit,sans-serif;font-size:13px;">
              <b style="color:${color}">${p.type}</b><br/>
              ${meta ? `<span style="color:#78909c">${meta}</span><br/>` : ''}
              <small style="color:#546e7a">${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</small>
            </div>`,
            { className: 'dark-popup' }
          )
          .addTo(map);
        current.set(p.id, marker);
      }
    }

    for (const [id, marker] of current) {
      if (!seen.has(id)) {
        map.removeLayer(marker);
        current.delete(id);
      }
    }
  }, [pois, map]);

  return null;
}

function TripMarker({ center }: { center: [number, number] }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!markerRef.current) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="trip-marker"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      markerRef.current = L.marker(center, { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
      markerRef.current.setLatLng(center);
    }
    return () => {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    };
  }, [center, map]);

  return null;
}

function FlyTo({ target, onDone }: { target: [number, number]; onDone: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(target, 15, { duration: 1 });
    onDone();
  }, [target, map, onDone]);
  return null;
}

export default App;
