import { useEffect, useState } from 'react';
import { api } from '../api';

export default function BotTexts() {
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/bot/texts').then(setRows); }, []);
  const save = async () => { await api('/bot/texts', { method: 'PUT', body: rows.map(({ key, text }) => ({ key, text })) }); setMsg('Saved ✅ — changes apply to the next message.'); };
  return (
    <>
      <div className="row spread"><h1>Reply texts</h1><button onClick={save}>Save all</button></div>
      <p className="muted">Every message the bot sends. Use WhatsApp formatting: *bold*, _italic_. Variables in {'{braces}'} are filled in automatically; {'{store}'} works everywhere.</p>
      {msg && <div className="alert ok">{msg}</div>}
      <div className="card">
        {rows.map((r, i) => (
          <div className="field" key={r.key}>
            <div className="row spread">
              <label>{r.key} <span className="muted" style={{ fontWeight: 400 }}>— {r.description}</span></label>
              {r.text !== r.default && <button className="small secondary" onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, text: x.default } : x)))}>Reset</button>}
            </div>
            <textarea value={r.text} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          </div>
        ))}
      </div>
    </>
  );
}
