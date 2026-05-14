import { useState } from 'react';
import { LayoutDashboard, Users, ListTodo, Inbox, type LucideIcon } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Todos from './pages/Todos';
import InboxPage from './pages/Inbox';

type Tab = 'inbox' | 'dashboard' | 'accounts' | 'todos';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Bandeja', icon: Inbox },
  { id: 'todos', label: 'Pendientes', icon: ListTodo },
  { id: 'accounts', label: 'Cuentas', icon: Users },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [inboxCount, setInboxCount] = useState(0);

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
                    ? 'bg-ink text-paper'
                    : 'text-ink/70 hover:bg-cream hover:text-ink',
                ].join(' ')}
              >
                <Icon size={16} className={active ? 'text-terracota' : 'text-ink/40'} />
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
        </div>
      </main>
    </div>
  );
}
