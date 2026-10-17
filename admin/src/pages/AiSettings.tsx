import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AiSettings() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  useEffect(() => {
    api('/settings').then((r) => { setS(r.settings); setTools(r.tools); });
    api('/status').then(setStatus);
  }, []);
  if (!s) return <div>Loading…</div>;
  const enabled = new Set(s.aiTools.split(',').filter(Boolean));
  const toggle = (n: string) => { enabled.has(n) ? enabled.delete(n) : enabled.add(n); setS({ ...s, aiTools: [...enabled].join(',') }); };
  const save = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { aiEnabled: s.aiEnabled, aiModel: s.aiModel, aiSystemPrompt: s.aiSystemPrompt, aiTools: s.aiTools } });
      setMsg({ t: 'Saved ✅', k: 'ok' });
    } catch (e: any) { setMsg({ t: e.message, k: 'err' }); }
  };
  return (
    <>
      <div className="row spread"><h1>AI settings</h1><button onClick={save}>Save</button></div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      {status && !status.aiConfigured && <div className="alert warn">OPENAI_API_KEY is not set in server/.env — the bot will use keyword search and menus only.</div>}
      <div className="card">
        <p className="muted small">
          Order of handling for typed messages: <b>expected step input</b> (e.g. address) → <b>keyword replies</b> → <b>AI</b> → keyword product search → fallback menu.
          Button taps never go to the AI. The AI can only use the tools below, and cannot change prices, place or confirm orders, or mark payments.
        </p>
        <div className="grid g2">
          <div className="field"><label>AI replies</label>
            <select value={s.aiEnabled} onChange={(e) => setS({ ...s, aiEnabled: e.target.value })}><option value="true">On</option><option value="false">Off (menus only)</option></select></div>
          <div className="field"><label>OpenAI model</label><input value={s.aiModel} onChange={(e) => setS({ ...s, aiModel: e.target.value })} />
            <div className="small muted">Must support tool/function calling. Check your OpenAI dashboard for current model names and prices.</div></div>
        </div>
        <div className="field"><label>Brand voice / instructions</label>
          <textarea style={{ minHeight: 120 }} value={s.aiSystemPrompt} onChange={(e) => setS({ ...s, aiSystemPrompt: e.target.value })} />
          <div className="small muted">Safety rules (no invented products/prices, no order confirmation) are always added by the server and can’t be removed here.</div></div>
      </div>
      <div className="card">
        <h2>Tools the AI may use</h2>
        <table><tbody>
          {tools.map((t) => (
            <tr key={t.name}>
              <td><input type="checkbox" checked={enabled.has(t.name)} onChange={() => toggle(t.name)} /></td>
              <td><code>{t.name}</code> {t.sideEffect && <span className="pill DRAFT">changes data</span>}</td>
              <td className="small muted">{t.description}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </>
  );
}
