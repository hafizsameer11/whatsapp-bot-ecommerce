import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, dt, fmt } from '../api';

const STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export default function Orders() {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(params.get('open') ? Number(params.get('open')) : null);
  const load = () => api(`/orders?status=${status}&q=${encodeURIComponent(q)}`).then(setRows);
  useEffect(() => { load(); }, [status]);

  const exportCsv = () => {
    const head = ['orderNo', 'date', 'status', 'name', 'phone', 'city', 'address', 'total', 'courier', 'trackingNo'];
    const csv = [head.join(','), ...rows.map((o) => head.map((h) => `"${String(h === 'date' ? o.createdAt : o[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <h1>Orders</h1>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input placeholder="Order no, name, phone, city" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="secondary" onClick={load}>Search</button>
        <button className="secondary" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className={open ? 'grid g2' : ''}>
        <div className="card">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="click" onClick={() => setOpen(o.id)} style={open === o.id ? { background: '#f0fdfa' } : {}}>
                  <td><b>{o.orderNo}</b><div className="small muted">{dt(o.createdAt)}</div></td>
                  <td>{o.name}<div className="small muted">{o.city} · {o.phone}</div></td>
                  <td>{fmt(o.total)}<div className="small muted">{o.paymentMethod}</div></td>
                  <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="muted">No orders.</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <OrderDetail id={open} onChange={load} onClose={() => setOpen(null)} />}
      </div>
    </>
  );
}

function OrderDetail({ id, onChange, onClose }: { id: number; onChange: () => void; onClose: () => void }) {
  const [o, setO] = useState<any>(null);
  const [form, setForm] = useState({ status: '', courier: '', trackingNo: '', notes: '', notify: true });
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);
  const load = () => api(`/orders/${id}`).then((r) => { setO(r); setForm({ status: r.status, courier: r.courier, trackingNo: r.trackingNo, notes: r.notes, notify: true }); });
  useEffect(() => { setMsg(null); load(); }, [id]);
  if (!o) return <div className="card">Loading…</div>;
  const save = async () => {
    if (form.status === 'CANCELLED' && o.status !== 'CANCELLED' && !confirm('Cancel order? Stock will be returned.')) return;
    try {
      const r = await api(`/orders/${id}`, { method: 'PUT', body: form });
      setMsg({ t: `Saved. ${r.notice}`, k: r.notice.includes('not notified') ? 'warn' : 'ok' });
      load(); onChange();
    } catch (e: any) { setMsg({ t: e.message, k: 'err' }); }
  };
  return (
    <div className="card">
      <div className="row spread"><h2>{o.orderNo}</h2><button className="small secondary" onClick={onClose}>Close</button></div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}
      <p><b>{o.name}</b> · {o.phone}<br />{o.address}, {o.city}<br /><span className="small muted">WhatsApp: {o.customer.waId}</span></p>
      <table><tbody>
        {o.items.map((i: any) => (
          <tr key={i.id}><td>{i.title}<div className="small muted">{i.sku} · {[i.size, i.color].filter(Boolean).join(' / ')}</div></td><td>× {i.quantity}</td><td>{fmt(i.unitPrice * i.quantity)}</td></tr>
        ))}
        <tr><td>Subtotal</td><td></td><td>{fmt(o.subtotal)}</td></tr>
        <tr><td>Delivery</td><td></td><td>{fmt(o.shippingFee)}</td></tr>
        <tr><td><b>Total ({o.paymentMethod}, {o.paymentStatus})</b></td><td></td><td><b>{fmt(o.total)}</b></td></tr>
      </tbody></table>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <div className="field"><label>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={o.status === 'CANCELLED'}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <div className="field"><label>Courier</label><input value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} placeholder="TCS / Leopards / M&P" /></div>
        <div className="field"><label>Tracking number</label><input value={form.trackingNo} onChange={(e) => setForm({ ...form, trackingNo: e.target.value })} /></div>
        <div className="field"><label>Internal notes</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <label className="row" style={{ fontWeight: 400 }}>
        <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
        Notify customer on WhatsApp {o.inServiceWindow ? '(within 24h window ✅)' : '(⚠️ outside 24h window — needs approved template)'}
      </label>
      <button style={{ marginTop: 10 }} onClick={save}>Save changes</button>
    </div>
  );
}
