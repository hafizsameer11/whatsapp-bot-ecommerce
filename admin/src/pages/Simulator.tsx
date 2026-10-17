import { useEffect, useState } from 'react';
import { api, uploadImages } from '../api';
import ChatView, { Msg } from '../components/ChatView';

// Talk to the real bot engine as a fake customer — no WhatsApp/Meta needed.
export default function Simulator() {
  const [sid, setSid] = useState('tester1');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (r: any) => { setMsgs(r.messages); setState(r.state ?? ''); };
  const load = () => api(`/simulator/${sid}`).then(apply);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [sid]);

  const send = async (body: any) => {
    setBusy(true);
    try { apply(await api(`/simulator/${sid}/send`, { body })); } finally { setBusy(false); }
  };
  const reset = async () => { await api(`/simulator/${sid}/reset`, { body: {} }); setMsgs([]); setState(''); };

  return (
    <>
      <h1>Test chat (simulator)</h1>
      <p className="muted">Uses the exact same bot logic, menus, AI and database as WhatsApp. Orders placed here are real orders in the admin (customer id starts with <code>sim:</code>).</p>
      <div className="grid g2">
        <div className="card">
          <div className="row spread" style={{ marginBottom: 8 }}>
            <div className="row"><label style={{ margin: 0 }}>Test customer</label><input style={{ width: 140 }} value={sid} onChange={(e) => setSid(e.target.value)} /></div>
            <div className="row"><span className="small muted">state: <b>{state || '—'}</b></span><button className="small secondary" onClick={reset}>Reset chat</button></div>
          </div>
          <ChatView messages={msgs} onTap={(id, title) => !busy && send({ replyId: id, replyTitle: title })} />
          <div className="composer">
            <input value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder='Try "Hi", "blue 3 piece under 6000", "delivery charges?"'
              onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { send({ text }); setText(''); } }} />
            <button disabled={busy || !text.trim()} onClick={() => { send({ text }); setText(''); }}>{busy ? '…' : 'Send'}</button>
            <label className="btn secondary" title="Send a photo as the customer" style={{ margin: 0, fontWeight: 600 }}>📷
              <input type="file" accept="image/*,.heic" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                setBusy(true);
                try { const r = await uploadImages([f], 'chat'); await send({ imageUrl: r.urls[0], text: text || undefined }); setText(''); }
                catch (er: any) { alert(er.message); } finally { setBusy(false); }
              }} />
            </label>
          </div>
        </div>
        <div className="card">
          <h2>Things to test</h2>
          <ul className="small">
            <li>“Hi” → main menu → Browse → Lawn → Stitched → size → product → add to cart → checkout</li>
            <li>Tap an <b>old</b> “Add 1 to cart” button after moving on → should be rejected as stale</li>
            <li>Type a question in the middle of checkout (e.g. “delivery charges?”) → answered, step repeated</li>
            <li>Free text: “I need blue 3 piece under 6k”, “mujhe wedding suit chahiye” (needs OpenAI key)</li>
            <li>📷 Send a photo of a suit → AI finds similar in-stock suits (needs OpenAI key with a vision model)</li>
            <li>“agent” → bot pauses; reply from the Inbox (test chats are listed there too); type “menu” to return</li>
            <li>Edit texts/menus in <b>Bot</b> pages and type “Hi” again to see changes immediately</li>
          </ul>
        </div>
      </div>
    </>
  );
}
