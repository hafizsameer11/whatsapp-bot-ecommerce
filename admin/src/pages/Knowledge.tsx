import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Knowledge() {
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  const load = () => api('/knowledge').then(setRows);
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setMsg({ t: 'Saved ✅', k: 'ok' }); load(); } catch (e: any) { setMsg({ t: e.message, k: 'err' }); } };
  const upd = (i: number, k: string, v: any) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      <div className="row spread"><h1>Knowledge / FAQ</h1>
        <button className="secondary" onClick={() => setRows([...rows, { question: '', answer: '', tags: '', active: true }])}>+ Add entry</button></div>
      <p className="muted">The AI answers policy questions <b>only</b> from these entries (delivery, exchange, size chart, care…). Also shown as a list if a menu item uses the “FAQ list” action. Keep answers factual — the AI will rephrase them.</p>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      {rows.map((r, i) => (
        <div className="card" key={r.id ?? `n${i}`}>
          <div className="grid g2">
            <div className="field"><label>Question (max 24 chars shown in FAQ list)</label><input value={r.question} onChange={(e) => upd(i, 'question', e.target.value)} /></div>
            <div className="field"><label>Tags (help the AI find it)</label><input value={r.tags} onChange={(e) => upd(i, 'tags', e.target.value)} /></div>
          </div>
          <div className="field"><label>Answer</label><textarea value={r.answer} onChange={(e) => upd(i, 'answer', e.target.value)} /></div>
          <div className="row">
            <label className="row" style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" checked={r.active} onChange={(e) => upd(i, 'active', e.target.checked)} /> Active</label>
            <button onClick={() => run(() => (r.id ? api(`/knowledge/${r.id}`, { method: 'PUT', body: r }) : api('/knowledge', { body: r })))}>Save</button>
            {r.id && <button className="danger" onClick={() => run(() => api(`/knowledge/${r.id}`, { method: 'DELETE' }))}>Delete</button>}
          </div>
        </div>
      ))}
    </>
  );
}
