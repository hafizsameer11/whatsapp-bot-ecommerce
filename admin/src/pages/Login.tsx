import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, auth } from '../api';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('/auth/login', { body: { email, password } });
      auth.set(r.token);
      nav('/');
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>🛍️ Store Admin</h1>
      {err && <div className="alert err">{err}</div>}
      <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></div>
      <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button style={{ width: '100%' }}>Log in</button>
    </form>
  );
}
