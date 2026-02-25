import { useState } from 'react';
import { api } from '../api';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  addLog: (msg: string) => void;
}

export default function LoginModal({ onClose, onSuccess, addLog }: Props) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    if (!email) return;
    setLoading(true);
    setStatus('Sending OTP...');
    try {
      const res = await api.requestOtp(email);
      if (res.userNotFound) {
        setStatus('Account not found. Registering...');
        const regRes = await api.register(email);
        if (regRes.ok) {
          setStatus('Registered! Sending OTP...');
          await api.requestOtp(email);
          setStatus('OTP sent! Check your email.');
        } else {
          setStatus(`Registration failed: ${regRes.error}`);
        }
      } else if (res.ok) {
        setStatus('OTP sent! Check your email.');
      } else {
        setStatus(`Error: ${res.error || 'unknown'}`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  };

  const submitLogin = async () => {
    if (!email || !otp) return;
    setLoading(true);
    setStatus('Logging in...');
    try {
      const res = await api.login(email, otp);
      if (res.ok) {
        addLog(`Logged in as ${email}`);
        onSuccess();
      } else {
        setStatus(`Failed: ${res.error || 'unknown'}`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">Login</div>
        <div className="modal-field">
          <label className="input-label">Email</label>
          <input
            className="input"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendOtp()}
          />
        </div>
        <div className="row">
          <button className="btn btn-block btn-cyan" onClick={sendOtp} disabled={loading || !email}>
            Send OTP
          </button>
        </div>
        <div className="modal-field" style={{ marginTop: 14 }}>
          <label className="input-label">OTP Code</label>
          <input
            className="input"
            type="text"
            placeholder="6-digit code"
            maxLength={6}
            value={otp}
            onChange={e => setOtp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitLogin()}
          />
        </div>
        <div className="row">
          <button className="btn btn-block btn-green" onClick={submitLogin} disabled={loading || !email || !otp}>
            Login
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-block btn-red" onClick={onClose}>Cancel</button>
        </div>
        {status && (
          <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
