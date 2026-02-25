import type { PoiData } from '../api';
import { getPoiColor } from '../poi-colors';

interface Props {
  pois: PoiData[];
  onFlyTo: (lat: number, lng: number) => void;
}

export default function PoiList({ pois, onFlyTo }: Props) {
  if (pois.length === 0) {
    return (
      <div className="poi-list">
        <div className="empty-state">
          <div className="empty-icon">{'\u{1F4E1}'}</div>
          <div>No POIs yet</div>
          <div style={{ fontSize: '0.7rem', marginTop: 4, color: 'var(--text-muted)' }}>
            Start a trip to begin receiving data
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="poi-list">
      {pois.map(p => {
        const color = getPoiColor(p.typeCode);
        const tagClass = p.state ? (p.state || '').toLowerCase() : 'static';
        const tagLabel = p.state || 'Static';
        const meta = [
          p.speedLimitKmh ? `${p.speedLimitKmh} km/h` : '',
          p.roadName || '',
          p.city || '',
          p.countryCode || '',
        ].filter(Boolean).join(' \u00b7 ');

        return (
          <div
            key={p.id}
            className="poi-item"
            onClick={() => p.latitude && p.longitude && onFlyTo(p.latitude, p.longitude)}
          >
            <div className="poi-item-type">
              <span className="poi-item-dot" style={{ background: color }} />
              {p.type}
              <span className={`poi-item-tag ${tagClass}`}>{tagLabel}</span>
            </div>
            {p.latitude && (
              <div className="poi-item-meta">
                {p.latitude.toFixed(5)}, {p.longitude!.toFixed(5)}
              </div>
            )}
            {meta && <div className="poi-item-meta">{meta}</div>}
          </div>
        );
      })}
    </div>
  );
}
