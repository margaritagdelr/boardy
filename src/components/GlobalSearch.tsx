import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Inbox as InboxIcon, ListTodo, Users as UsersIcon, ExternalLink, X } from 'lucide-react';
import type { AccountsData, InboxState, LinksData, TodosData } from '../types';

export type SearchTab = 'inbox' | 'dashboard' | 'accounts' | 'todos';

type SearchResult =
  | { kind: 'todo'; id: string; title: string; subtitle: string }
  | { kind: 'account'; id: string; title: string; subtitle: string; url?: string }
  | { kind: 'link'; id: string; title: string; subtitle: string; url: string }
  | { kind: 'inbox'; id: string; title: string; subtitle: string };

export default function GlobalSearch({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (tab: SearchTab) => void;
}) {
  const [query, setQuery] = useState('');
  const [todos, setTodos] = useState<TodosData | null>(null);
  const [accounts, setAccounts] = useState<AccountsData | null>(null);
  const [links, setLinks] = useState<LinksData | null>(null);
  const [inbox, setInbox] = useState<InboxState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    Promise.all([
      fetch('/api/data/todos').then(r => r.json() as Promise<TodosData>).catch(() => null),
      fetch('/api/data/accounts').then(r => r.json() as Promise<AccountsData>).catch(() => null),
      fetch('/api/data/links').then(r => r.json() as Promise<LinksData>).catch(() => null),
      fetch('/api/inbox').then(r => r.json() as Promise<InboxState>).catch(() => null),
    ]).then(([t, a, l, i]) => {
      setTodos(t);
      setAccounts(a);
      setLinks(l);
      setInbox(i);
    });
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];

    if (todos) {
      for (const t of todos.todos) {
        if (
          t.title.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.tags.some(tag => tag.toLowerCase().includes(q))
        ) {
          out.push({
            kind: 'todo',
            id: t.id,
            title: t.title,
            subtitle: `${t.status} · ${t.priority}${t.dueDate ? ` · vence ${t.dueDate}` : ''}`,
          });
        }
      }
    }

    if (accounts) {
      for (const a of accounts.accounts) {
        if (
          a.platform.toLowerCase().includes(q) ||
          a.brand.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.notes.toLowerCase().includes(q)
        ) {
          out.push({
            kind: 'account',
            id: a.id,
            title: `${a.platform} (${a.brand})`,
            subtitle: `${a.category} · ${a.status}`,
            url: a.url,
          });
        }
      }
    }

    if (links) {
      for (const g of links.groups) {
        for (const l of g.links) {
          if (
            l.label.toLowerCase().includes(q) ||
            l.url.toLowerCase().includes(q) ||
            (l.note ?? '').toLowerCase().includes(q) ||
            g.title.toLowerCase().includes(q)
          ) {
            out.push({
              kind: 'link',
              id: l.id,
              title: l.label,
              subtitle: g.title,
              url: l.url,
            });
          }
        }
      }
    }

    if (inbox) {
      for (const i of inbox.items) {
        if (i.status !== 'nuevo') continue;
        if (
          i.text.toLowerCase().includes(q) ||
          i.senderDisplayName.toLowerCase().includes(q) ||
          i.spaceDisplayName.toLowerCase().includes(q) ||
          (i.tags ?? []).some(t => t.toLowerCase().includes(q))
        ) {
          out.push({
            kind: 'inbox',
            id: i.id,
            title: i.text.split('\n')[0].slice(0, 100) || `Mensaje de ${i.senderDisplayName}`,
            subtitle: `${i.senderDisplayName} · ${i.spaceDisplayName}`,
          });
        }
      }
    }

    return out.slice(0, 30);
  }, [query, todos, accounts, links, inbox]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function activate(r: SearchResult) {
    if (r.kind === 'link') {
      window.open(r.url, '_blank', 'noreferrer');
      return;
    }
    if (r.kind === 'account' && r.url) {
      window.open(r.url, '_blank', 'noreferrer');
      return;
    }
    const tabMap: Record<SearchResult['kind'], SearchTab> = {
      todo: 'todos',
      account: 'accounts',
      link: 'dashboard',
      inbox: 'inbox',
    };
    onNavigate(tabMap[r.kind]);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) activate(r);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-start justify-center pt-24 p-4"
      onClick={onClose}
    >
      <div
        className="bg-paper rounded-lg shadow-lg w-full max-w-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-mute">
          <Search size={18} className="text-ink/40" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar pendientes, cuentas, links, mensajes…"
            className="flex-1 bg-transparent outline-none text-ink placeholder:text-ink/40"
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-cream text-ink/50">
            <X size={16} />
          </button>
        </div>

        {query.trim() === '' ? (
          <div className="px-4 py-8 text-center text-ink/40 text-sm">
            Escribí para buscar. Atajos: <span className="mono text-xs">↑↓</span> mover · <span className="mono text-xs">Enter</span> abrir · <span className="mono text-xs">Esc</span> cerrar.
          </div>
        ) : results.length === 0 ? (
          <div className="px-4 py-8 text-center text-ink/40 italic text-sm">
            Nada coincide con "{query}".
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto">
            {results.map((r, idx) => {
              const Icon = ICON_FOR[r.kind];
              const active = idx === activeIdx;
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => activate(r)}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left transition',
                      active ? 'bg-cream' : 'hover:bg-cream/60',
                    ].join(' ')}
                  >
                    <Icon size={14} className="shrink-0 text-ink/50" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">{r.title}</div>
                      <div className="text-xs text-ink-soft truncate">{r.subtitle}</div>
                    </div>
                    <span className="text-[10px] mono text-ink/40 uppercase">{KIND_LABEL[r.kind]}</span>
                    {(r.kind === 'link' || (r.kind === 'account' && r.url)) && (
                      <ExternalLink size={12} className="text-ink/30 shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const ICON_FOR: Record<SearchResult['kind'], typeof InboxIcon> = {
  todo: ListTodo,
  account: UsersIcon,
  link: ExternalLink,
  inbox: InboxIcon,
};

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  todo: 'pendiente',
  account: 'cuenta',
  link: 'link',
  inbox: 'mensaje',
};
