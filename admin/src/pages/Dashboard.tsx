import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt, fmt } from '../api';

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  useEffect(() => { api('/dashboard').then(setD); api('/status').then(setSt); }, []);
  if (!d) return <div>Loading…</div>;
  const check = (ok: boolean, label: string, hint: string) => (
    <div className="row" style={{ marginBottom: 6 }}>
      <span>{ok ? '✅' : '⚠️'}</span><b>{label}</b>{!ok && <span className="muted small">{hint}</span>}
    </div>
  );
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid g4">
        <div className="card stat"><div className="n">{d.ordersToday}</div><div className="l">Orders today</div></div>
        <div className="card stat"><div className="n">{d.pending}</div><div className="l">Pending confirmation</div></div>
        <div className="card stat"><div className="n">{fmt(d.revenue)}</div><div className="l">Revenue (not cancelled)</div></div>
        <div className="card stat"><div className="n">{d.needsHuman}</div><div className="l"><Link to="/inbox">Chats waiting for agent</Link></div></div>
      </div>
      <div className="grid g2">
        <div className="card">
          <h2>Recent orders</h2>
          <table><tbody>
            {d.recent.map((o: any) => (
              <tr key={o.id}><td><Link to={`/orders?open=${o.id}`}>{o.orderNo}</Link><div className="small muted">{dt(o.createdAt)}</div></td>
                <td>{o.name}<div className="small muted">{o.city}</div></td><td>{fmt(o.total)}</td><td><span className={`pill ${o.status}`}>{o.status}</span></td></tr>
            ))}
            {!d.recent.length && <tr><td className="muted">No orders yet. Try the <Link to="/simulator">simulator</Link>.</td></tr>}
          </tbody></table>
        </div>
        <div>
          {st && (
            <div className="card">
              <h2>Setup checklist</h2>
              {check(st.whatsappConfigured, 'WhatsApp Cloud API', 'Set WHATSAPP_TOKEN & WHATSAPP_PHONE_NUMBER_ID in server/.env')}
              {check(st.appSecretSet, 'Webhook signature check', 'Set WHATSAPP_APP_SECRET (required before going live)')}
              {check(st.aiConfigured, 'OpenAI', 'Set OPENAI_API_KEY; without it the bot uses menus + keyword search')}
              {check(!!st.publicBaseUrl && !st.publicBaseUrl.includes('your-tunnel'), 'Public HTTPS URL', 'Set PUBLIC_BASE_URL (ngrok/cloudflared) so WhatsApp can load uploaded images')}
              <div className="row" style={{ marginBottom: 6 }}><span>{st.imageStorage === 'S3' ? '☁️' : '💾'}</span><b>Photos</b>
                <span className="muted small">{st.imageStorage === 'S3' ? 'stored in your S3/R2 bucket' : 'stored on this server (server/uploads) — keep daily backups running'}</span></div>
              {st.publicBaseUrl && <div className="small muted">Webhook URL for Meta: <code>{st.publicBaseUrl}/webhook</code></div>}
            </div>
          )}
          <div className="card">
            <h2>Low stock</h2>
            <table><tbody>
              {d.lowStock.map((v: any) => (
                <tr key={v.id}><td><Link to={`/products/${v.productId}`}>{v.product}</Link><div className="small muted">{v.sku}</div></td>
                  <td>{[v.size, v.color].filter(Boolean).join(' / ')}</td><td><b style={{ color: v.stock ? '#b7791f' : '#c0392b' }}>{v.stock}</b></td></tr>
              ))}
              {!d.lowStock.length && <tr><td className="muted">All good.</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
