import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmt } from '../api';

export default function Products() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const load = () => api(`/products?q=${encodeURIComponent(q)}`).then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="row spread"><h1>Products</h1>
        <div className="row"><Link className="btn secondary" to="/import">Import from Excel</Link><Link className="btn" to="/products/new">+ Add product</Link></div></div>
      <div className="toolbar">
        <input placeholder="Search title, tag or SKU" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="secondary" onClick={load}>Search</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th></th><th>Product</th><th>Category</th><th>Type</th><th>Variants</th><th>Stock</th><th>From</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/products/${p.id}`)}>
                <td>{p.images[0] && <img className="thumb" src={p.images[0].url} alt="" />}</td>
                <td><b>{p.title}</b><div className="small muted">{p.fabric} · {p.piecesCount}-piece</div></td>
                <td>{p.category?.name}</td>
                <td>{p.stitchingType === 'STITCHED' ? 'Stitched' : 'Unstitched'}</td>
                <td>{p.variantCount}</td>
                <td style={{ color: p.totalStock ? undefined : '#c0392b' }}>{p.totalStock}</td>
                <td>{Number.isFinite(p.minPrice) ? fmt(p.minPrice) : '-'}</td>
                <td><span className={`pill ${p.status}`}>{p.status}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">No products.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
