import { useEffect, useRef, useState } from 'react';

export type Msg = { id: number; direction: 'IN' | 'OUT'; sender: string; type: string; body: string; payloadJson: string; status: string; error?: string | null; createdAt: string };

/** Minimal WhatsApp formatting: *bold* and _italic_. */
function Wa({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return <>{parts.map((p, i) => p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b>
    : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : p)}</>;
}

type Props = { messages: Msg[]; onTap?: (id: string, title: string) => void };

/** Renders stored messages like WhatsApp. In the simulator, buttons and list rows are clickable. */
export default function ChatView({ messages, onTap }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openList, setOpenList] = useState<number | null>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [messages.length]);

  return (
    <div className="chat" ref={ref}>
      {messages.map((m) => {
        let p: any = {};
        try { p = JSON.parse(m.payloadJson); } catch { /* */ }
        const cls = `bubble ${m.direction === 'IN' ? 'in' : 'out'} ${m.sender === 'agent' ? 'agent' : ''}`;
        const meta = (
          <div className="meta">
            {m.sender !== 'customer' && `${m.sender} · `}{new Date(m.createdAt).toLocaleTimeString()}
            {m.direction === 'OUT' && ` · ${m.status}`}
            {m.error && <div style={{ color: '#c0392b' }}>{m.error}</div>}
          </div>
        );
        if (m.direction === 'IN') return <div key={m.id} className={cls}>{p.imageUrl ? <><img src={p.imageUrl} alt="customer photo" />{p.text}</> : m.body}{meta}</div>;
        if (p.type === 'image') return <div key={m.id} className={cls}><img src={p.url} alt="" /><Wa text={p.caption} />{meta}</div>;
        if (p.type === 'buttons')
          return (
            <div key={m.id} className={cls}>
              {p.headerImage && <img src={p.headerImage} alt="" />}
              {p.headerText && <div className="header">{p.headerText}</div>}
              <Wa text={p.body} />
              {p.footer && <div className="small muted">{p.footer}</div>}
              <div className="wa-btns">
                {p.buttons.map((b: any) => <button key={b.id} disabled={!onTap} onClick={() => onTap?.(b.id, b.title)}>{b.title}</button>)}
              </div>
              {meta}
            </div>
          );
        if (p.type === 'list')
          return (
            <div key={m.id} className={cls}>
              {p.headerText && <div className="header">{p.headerText}</div>}
              <Wa text={p.body} />
              <div className="wa-btns"><button onClick={() => setOpenList(openList === m.id ? null : m.id)}>☰ {p.buttonText}</button></div>
              {openList === m.id && (
                <div className="wa-list">
                  {p.sections.map((s: any, i: number) => (
                    <div key={i}>
                      <div className="sec">{s.title}</div>
                      {s.rows.map((r: any) => (
                        <div key={r.id} className="rowi" onClick={() => { if (onTap) { setOpenList(null); onTap(r.id, r.title); } }}>
                          <div>{r.title}</div>
                          {r.description && <div className="small muted">{r.description}</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {meta}
            </div>
          );
        return <div key={m.id} className={cls}><Wa text={p.text ?? m.body} />{meta}</div>;
      })}
    </div>
  );
}
