import { useState } from 'react';

interface Props {
  tripActive: boolean;
  authenticated: boolean;
  onStart: (speedKmh: number, intervalS: number) => void;
  onStop: () => void;
}

export default function TripControls({ tripActive, authenticated, onStart, onStop }: Props) {
  const [speed, setSpeed] = useState(80);
  const [interval, setInterval] = useState(60);

  return (
    <div className="panel">
      <div className="panel-title">Trip</div>
      <div className="row">
        <div style={{ flex: 1 }}>
          <label className="input-label">Speed (km/h)</label>
          <input
            className="input"
            type="number"
            value={speed}
            onChange={e => setSpeed(Number(e.target.value) || 80)}
            step={10}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="input-label">Interval (s)</label>
          <input
            className="input"
            type="number"
            value={interval}
            onChange={e => setInterval(Number(e.target.value) || 60)}
            step={5}
          />
        </div>
      </div>
      <div className="row">
        <button
          className="btn btn-block btn-green"
          onClick={() => onStart(speed, interval)}
          disabled={tripActive || !authenticated}
        >
          {!authenticated ? 'Login first' : 'Start at Map Center'}
        </button>
        <button
          className="btn btn-block btn-red"
          onClick={onStop}
          disabled={!tripActive}
        >
          Stop
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 6 }}>
        {tripActive ? 'Pan map to update position' : 'Center map on target area, then start'}
      </div>
    </div>
  );
}
