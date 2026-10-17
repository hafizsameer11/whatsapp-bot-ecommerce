import { useState } from 'react';
import { download, postFile } from '../api';

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [stockMode, setStockMode] = useState<'set' | 'add'>('set');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const dl = async (path: string, name: string) => { setErr(''); try { await download(path, name); } catch (e: any) { setErr(e.message); } };
  const check = async (f: File) => {
    setFile(f); setPreview(null); setResult(null); setErr(''); setBusy('Checking file…');
    const r = await postFile('/products-import', f);
    setBusy('');
    if (!r.ok && !r.summary) return setErr(r.error);
    setPreview(r);
  };
  const apply = async () => {
    if (!file) return;
    setBusy(`Importing… downloading and optimising ${preview?.summary?.imageLinks ?? 0} image link(s), this can take a minute.`); setErr('');
    const r = await postFile(`/products-import?apply=1&stockMode=${stockMode}`, file);
    setBusy('');
    if (!r.ok) { setErr(r.error); if (r.summary) setPreview(r); return; }
    setResult(r); setPreview(null); setFile(null);
  };
  const s = preview?.summary;

  return (
    <>
      <h1>Import / export products</h1>
      <div className="grid g2">
        <div className="card">
          <h2>1. Get the spreadsheet</h2>
          <p className="small muted">One row per SKU (each colour/size). Rows with the same <code>product_code</code> become one product. Open in Excel or Google Sheets.</p>
          <div className="row">
            <button className="secondary" onClick={() => dl('/products-export?template=1', 'products-template.xlsx')}>Download template (.xlsx)</button>
            <button className="secondary" onClick={() => dl('/products-export', `products-${new Date().toISOString().slice(0, 10)}.xlsx`)}>Export current catalog (.xlsx)</button>
            <button className="secondary" onClick={() => dl('/products-export?format=csv', `products-${new Date().toISOString().slice(0, 10)}.csv`)}>Export (.csv)</button>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Tip: export your catalog, edit prices/stock in Excel, and import it back. Products match by <code>product_code</code>, variants by <code>sku</code>.
            SKUs missing from the file are <b>not</b> deleted. For a stock-only update a file with just <code>product_code, sku, stock</code> works.
          </p>
        </div>
        <div className="card">
          <h2>2. Upload &amp; check</h2>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); e.target.value = ''; }} />
          <div className="field" style={{ marginTop: 12 }}>
            <label>The stock column should…</label>
            <select value={stockMode} onChange={(e) => setStockMode(e.target.value as any)}>
              <option value="set">Replace stock (I counted my stock — set to this number)</option>
              <option value="add">Add to stock (new shipment arrived — add this number)</option>
            </select>
          </div>
          <p className="small muted">Image links must be public (Google Drive: share → “Anyone with the link”). They are downloaded once and optimised for WhatsApp.</p>
        </div>
      </div>

      {busy && <div className="alert warn">{busy}</div>}
      {err && <div className="alert err">{err}</div>}

      {preview && (
        <div className="card">
          <h2>Preview — {file?.name} ({preview.rows} rows)</h2>
          <div className="grid g4">
            <div className="stat"><div className="n">{s.productsNew}</div><div className="l">new products</div></div>
            <div className="stat"><div className="n">{s.productsUpdated}</div><div className="l">products updated</div></div>
            <div className="stat"><div className="n">{s.variantsNew} / {s.variantsUpdated}</div><div className="l">SKUs new / updated</div></div>
            <div className="stat"><div className="n">{s.imageLinks}</div><div className="l">image links</div></div>
          </div>
          {s.newCategories.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>New categories will be created: {s.newCategories.join(', ')}</div>}
          {preview.errorCount > 0 && (
            <div className="alert err" style={{ marginTop: 10 }}>
              <b>{preview.errorCount} error(s) — nothing will be imported until they are fixed:</b>
              <ul className="small">{preview.errors.map((e: any, i: number) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="alert warn small"><b>Warnings</b><ul>{preview.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>
          )}
          <table>
            <thead><tr><th>Code</th><th>Title</th><th>Action</th><th>SKUs</th><th>Images</th></tr></thead>
            <tbody>{preview.products.map((p: any) => <tr key={p.code}><td><code>{p.code}</code></td><td>{p.title}</td><td><span className={`pill ${p.action === 'create' ? 'ACTIVE' : 'CONFIRMED'}`}>{p.action}</span></td><td>{p.variants}</td><td>{p.images}</td></tr>)}</tbody>
          </table>
          <button style={{ marginTop: 12 }} disabled={preview.errorCount > 0 || !!busy} onClick={apply}>Import now</button>
        </div>
      )}

      {result && (
        <div className="card">
          <div className="alert ok">✅ Imported: {result.summary.productsNew} new and {result.summary.productsUpdated} updated products, {result.summary.variantsNew + result.summary.variantsUpdated} SKUs, {result.imagesDownloaded} images downloaded.</div>
          {result.warnings.length > 0 && <div className="alert warn small"><b>Warnings</b><ul>{result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>}
        </div>
      )}
    </>
  );
}
