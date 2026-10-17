import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadImages } from '../api';

type V = {
  id?: number; sku: string; color: string; size: string | null; price: number | ''; salePrice: number | '' | null;
  stock: number | ''; stockLoaded?: number; active: boolean;
};
type Img = { url: string; color: string | null; sourceUrl?: string };
const empty = {
  code: '', title: '', description: '', fabric: '', piecesCount: 3, stitchingType: 'UNSTITCHED', occasion: '', tags: '',
  status: 'DRAFT', categoryId: '' as number | '', images: [] as Img[], variants: [] as V[],
};

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const [p, setP] = useState(empty);
  const [cats, setCats] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [gen, setGen] = useState({ colors: '', sizes: 'S,M,L,XL', price: '', stock: '' });
  const [imgUrl, setImgUrl] = useState('');

  const fromServer = (r: any) => setP({
    ...r, code: r.code ?? '',
    images: r.images.map((i: any) => ({ url: i.url, color: i.color, sourceUrl: i.sourceUrl })),
    variants: r.variants.map((v: any) => ({ ...v, salePrice: v.salePrice ?? '', stockLoaded: v.stock })),
  });
  useEffect(() => {
    api('/categories').then(setCats);
    if (!isNew) api(`/products/${id}`).then(fromServer).catch((e) => setErr(e.message));
  }, [id]);

  const set = (k: string, v: any) => setP((x) => ({ ...x, [k]: v }));
  const setV = (i: number, k: keyof V, v: any) => setP((x) => ({ ...x, variants: x.variants.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const setImg = (i: number, patch: Partial<Img>) => setP((x) => ({ ...x, images: x.images.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const moveImg = (i: number, to: number) => setP((x) => {
    if (to < 0 || to >= x.images.length) return x;
    const a = [...x.images]; const [it] = a.splice(i, 1); a.splice(to, 0, it); return { ...x, images: a };
  });
  const stitched = p.stitchingType === 'STITCHED';
  const coverIdx = Math.max(0, p.images.findIndex((im) => !im.color));
  const colors = [...new Set(p.variants.map((v) => v.color.trim()).filter(Boolean))];

  const generate = () => {
    const cs = gen.colors.split(',').map((s) => s.trim()).filter(Boolean);
    const sizes = stitched ? gen.sizes.split(',').map((s) => s.trim()).filter(Boolean) : [null];
    if (!cs.length) return setErr('Enter at least one colour to generate variants');
    const base = (p.code || p.title || 'SKU').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8);
    const existing = new Set(p.variants.map((v) => `${v.color.toLowerCase()}|${(v.size ?? '').toLowerCase()}`));
    const add: V[] = [];
    for (const c of cs) for (const s of sizes) {
      if (existing.has(`${c.toLowerCase()}|${(s ?? '').toLowerCase()}`)) continue;
      add.push({ sku: `${base}-${c.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6)}${s ? '-' + s.toUpperCase() : ''}`, color: c, size: s, price: Number(gen.price) || '', salePrice: '', stock: Number(gen.stock) || 0, active: true });
    }
    set('variants', [...p.variants, ...add]);
    setErr('');
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(`Uploading & optimising ${files.length} photo(s)…`); setErr('');
    try {
      const r = await uploadImages([...files]);
      setP((x) => ({ ...x, images: [...x.images, ...r.urls.map((url: string) => ({ url, color: null }))] }));
      if (r.errors.length) setErr(r.errors.join('; '));
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };
  const addUrl = async () => {
    if (!imgUrl.trim()) return;
    setBusy('Downloading photo…'); setErr('');
    try {
      const r = await api('/images/import-url', { body: { url: imgUrl } });
      setP((x) => ({ ...x, images: [...x.images, { url: r.url, color: null, sourceUrl: r.sourceUrl }] }));
      setImgUrl('');
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  };

  const save = async () => {
    setErr(''); setMsg('');
    try {
      const body = { ...p, variants: p.variants.map((v) => ({ ...v, salePrice: v.salePrice || null })) };
      const r = isNew ? await api('/products', { body }) : await api(`/products/${id}`, { method: 'PUT', body });
      setMsg('Saved ✅');
      if (isNew) nav(`/products/${r.id}`, { replace: true });
      else api(`/products/${id}`).then(fromServer);
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!confirm('Delete this product? If it has sales or stock history it will be archived instead, so reports stay correct.')) return;
    await api(`/products/${id}`, { method: 'DELETE' });
    nav('/products');
  };

  return (
    <>
      <div className="row spread">
        <h1>{isNew ? 'New product' : p.title}</h1>
        <div className="row">{!isNew && <button className="danger" onClick={remove}>Delete</button>}<button onClick={save}>Save</button></div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}
      {busy && <div className="alert warn">{busy}</div>}
      <div className="grid g2">
        <div className="card">
          <div className="grid g2">
            <div className="field"><label>Title</label><input value={p.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="field"><label>Product code (for Excel import)</label><input value={p.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. ROSE-LAWN" /></div>
          </div>
          <div className="field"><label>Description (shown on WhatsApp)</label><textarea value={p.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="grid g3">
            <div className="field"><label>Category</label>
              <select value={p.categoryId} onChange={(e) => set('categoryId', Number(e.target.value))}>
                <option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label>Stitching</label>
              <select value={p.stitchingType} onChange={(e) => set('stitchingType', e.target.value)}>
                <option value="UNSTITCHED">Unstitched</option><option value="STITCHED">Stitched (sizes)</option>
              </select></div>
            <div className="field"><label>Status</label>
              <select value={p.status} onChange={(e) => set('status', e.target.value)}>
                <option value="ACTIVE">Active (visible in bot)</option><option value="DRAFT">Draft</option><option value="HIDDEN">Hidden</option>
              </select></div>
            <div className="field"><label>Fabric</label><input value={p.fabric} onChange={(e) => set('fabric', e.target.value)} placeholder="Lawn" /></div>
            <div className="field"><label>Pieces</label><input type="number" value={p.piecesCount} onChange={(e) => set('piecesCount', Number(e.target.value))} /></div>
            <div className="field"><label>Occasion</label><input value={p.occasion} onChange={(e) => set('occasion', e.target.value)} placeholder="Casual / Party / Wedding" /></div>
          </div>
          <div className="field"><label>Search tags (comma separated, helps AI & keyword search)</label><input value={p.tags} onChange={(e) => set('tags', e.target.value)} placeholder="floral, summer, embroidered" /></div>
        </div>

        <div className="card">
          <h2>Photos</h2>
          <p className="small muted">
            Any format (JPG, PNG, WEBP, iPhone HEIC), up to 25 MB — automatically resized & compressed for WhatsApp.
            The <b>first</b> “All colours” photo is the cover. Tag a photo with a colour and customers who pick that colour see it.
          </p>
          <div className="imgs">
            {p.images.map((im, i) => (
              <div className="im" key={im.url + i} style={{ width: 120 }}>
                <img src={im.url} alt="" style={{ outline: i === coverIdx ? '3px solid var(--brand)' : undefined }} title={i === coverIdx ? 'Cover photo' : ''} />
                <button className="small danger" title="Remove" onClick={() => set('images', p.images.filter((_, j) => j !== i))}>×</button>
                <select style={{ marginTop: 4, padding: 3, fontSize: 12 }} value={im.color ?? ''} onChange={(e) => setImg(i, { color: e.target.value || null })}>
                  <option value="">All colours</option>
                  {[...new Set([...colors, ...(im.color ? [im.color] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="row" style={{ gap: 2, marginTop: 3, position: 'static' }}>
                  <button className="small secondary" style={{ position: 'static' }} disabled={i === 0} onClick={() => moveImg(i, i - 1)}>←</button>
                  <button className="small secondary" style={{ position: 'static' }} disabled={i === p.images.length - 1} onClick={() => moveImg(i, i + 1)}>→</button>
                  <button className="small secondary" style={{ position: 'static' }} disabled={i === 0} title="Make cover" onClick={() => moveImg(i, 0)}>★</button>
                </div>
              </div>
            ))}
            {!p.images.length && <div className="muted small">No photos yet.</div>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input type="file" multiple accept="image/*,.heic,.heif" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="…or paste a public image link (Google Drive / Dropbox / website)" value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} style={{ flex: 1 }} />
            <button className="secondary" disabled={!!busy} onClick={addUrl}>Add</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row spread"><h2>Variants (each = one SKU with its own stock)</h2>{!isNew && <Link to="/inventory" className="small">Stock history →</Link>}</div>
        <div className="row" style={{ marginBottom: 12, background: '#f9fafb', padding: 10, borderRadius: 8 }}>
          <b className="small">Quick generate:</b>
          <input style={{ width: 200 }} placeholder="Colours: Pink, Blue" value={gen.colors} onChange={(e) => setGen({ ...gen, colors: e.target.value })} />
          {stitched && <input style={{ width: 140 }} placeholder="Sizes" value={gen.sizes} onChange={(e) => setGen({ ...gen, sizes: e.target.value })} />}
          <input style={{ width: 100 }} placeholder="Price" value={gen.price} onChange={(e) => setGen({ ...gen, price: e.target.value })} />
          <input style={{ width: 90 }} placeholder="Stock" value={gen.stock} onChange={(e) => setGen({ ...gen, stock: e.target.value })} />
          <button className="secondary small" onClick={generate}>Generate</button>
        </div>
        <p className="small muted">Changing stock here is saved as a +/− adjustment, so orders that come in while this page is open are not lost.</p>
        <table className="var-table">
          <thead><tr><th>SKU</th><th>Colour</th>{stitched && <th>Size</th>}<th>Price</th><th>Sale price</th><th>Stock</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {p.variants.map((v, i) => {
              const changed = v.id && v.stockLoaded !== undefined && v.stock !== '' && Number(v.stock) !== v.stockLoaded;
              return (
                <tr key={v.id ?? `n${i}`}>
                  <td><input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} /></td>
                  <td><input value={v.color} onChange={(e) => setV(i, 'color', e.target.value)} /></td>
                  {stitched && <td><input value={v.size ?? ''} onChange={(e) => setV(i, 'size', e.target.value)} style={{ width: 60 }} /></td>}
                  <td><input type="number" value={v.price} onChange={(e) => setV(i, 'price', e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 100 }} /></td>
                  <td><input type="number" value={v.salePrice ?? ''} onChange={(e) => setV(i, 'salePrice', e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 100 }} /></td>
                  <td>
                    <input type="number" min={0} value={v.stock} onChange={(e) => setV(i, 'stock', e.target.value === '' ? '' : Number(e.target.value))} style={{ width: 80 }} />
                    {changed && <div className="small muted">{Number(v.stock) - v.stockLoaded! > 0 ? '+' : ''}{Number(v.stock) - v.stockLoaded!}</div>}
                  </td>
                  <td><input type="checkbox" checked={v.active} onChange={(e) => setV(i, 'active', e.target.checked)} /></td>
                  <td><button className="small secondary" onClick={() => set('variants', p.variants.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="secondary small" style={{ marginTop: 8 }} onClick={() => set('variants', [...p.variants, { sku: '', color: '', size: stitched ? '' : null, price: '', salePrice: '', stock: 0, active: true }])}>+ Add variant</button>
      </div>
    </>
  );
}
