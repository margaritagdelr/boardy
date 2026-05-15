import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Users, ListTodo, Inbox, Search, Files, type LucideIcon } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Todos from './pages/Todos';
import InboxPage from './pages/Inbox';
import Documents from './pages/Documents';
import GlobalSearch from './components/GlobalSearch';
import { useInboxNotifications } from './hooks/useInboxNotifications';

type Tab = 'inbox' | 'dashboard' | 'accounts' | 'todos' | 'documents';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Bandeja', icon: Inbox },
  { id: 'todos', label: 'Pendientes', icon: ListTodo },
  { id: 'documents', label: 'Documentos', icon: Files },
  { id: 'accounts', label: 'Cuentas', icon: Users },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [inboxCount, setInboxCount] = useState(0);
  const [showSearch, setShowSearch] = useState(false);

  const focusInbox = useCallback(() => setTab('inbox'), []);
  useInboxNotifications(focusInbox);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-full">
      <aside className="w-60 shrink-0 border-r border-ink-mute bg-paper">
        <div className="px-5 py-6 border-b border-ink-mute">
          <img
            src="/branding/assets/boardy-logo.svg"
            alt="Boardy"
            className="h-8 w-auto select-none"
            draggable={false}
          />
          <div className="mt-2 text-xs text-ink-soft">Tu memoria de trabajo</div>
        </div>
        <div className="px-2 pt-2">
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-ink-mute bg-cream/40 hover:bg-cream text-ink-soft text-xs"
          >
            <Search size={13} />
            <span className="flex-1 text-left">Buscar…</span>
            <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-paper border border-ink-mute">Ctrl K</span>
          </button>
        </div>
        <nav className="p-2">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            const showBadge = t.id === 'inbox' && inboxCount > 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2 my-0.5 rounded-md text-sm font-medium transition',
                  active
                    ? 'bg-iris text-paper shadow-sm'
                    : 'text-ink/70 hover:bg-iris-50 hover:text-iris-700',
                ].join(' ')}
              >
                <Icon size={16} className={active ? 'text-iris-100' : 'text-ink/40'} />
                <span className="flex-1 text-left">{t.label}</span>
                {showBadge && (
                  <span className="px-2 py-0.5 rounded-full bg-terracota text-ink text-[10px] font-bold">
                    {inboxCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {tab === 'inbox' && <InboxPage onCountChange={setInboxCount} />}
          {tab === 'dashboard' && <Dashboard onNavigate={setTab} inboxCount={inboxCount} />}
          {tab === 'accounts' && <Accounts />}
          {tab === 'todos' && <Todos />}
          {tab === 'documents' && <Documents />}
        </div>
      </main>

      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} onNavigate={setTab} />}
    </div>
  );
}
