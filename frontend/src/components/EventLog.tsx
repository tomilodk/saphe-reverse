interface Props {
  entries: { time: string; msg: string }[];
}

export default function EventLog({ entries }: Props) {
  return (
    <div className="event-log">
      {entries.length === 0 ? (
        <div className="log-entry">
          <span className="log-time">--:--:--</span>
          <span>Waiting for events...</span>
        </div>
      ) : (
        entries.map((e, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">{e.time}</span>
            <span>{e.msg}</span>
          </div>
        ))
      )}
    </div>
  );
}
