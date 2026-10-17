import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, auth } from '../api';

export default function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  const [human, setHuman] = useState(0);

  useEffect(() => {
    api('/auth/me').then(setMe).catch(() => undefined);
    const load = () => api('/dashboard').then((d) => setHuman(d.needsHuman)).catch(() => undefined);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const L = (to: string, label: string, extra?: ReactNode) => (
    <NavLink to={to} end={to === '/'}>{label}{extra}</NavLink>
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">🛍️ WhatsApp Store</div>
        {L('/', 'Dashboard')}
        {L('/inbox', 'Inbox', human ? <span className="badge">{human}</span> : null)}
        {L('/orders', 'Orders')}
        <div className="group">Catalog</div>
        {L('/products', 'Products')}
        {L('/inventory', 'Inventory')}
        {L('/categories', 'Categories')}
        {L('/import', 'Import / export')}
        <div className="group">Bot</div>
        {L('/simulator', 'Test chat (simulator)')}
        {L('/bot/menus', 'Menus & buttons')}
        {L('/bot/texts', 'Reply texts')}
        {L('/bot/auto-replies', 'Keyword replies')}
        {L('/bot/knowledge', 'Knowledge / FAQ')}
        {L('/ai', 'AI settings')}
        <div className="group">Admin</div>
        {L('/settings', 'Store settings')}
        <div style={{ padding: '18px 10px', fontSize: 12 }}>
          {me && <div>{me.name} · {me.role}</div>}
          <a href="#" onClick={(e) => { e.preventDefault(); auth.clear(); nav('/login'); }}>Log out</a>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
