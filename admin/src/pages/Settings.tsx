import { useEffect, useState } from 'react';
import { api } from '../api';

const FIELDS: [string, string, string][] = [
  ['storeName', 'Store name', 'Used in {store} in texts'],
  ['currency', 'Currency label', 'e.g. PKR'],
  ['shippingFee', 'Delivery fee', 'Flat fee per order'],
  ['freeShippingOver', 'Free delivery above', '0 = never free'],
  ['serviceableCities', 'Cities you deliver to', 'Comma separated. Empty = everywhere'],
  ['resultsPerPage', 'Products per page (1-5)', 'Each product is one WhatsApp message — keep it low'],
  ['lowStockThreshold', 'Low stock warning at', 'Shows “only N left” and dashboard alert'],
  ['maxQtyPerItem', 'Max quantity per item', 'Limits fake/bulk COD orders'],
];

export default function Settings() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nu, setNu] = useState({ email: '', name: '', password: '', role: 'STAFF' });
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  const load = () => { api('/settings').then((r) => setS(r.settings)); api('/users').then(setUsers).catch(() => setUsers([])); };
  useEffect(load, []);
  const run = async (fn: () => Promise<unknown>) => { setMsg(null); try { await fn(); setMsg({ t: 'Saved ✅', k: 'ok' }); load(); } catch (e: any) { setMsg({ t: e.message, k: 'err' }); } };
  if (!s) return <div>Loading…</div>;
  return (
    <>
      <div className="row spread"><h1>Store settings</h1>
        <button onClick={() => run(() => api('/settings', { method: 'PUT', body: Object.fromEntries(FIELDS.map(([k]) => [k, s[k]]).concat([['codEnabled', s.codEnabled]])) }))}>Save</button></div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <div className="card grid g2">
        {FIELDS.map(([k, l, h]) => (
          <div className="field" key={k}><label>{l}</label><input value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} /><div className="small muted">{h}</div></div>
        ))}
        <div className="field"><label>Accept orders (Cash on Delivery)</label>
          <select value={s.codEnabled} onChange={(e) => setS({ ...s, codEnabled: e.target.value })}><option value="true">Yes</option><option value="false">No — pause ordering</option></select></div>
      </div>

      <div className="card">
        <h2>Team</h2>
        <p className="small muted">OWNER: everything. STAFF: products, orders, bot. AGENT: inbox & simulator only.</p>
        <table><tbody>
          {users.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td>
              <td><button className="small danger" onClick={() => confirm('Remove user?') && run(() => api(`/users/${u.id}`, { method: 'DELETE' }))}>Remove</button></td></tr>
          ))}
        </tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input style={{ width: 160 }} placeholder="Name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <input style={{ width: 200 }} placeholder="Email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <input style={{ width: 160 }} type="password" placeholder="Password (8+)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <select style={{ width: 120 }} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}><option>STAFF</option><option>AGENT</option><option>OWNER</option></select>
          <button onClick={() => run(async () => { await api('/users', { body: nu }); setNu({ email: '', name: '', password: '', role: 'STAFF' }); })}>Add user</button>
        </div>
      </div>
    </>
  );
}
