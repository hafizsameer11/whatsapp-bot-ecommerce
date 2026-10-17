import { useEffect, useState } from 'react';
import { api } from '../api';
import ActionPicker, { refreshMenus } from '../components/ActionPicker';

type Item = { label: string; description: string; action: string; active?: boolean };

function ItemsEditor({ items, onChange, showActive }: { items: Item[]; onChange: (i: Item[]) => void; showActive?: boolean }) {
  const active = items.filter((i) => i.active !== false).length;
  const limit = active <= 3 ? 20 : 24;
  const upd = (n: number, k: keyof Item, v: any) => onChange(items.map((x, j) => (j === n ? { ...x, [k]: v } : x)));
  const move = (n: number, d: number) => {
    const a = [...items]; const t = a[n + d]; if (!t) return; a[n + d] = a[n]; a[n] = t; onChange(a);
  };
  return (
    <>
      <div className="alert warn small">
        {active <= 3 ? `${active} item(s) → shown as reply buttons (labels max 20 chars, descriptions not shown).`
          : `${active} items → shown as a list (labels max 24 chars, description max 72). Lists need one extra tap; 3 or fewer items feel faster.`}
      </div>
      {items.map((it, n) => (
        <div className="item-row" key={n}>
          <div>
            <input value={it.label} placeholder="Label" onChange={(e) => upd(n, 'label', e.target.value)} style={it.label.length > limit ? { borderColor: '#c0392b' } : {}} />
            <div className="small muted">{it.label.length}/{limit}</div>
          </div>
          <input value={it.description} placeholder="Description (lists only)" maxLength={72} onChange={(e) => upd(n, 'description', e.target.value)} />
          <ActionPicker value={it.action} onChange={(v) => upd(n, 'action', v)} />
          <div className="row">
            {showActive && <label className="row" style={{ margin: 0, fontWeight: 400 }}><input type="checkbox" checked={it.active !== false} onChange={(e) => upd(n, 'active', e.target.checked)} />on</label>}
            <button className="small secondary" onClick={() => move(n, -1)}>↑</button>
            <button className="small secondary" onClick={() => move(n, 1)}>↓</button>
            <button className="small danger" onClick={() => onChange(items.filter((_, j) => j !== n))}>×</button>
          </div>
        </div>
      ))}
      <button className="small secondary" onClick={() => onChange([...items, { label: '', description: '', action: 'BROWSE', active: true }])}>+ Add item</button>
    </>
  );
}

export default function BotMenus() {
  const [main, setMain] = useState<Item[]>([]);
  const [menus, setMenus] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  const load = () => { api('/bot/main-menu').then(setMain); api('/bot/menus').then(setMenus); };
  useEffect(load, []);
  const run = async (fn: () => Promise<unknown>, ok = 'Saved ✅') => {
    setMsg(null);
    try { await fn(); setMsg({ t: ok, k: 'ok' }); refreshMenus(); load(); } catch (e: any) { setMsg({ t: e.message, k: 'err' }); }
  };

  return (
    <>
      <h1>Menus & buttons</h1>
      <p className="muted">
        The shopping flow (collections → stitched/size → products → cart → checkout) is built in and always validated by the server.
        Here you control the <b>main menu</b> customers see on “Hi”, and you can build your own <b>info menus</b> (help, offers, size guide…).
        Welcome text is edited under <i>Reply texts</i>.
      </p>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <div className="card">
        <div className="row spread"><h2>Main menu</h2><button onClick={() => run(() => api('/bot/main-menu', { method: 'PUT', body: main }))}>Save main menu</button></div>
        <ItemsEditor items={main} onChange={setMain} showActive />
      </div>

      <div className="row spread"><h2>Custom menus</h2>
        <button className="secondary" onClick={() => setMenus([...menus, { title: 'New menu', body: 'Choose an option:', buttonText: 'View options', items: [], active: true }])}>+ New menu</button>
      </div>
      {menus.map((m, i) => {
        const upd = (k: string, v: any) => setMenus(menus.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
        return (
          <div className="card" key={m.id ?? `new${i}`}>
            <div className="grid g3">
              <div className="field"><label>Name (admin only)</label><input value={m.title} onChange={(e) => upd('title', e.target.value)} /></div>
              <div className="field"><label>List button text (max 20)</label><input maxLength={20} value={m.buttonText} onChange={(e) => upd('buttonText', e.target.value)} /></div>
              <div className="field"><label>Active</label><input type="checkbox" checked={m.active} onChange={(e) => upd('active', e.target.checked)} /></div>
            </div>
            <div className="field"><label>Message shown above the options</label><textarea value={m.body} onChange={(e) => upd('body', e.target.value)} /></div>
            <ItemsEditor items={m.items} onChange={(items) => upd('items', items)} />
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={() => run(() => (m.id ? api(`/bot/menus/${m.id}`, { method: 'PUT', body: m }) : api('/bot/menus', { body: m })))}>Save menu</button>
              {m.id && <button className="danger" onClick={() => confirm('Delete menu? Items pointing to it will fall back to the main menu.') && run(() => api(`/bot/menus/${m.id}`, { method: 'DELETE' }), 'Deleted')}>Delete</button>}
              {m.id && <span className="small muted">Use action “Open custom menu → {m.title}” to link it from another menu.</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
