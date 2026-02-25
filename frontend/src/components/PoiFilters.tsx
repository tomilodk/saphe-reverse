import { getPoiColor } from '../poi-colors';

interface Props {
  poiTypes: Record<string, string>;
  filters: Record<number, boolean>;
  setFilters: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  totalCount: number;
  filteredCount: number;
  onExport: () => void;
}

export default function PoiFilters({ poiTypes, filters, setFilters, totalCount, filteredCount, onExport }: Props) {
  const toggleFilter = (code: number) => {
    setFilters(prev => ({ ...prev, [code]: !prev[code] }));
  };

  const toggleAll = (on: boolean) => {
    setFilters(prev => {
      const next = { ...prev };
      for (const code of Object.keys(next)) next[Number(code)] = on;
      return next;
    });
  };

  return (
    <div className="panel">
      <div className="panel-title">
        Filter POIs <span className="count">{filteredCount}/{totalCount}</span>
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => toggleAll(true)}>All</button>
        <button className="btn btn-sm" onClick={() => toggleAll(false)}>None</button>
        <button className="btn btn-sm btn-cyan" onClick={onExport}>Export</button>
      </div>
      <div className="filter-grid">
        {Object.entries(poiTypes).map(([code, name]) => {
          const c = Number(code);
          if (c === 0) return null;
          const color = getPoiColor(c);
          const active = filters[c] !== false;
          return (
            <button
              key={c}
              className={`filter-chip ${active ? 'active' : ''}`}
              style={{ borderLeftColor: color, borderLeftWidth: 3 } as React.CSSProperties}
              onClick={() => toggleFilter(c)}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
