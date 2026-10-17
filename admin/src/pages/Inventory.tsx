import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt } from '../api';

const REASON: Record<string, string> = {
  ORDER: '🛒 Order', CANCEL: '↩️ Cancelled order', ADJUST: '✏️ Adjustment', COUNT: '📋 Stock count', EDIT: '📝 Product edit',
  IMPORT: '📥 Import', INITIAL: '🆕 Opening stock',
};

export default function Inventory() {
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [data, setData] = useState<any>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<{ id: number; mode: 'add' | 'remove' | 'set'; qty: string; note: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<any | null>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ t: string; k: string } | null>(null);

  const load = () => api(`/inventory?q=${encodeURIComponent(q)}&filter=${filter}`).then(setData);
  const loadMoves = (variantId?: number) => api(`/inventory/movements${variantId ? `?variantId=${variantId}` : '?limit=300'}`).then(setMoves);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { if (tab === 'history') loadMoves(historyFor?.id); }, [tab, historyFor]);

  const saveAdjust = async () => {
    if (!edit) return;
    setMsg(null);
    try {
      const v = await api('/inventory/adjust', { body: { variantId: edit.id, mode: edit.mode, qty: Number(edit.qty), note: edit.note } });
      setMsg({ t: `Stock updated → ${v.stock}`, k: 'ok' });
      setEdit(null); load();
    } catch (e: any) { setMsg({ t: e.message, k: 'err' }); }
  };

  return (
    <>
      <h1>Inventory</h1>
      <div className="tabs">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => { setTab('stock'); setHistoryFor(null); }}>Stock levels</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History{historyFor ? `: ${historyFor.sku}` : ''}</button>
      </div>
      {msg && <div className={`alert ${msg.k}`}>{msg.t}</div>}

      {tab === 'stock' && (
        <>
          {data && (
            <div className="grid g3">
              <div className="card stat"><div className="n">{data.totalUnits}</div><div className="l">Units in stock (active SKUs)</div></div>
              <div className="card stat"><div className="n">{data.totalSkus}</div><div className="l">Active SKUs</div></div>
              <div className="card stat"><div className="n">≤ {data.lowThreshold}</div><div className="l">Low-stock threshold (Store settings)</div></div>
            </div>
          )}
          <div className="toolbar">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All SKUs</option><option value="low">Low stock</option><option value="out">Out of stock</option>
            </select>
            <input placeholder="Search SKU, product, colour" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <button className="secondary" onClick={load}>Search</button>
            <Link to="/import" className="btn secondary">Bulk update from Excel</Link>
          </div>
          <div className="card">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>Option</th><th>Stock</th><th></th></tr></thead>
              <tbody>
                {data?.variants.map((v: any) => (
                  <tr key={v.id} style={!v.active || v.product.status !== 'ACTIVE' ? { opacity: 0.55 } : {}}>
                    <td><Link to={`/products/${v.productId}`}>{v.product.title}</Link><div className="small muted">{v.product.category.name}{v.product.status !== 'ACTIVE' ? ` · ${v.product.status}` : ''}{!v.active ? ' · SKU off' : ''}</div></td>
                    <td><code>{v.sku}</code></td>
                    <td>{[v.size, v.color].filter(Boolean).join(' / ')}</td>
                    <td><b style={{ color: v.stock === 0 ? '#c0392b' : v.stock <= data.lowThreshold ? '#b7791f' : undefined }}>{v.stock}</b></td>
                    <td>
                      {edit?.id === v.id ? (
                        <div className="row">
                          <select style={{ width: 110 }} value={edit!.mode} onChange={(e) => setEdit({ ...edit!, mode: e.target.value as any })}>
                            <option value="add">Add (+)</option><option value="remove">Remove (−)</option><option value="set">Set to (count)</option>
                          </select>
                          <input style={{ width: 70 }} type="number" min={0} autoFocus value={edit!.qty} onChange={(e) => setEdit({ ...edit!, qty: e.target.value })} />
                          <input style={{ width: 180 }} placeholder="Reason (e.g. new shipment, damaged)" value={edit!.note} onChange={(e) => setEdit({ ...edit!, note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveAdjust()} />
                          <button className="small" disabled={edit!.qty === ''} onClick={saveAdjust}>Save</button>
                          <button className="small secondary" onClick={() => setEdit(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="row">
                          <button className="small secondary" onClick={() => setEdit({ id: v.id, mode: 'add', qty: '', note: '' })}>Adjust</button>
                          <button className="small secondary" onClick={() => { setHistoryFor(v); setTab('history'); }}>History</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {data && !data.variants.length && <tr><td colSpan={5} className="muted">Nothing found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="card">
          {historyFor && <div className="row spread" style={{ marginBottom: 8 }}><div><b>{historyFor.product.title}</b> · {historyFor.sku} · now <b>{historyFor.stock}</b></div><button className="small secondary" onClick={() => setHistoryFor(null)}>Show all SKUs</button></div>}
          <table>
            <thead><tr><th>When</th><th>SKU</th><th>Change</th><th>Stock after</th><th>Reason</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="small">{dt(m.createdAt)}</td>
                  <td><code>{m.variant.sku}</code><div className="small muted">{m.variant.product.title}</div></td>
                  <td style={{ color: m.delta < 0 ? '#c0392b' : '#15803d', fontWeight: 700 }}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                  <td>{m.stockAfter ?? '—'}</td>
                  <td>{REASON[m.reason] ?? m.reason}</td>
                  <td className="small">{m.by || '—'}</td>
                  <td className="small">{m.note}</td>
                </tr>
              ))}
              {!moves.length && <tr><td colSpan={7} className="muted">No stock movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
