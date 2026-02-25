import { useState, useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  addLog: (msg: string) => void;
}

interface StepData {
  step: string;
  done?: boolean;
  error?: boolean;
  email?: string;
}

export default function AutoRegisterModal({ onClose, onSuccess, addLog }: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [finished, setFinished] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/auth/auto-register-stream');

    es.onmessage = (e) => {
      const data: StepData = JSON.parse(e.data);
      setSteps(prev => [...prev, data]);

      if (data.done) {
        es.close();
        setFinished(true);
        addLog(`Auto-registered as ${data.email}`);
        onSuccess();
      }
      if (data.error) {
        es.close();
        setFinished(true);
      }
    };

    es.onerror = () => {
      es.close();
      setSteps(prev => [...prev, { step: 'Connection lost', error: true }]);
      setFinished(true);
    };

    return () => { es.close(); };
  }, [addLog, onSuccess]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [steps]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && finished && onClose()}>
      <div className="modal">
        <div className="modal-title">Auto-Register</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
          Creating temp email, registering, reading OTP, logging in...
        </div>
        <div className="auto-log" ref={logRef}>
          {steps.map((s, i) => (
            <div key={i} className={`auto-log-step ${s.error ? 'error' : s.done ? 'done' : 'ok'}`}>
              {s.step}
            </div>
          ))}
          {steps.length === 0 && (
            <div className="auto-log-step ok">Starting...</div>
          )}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-block btn-red" onClick={onClose} disabled={!finished}>
            {finished ? 'Close' : 'Working...'}
          </button>
        </div>
      </div>
    </div>
  );
}
