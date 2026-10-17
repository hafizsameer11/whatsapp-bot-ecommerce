import { useEffect, useState } from 'react';
import { api } from '../api';
import ActionPicker from '../components/ActionPicker';

export default function AutoReplies() {
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  const load = () => api('/auto-replies').then(setRows);
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg({ t: 'Saved ✅', k: 'ok' }); load(); } catch (e: any) { setMsg({ t: e.message, k: 'err' }); } };
  const upd = (i: number, k: string, v: any) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      <div className="row spread"><h1>Keyword replies</h1>
        <button className="secondary" onClick={() => setRows([...rows, { keywords: '', matchType: 'CONTAINS', response: '', action: '', priority: 0, active: true }])}>+ Add rule</button></div>
      <p className="muted">Checked <b>before</b> the AI, so they are instant, free and predictable. Good for: shop location, timings, bank details, “price?” etc. Don’t use very short keywords (they match inside other words).</p>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      {rows.map((r, i) => (
        <div className="card" key={r.id ?? `n${i}`}>
          <div className="grid g3">
            <div className="field"><label>Keywords (comma separated)</label><input value={r.keywords} onChange={(e) => upd(i, 'keywords', e.target.value)} placeholder="timing, open, band" /></div>
            <div className="field"><label>Match</label>
              <select value={r.matchType} onChange={(e) => upd(i, 'matchType', e.target.value)}><option value="CONTAINS">Message contains keyword</option><option value="EXACT">Message is exactly keyword</option></select></div>
            <div className="field"><label>Priority / Active</label>
              <div className="row"><input type="number" style={{ width: 80 }} value={r.priority} onChange={(e) => upd(i, 'priority', Number(e.target.value))} />
                <input type="checkbox" checked={r.active} onChange={(e) => upd(i, 'active', e.target.checked)} /></div></div>
          </div>
          <div className="field"><label>Reply</label><textarea value={r.response} onChange={(e) => upd(i, 'response', e.target.value)} /></div>
          <div className="field"><label>Then (optional)</label>
            <div className="row"><input type="checkbox" checked={!!r.action} onChange={(e) => upd(i, 'action', e.target.checked ? 'BROWSE' : '')} />
              {r.action && <div style={{ flex: 1 }}><ActionPicker value={r.action} onChange={(v) => upd(i, 'action', v)} /></div>}</div></div>
          <div className="row">
            <button onClick={() => run(() => (r.id ? api(`/auto-replies/${r.id}`, { method: 'PUT', body: r }) : api('/auto-replies', { body: r })))}>Save</button>
            {r.id && <button className="danger" onClick={() => run(() => api(`/auto-replies/${r.id}`, { method: 'DELETE' }))}>Delete</button>}
          </div>
        </div>
      ))}
    </>
  );
}
