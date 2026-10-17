import { useEffect, useState } from 'react';
import { api, dt, fmt } from '../api';
import ChatView from '../components/ChatView';

export default function Inbox() {
  const [list, setList] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  const loadList = () => api(`/conversations?filter=${filter}`).then(setList);
  const loadChat = (id = sel) => id && api(`/conversations/${id}/messages`).then(setData);
  useEffect(() => { loadList(); const t = setInterval(loadList, 8000); return () => clearInterval(t); }, [filter]);
  useEffect(() => { loadChat(); const t = setInterval(() => loadChat(), 4000); return () => clearInterval(t); }, [sel]);

  const send = async () => {
    if (!text.trim() || !sel) return;
    setErr('');
    try { await api(`/conversations/${sel}/reply`, { body: { text } }); setText(''); loadChat(); }
    catch (e: any) { setErr(e.message); }
  };
  const setBot = async (paused: boolean) => { await api(`/conversations/${sel}/bot`, { body: { paused } }); loadChat(); loadList(); };
  const c = data?.conversation;

  return (
    <>
      <h1>Inbox</h1>
      <div className="inbox">
        <div className="card" style={{ padding: 0, maxHeight: '75vh', overflowY: 'auto' }}>
          <div className="tabs" style={{ padding: '8px 8px 0' }}>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'human' ? 'on' : ''} onClick={() => setFilter('human')}>Needs agent</button>
          </div>
          {list.map((x) => (
            <div key={x.id} className={`convo ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
              <div className="row spread"><b>{x.needsHuman && <span className="dot" />}{x.customer.name ?? x.customer.waId}{x.customer.waId.startsWith('sim:') && <span className="pill" style={{ marginLeft: 6 }}>test</span>}</b><span className="small muted">{new Date(x.updatedAt).toLocaleTimeString()}</span></div>
              <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.lastMessage?.body}</div>
              <div className="small">{x.botPaused ? '🧑 Agent' : '🤖 Bot'} · {x.state}</div>
            </div>
          ))}
          {!list.length && <div className="muted" style={{ padding: 12 }}>No chats yet.</div>}
        </div>

        <div className="card">
          {!c ? <div className="muted">Select a conversation.</div> : (
            <>
              <div className="row spread" style={{ marginBottom: 8 }}>
                <div><b>{c.customer.name}</b> <span className="muted">+{c.customer.waId}</span></div>
                <div className="row">
                  {c.botPaused
                    ? <button className="small" onClick={() => setBot(false)}>Hand back to bot</button>
                    : <button className="small secondary" onClick={() => setBot(true)}>Take over (pause bot)</button>}
                </div>
              </div>
              {!c.inServiceWindow && <div className="alert warn">Outside the 24-hour window: free-text replies will be rejected by WhatsApp. Use an approved template.</div>}
              {err && <div className="alert err">{err}</div>}
              <ChatView messages={data.messages} />
              <div className="composer">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a reply (sending pauses the bot for this chat)" />
                <button onClick={send}>Send</button>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Customer</h2>
          {c ? (
            <>
              <div className="small">Bot step: <b>{c.state}</b></div>
              <div className="small">First seen: {dt(c.customer.createdAt)}</div>
              <h2 style={{ marginTop: 14 }}>Orders</h2>
              {data.orders.map((o: any) => <div key={o.id} className="small" style={{ marginBottom: 6 }}><b>{o.orderNo}</b> · <span className={`pill ${o.status}`}>{o.status}</span><br />{fmt(o.total)}</div>)}
              {!data.orders.length && <div className="small muted">No orders.</div>}
            </>
          ) : <div className="muted small">—</div>}
        </div>
      </div>
    </>
  );
}
