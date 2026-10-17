import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Categories() {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const load = () => api('/categories').then(setRows);
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e: any) { setErr(e.message); } };
  return (
    <>
      <h1>Categories (collections)</h1>
      <p className="muted">Shown to customers as a list. Only categories with in-stock products appear in the bot. Max 9 shown — keep the list short.</p>
      {err && <div className="alert err">{err}</div>}
      <div className="card">
        <div className="toolbar">
          <input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          <button onClick={() => run(async () => { await api('/categories', { body: { name, sortOrder: rows.length } }); setName(''); })}>Add</button>
        </div>
        <table>
          <thead><tr><th>Name (max 24 chars)</th><th>Order</th><th>Products</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id}>
                <td><input value={c.name} maxLength={24} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} /></td>
                <td><input type="number" style={{ width: 70 }} value={c.sortOrder} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, sortOrder: Number(e.target.value) } : r)))} /></td>
                <td>{c._count.products}</td>
                <td><input type="checkbox" checked={c.active} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, active: e.target.checked } : r)))} /></td>
                <td className="row">
                  <button className="small" onClick={() => run(() => api(`/categories/${c.id}`, { method: 'PUT', body: c }))}>Save</button>
                  <button className="small danger" onClick={() => confirm('Delete category?') && run(() => api(`/categories/${c.id}`, { method: 'DELETE' }))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
