import { useEffect, useState } from 'react';
import { api } from '../api';

// Action string format shared with the server: BROWSE | SEARCH | CART | TRACK | HUMAN | FAQ | MENU:<id> | TEXT:<message>
const TYPES: [string, string][] = [
  ['BROWSE', 'Browse collections'], ['SEARCH', 'Ask what they want (search)'], ['CART', 'Show cart'],
  ['TRACK', 'Track order'], ['HUMAN', 'Hand over to agent'], ['FAQ', 'FAQ list (knowledge)'],
  ['MENU', 'Open custom menu'], ['TEXT', 'Reply with text'],
];

let menusCache: Promise<{ id: number; title: string }[]> | null = null;
export const refreshMenus = () => { menusCache = null; };

export default function ActionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [menus, setMenus] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    menusCache ??= api('/bot/menus');
    menusCache.then(setMenus).catch(() => undefined);
  }, []);
  const type = value.split(':')[0] || 'BROWSE';
  const arg = value.includes(':') ? value.slice(value.indexOf(':') + 1) : '';
  return (
    <div>
      <select value={type} onChange={(e) => {
        const t = e.target.value;
        onChange(t === 'MENU' ? `MENU:${menus[0]?.id ?? ''}` : t === 'TEXT' ? 'TEXT:' : t);
      }}>
        {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {type === 'MENU' && (
        <select style={{ marginTop: 4 }} value={arg} onChange={(e) => onChange(`MENU:${e.target.value}`)}>
          {menus.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      )}
      {type === 'TEXT' && (
        <textarea style={{ marginTop: 4 }} placeholder="Message sent when tapped" value={arg} onChange={(e) => onChange(`TEXT:${e.target.value}`)} />
      )}
    </div>
  );
}
