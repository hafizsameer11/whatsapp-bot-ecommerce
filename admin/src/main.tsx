import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { auth } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import ProductEdit from './pages/ProductEdit';
import Categories from './pages/Categories';
import Orders from './pages/Orders';
import Inbox from './pages/Inbox';
import Simulator from './pages/Simulator';
import BotMenus from './pages/BotMenus';
import BotTexts from './pages/BotTexts';
import AutoReplies from './pages/AutoReplies';
import Knowledge from './pages/Knowledge';
import AiSettings from './pages/AiSettings';
import Settings from './pages/Settings';
import Inventory from './pages/Inventory';
import Import from './pages/Import';

function Private({ children }: { children: React.ReactNode }) {
  return auth.token ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

const routes: [string, React.ReactNode][] = [
  ['/', <Dashboard />], ['/products', <Products />], ['/products/:id', <ProductEdit />], ['/categories', <Categories />], ['/inventory', <Inventory />], ['/import', <Import />],
  ['/orders', <Orders />], ['/inbox', <Inbox />], ['/simulator', <Simulator />], ['/bot/menus', <BotMenus />],
  ['/bot/texts', <BotTexts />], ['/bot/auto-replies', <AutoReplies />], ['/bot/knowledge', <Knowledge />],
  ['/ai', <AiSettings />], ['/settings', <Settings />],
];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {routes.map(([p, el]) => <Route key={p} path={p} element={<Private>{el}</Private>} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
