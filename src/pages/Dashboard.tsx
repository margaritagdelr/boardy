import { useEffect, useState } from 'react';
import { Plus, ExternalLink, Pencil, Trash2, X, Inbox as InboxIcon, ListTodo, Users as UsersIcon, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react';
import { loadData, saveData, newId } from '../api';
import type { LinksData, LinkGroup, LinkItem, TodosData, AccountsData, InboxState } from '../types';
import PageHeader from '../components/PageHeader';

type DashboardTab = 'inbox' | 'dashboard' | 'accounts' | 'todos';

type Summary = {
  inboxNew: number;
  todosPendientes: number;
  todosEnCurso: number;
  todosAlta: number;
  todosVencidos: number;
  accountsTotal: number;
  accountsAtencion: number;
};

type Briefing = {
  date: string;
  text: string;
  generatedAt: string;
  stats: {
    pendientes: number;
    enCurso: number;
    alta: number;
    vencidos: number;
    venceHoy: number;
    venceProximo: number;
    nuevosInbox: number;
    cuentasAtencion: number;
  };
};

export default function Dashboard({
  onNavigate,
  inboxCount,
}: {
  onNavigate?: (tab: DashboardTab) => void;
  inboxCount?: number;
} = {}) {
  const [data, setData] = useState<LinksData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [editing, setEditing] = useState<{ groupId: string; link?: LinkItem } | null>(null);
  const [editingGroup, setEditingGroup] = useState<LinkGroup | null>(null);

  useEffect(() => {
    loadData('links').then(setData).catch(console.error);
  }, []);

  useEffect(() => {
    fetch('/api/briefing')
      .then(r => (r.ok ? (r.json() as Promise<Briefing>) : null))
      .then(setBriefing)
      .catch(() => setBriefing(null));
  }, []);

  async function regenerateBriefing() {
    setBriefingLoading(true);
    try {
      const r = await fetch('/api/briefing/regenerate', { method: 'POST' });
      if (r.ok) setBriefing((await r.json()) as Briefing);
    } finally {
      setBriefingLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [todosD, accountsD, inboxRes] = await Promise.all([
          loadData('todos'),
          loadData('accounts'),
          fetch('/api/inbox').then(r => (r.ok ? r.json() as Promise<InboxState> : null)).catch(() => null),
        ]);
        if (cancelled) return;
        setSummary(buildSummary(todosD, accountsD, inboxRes, inboxCount));
      } catch (e) {
        console.error(e);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [inboxCount]);

  if (!data) return <div className="text-ink-soft">Cargando…</div>;

  function persist(next: LinksData) {
    setData(next);
    saveData('links', next).catch(console.error);
  }

  function saveLink(groupId: string, link: LinkItem) {
    if (!data) return;
    const next: LinksData = {
      groups: data.groups.map(g => {
        if (g.id !== groupId) return g;
        const exists = g.links.some(l => l.id === link.id);
        return {
          ...g,
          links: exists ? g.links.map(l => (l.id === link.id ? link : l)) : [...g.links, link],
        };
      }),
    };
    persist(next);
    setEditing(null);
  }

  function deleteLink(groupId: string, linkId: string) {
    if (!data) return;
    if (!confirm('¿Borrar este link?')) return;
    persist({
      groups: data.groups.map(g =>
        g.id === groupId ? { ...g, links: g.links.filter(l => l.id !== linkId) } : g,
      ),
    });
  }

  function saveGroup(group: LinkGroup) {
    if (!data) return;
    const exists = data.groups.some(g => g.id === group.id);
    persist({
      groups: exists ? data.groups.map(g => (g.id === group.id ? group : g)) : [...data.groups, group],
    });
    setEditingGroup(null);
  }

  function deleteGroup(groupId: string) {
    if (!data) return;
    if (!confirm('¿Borrar este grupo y todos sus links?')) return;
    persist({ groups: data.groups.filter(g => g.id !== groupId) });
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Tu día de un vistazo. Links abajo."
        actions={
          <button
            onClick={() =>
              setEditingGroup({ id: newId('grp'), title: '', color: 'sage', links: [] })
            }
            className="inline-flex items-center gap-1 btn-primary"
          >
            <Plus size={16} /> Nuevo grupo
          </button>
        }
      />

      {briefing && (
        <section className="mb-4 bg-cream border border-ochre-700/20 rounded-lg p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-ochre-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-ochre-700 uppercase tracking-wide">Briefing del día</span>
                <button
                  onClick={regenerateBriefing}
                  disabled={briefingLoading}
                  className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md bg-iris-50 text-iris-700 hover:bg-iris-100 disabled:opacity-50 transition-colors"
                  title="Regenerar"
                >
                  <RefreshCw size={11} className={briefingLoading ? 'animate-spin' : ''} />
                  {briefingLoading ? 'Pensando…' : 'Regenerar'}
                </button>
              </div>
              <p className="text-sm text-ink/85 leading-relaxed whitespace-pre-wrap">{briefing.text}</p>
            </div>
          </div>
        </section>
      )}

      {summary && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <SummaryCard
            label="Bandeja"
            icon={InboxIcon}
            primary={`${summary.inboxNew}`}
            primaryLabel={summary.inboxNew === 1 ? 'nuevo' : 'nuevos'}
            color="terracota"
            onClick={() => onNavigate?.('inbox')}
            extra={summary.inboxNew === 0 ? 'Todo al día' : 'Sin procesar'}
          />
          <SummaryCard
            label="Pendientes"
            icon={ListTodo}
            primary={`${summary.todosPendientes + summary.todosEnCurso}`}
            primaryLabel="activos"
            color="ochre"
            onClick={() => onNavigate?.('todos')}
            extra={
              <>
                {summary.todosAlta > 0 && <span className="text-terracota-700 font-medium">{summary.todosAlta} alta</span>}
                {summary.todosAlta > 0 && summary.todosVencidos > 0 && <span className="text-ink/30 mx-1">·</span>}
                {summary.todosVencidos > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-terracota-700 font-medium">
                    <AlertTriangle size={11} /> {summary.todosVencidos} vencido{summary.todosVencidos === 1 ? '' : 's'}
                  </span>
                )}
                {summary.todosAlta === 0 && summary.todosVencidos === 0 && <span className="text-ink/50">Sin urgencias</span>}
              </>
            }
          />
          <SummaryCard
            label="Cuentas"
            icon={UsersIcon}
            primary={`${summary.accountsTotal}`}
            primaryLabel="totales"
            color="sage"
            onClick={() => onNavigate?.('accounts')}
            extra={
              summary.accountsAtencion > 0
                ? `${summary.accountsAtencion} requieren atención`
                : 'Todo en orden'
            }
          />
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.groups.map(group => (
          <section key={group.id} className="bg-paper border border-ink-mute rounded-lg p-5 shadow-sm">
            <header className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-ink tracking-tight2">{group.title}</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditing({ groupId: group.id })}
                  className="p-1.5 rounded hover:bg-cream text-ink/50 hover:text-terracota-600"
                  title="Agregar link"
                >
                  <Plus size={16} />
                </button>
                <button
                  onClick={() => setEditingGroup(group)}
                  className="p-1.5 rounded hover:bg-cream text-ink/50 hover:text-ink"
                  title="Editar grupo"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => deleteGroup(group.id)}
                  className="p-1.5 rounded hover:bg-terracota-50 text-ink/40 hover:text-terracota-700"
                  title="Borrar grupo"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>

            {group.links.length === 0 && (
              <p className="text-sm text-ink/40 italic">Todavía no hay links en este grupo.</p>
            )}

            <ul className="space-y-1">
              {group.links.map(link => (
                <li
                  key={link.id}
                  className="group flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-cream"
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm font-medium text-ink/80 hover:text-terracota-700 truncate"
                  >
                    <ExternalLink size={14} className="shrink-0 text-ink/40" />
                    <span className="truncate">{link.label}</span>
                  </a>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => setEditing({ groupId: group.id, link })}
                      className="p-1 rounded hover:bg-sage-100 text-ink/50"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => deleteLink(group.id, link.id)}
                      className="p-1 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {group.links.some(l => l.note) && (
              <details className="mt-3 text-xs text-ink-soft">
                <summary className="cursor-pointer hover:text-ink">Notas del grupo</summary>
                <ul className="mt-2 space-y-1 pl-3">
                  {group.links.filter(l => l.note).map(l => (
                    <li key={l.id}><span className="font-medium text-ink/80">{l.label}:</span> {l.note}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>

      {editing && (
        <LinkModal
          link={editing.link}
          onClose={() => setEditing(null)}
          onSave={l => saveLink(editing.groupId, l)}
        />
      )}

      {editingGroup && (
        <GroupModal
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={saveGroup}
        />
      )}
    </>
  );
}

function LinkModal({
  link,
  onClose,
  onSave,
}: {
  link?: LinkItem;
  onClose: () => void;
  onSave: (l: LinkItem) => void;
}) {
  const [label, setLabel] = useState(link?.label ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [note, setNote] = useState(link?.note ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim()) return;
    onSave({ id: link?.id ?? newId('lnk'), label: label.trim(), url: url.trim(), note: note.trim() });
  }

  return (
    <Modal title={link ? 'Editar link' : 'Nuevo link'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Etiqueta">
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="input"
            placeholder="GitHub"
          />
        </Field>
        <Field label="URL">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="input"
            placeholder="https://..."
          />
        </Field>
        <Field label="Nota (opcional)">
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            className="input"
            placeholder=""
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

function GroupModal({
  group,
  onClose,
  onSave,
}: {
  group: LinkGroup;
  onClose: () => void;
  onSave: (g: LinkGroup) => void;
}) {
  const [title, setTitle] = useState(group.title);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ ...group, title: title.trim() });
  }

  return (
    <Modal title={group.title ? 'Editar grupo' : 'Nuevo grupo'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre del grupo">
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="input"
            placeholder="Atajos diarios"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-paper rounded-lg shadow-lg w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`} onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-ink-mute">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-cream text-ink/50">
            <X size={18} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-soft mb-1">{label}</span>
      {children}
    </label>
  );
}

type SummaryColor = 'terracota' | 'ochre' | 'sage';
const SUMMARY_TONES: Record<SummaryColor, { icon: string; number: string }> = {
  terracota: { icon: 'text-terracota', number: 'text-terracota-700' },
  ochre:     { icon: 'text-ochre',     number: 'text-ochre-700' },
  sage:      { icon: 'text-sage-700',  number: 'text-sage-700' },
};

function SummaryCard({
  label,
  icon: Icon,
  primary,
  primaryLabel,
  extra,
  color,
  onClick,
}: {
  label: string;
  icon: typeof InboxIcon;
  primary: string;
  primaryLabel: string;
  extra?: React.ReactNode;
  color: SummaryColor;
  onClick?: () => void;
}) {
  const tone = SUMMARY_TONES[color];
  return (
    <button
      onClick={onClick}
      className="text-left bg-paper border border-ink-mute rounded-lg p-4 shadow-sm hover:border-terracota-300 hover:shadow transition"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-ink-soft uppercase tracking-wide">{label}</span>
        <Icon size={16} className={tone.icon} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold tracking-tight2 ${tone.number}`}>{primary}</span>
        <span className="text-xs text-ink-soft">{primaryLabel}</span>
      </div>
      {extra && <div className="text-xs text-ink-soft mt-1">{extra}</div>}
    </button>
  );
}

function buildSummary(
  todosD: TodosData,
  accountsD: AccountsData,
  inboxRes: InboxState | null,
  inboxFallback: number | undefined,
): Summary {
  const today = new Date().toISOString().slice(0, 10);
  const todosAlta = todosD.todos.filter(t => t.status !== 'hecho' && t.priority === 'alta').length;
  const todosVencidos = todosD.todos.filter(
    t => t.status !== 'hecho' && t.dueDate && t.dueDate < today,
  ).length;
  const accountsAtencion = accountsD.accounts.filter(
    a => a.status === 'revisar' || a.status === 'necesita-trabajo',
  ).length;
  return {
    inboxNew: inboxRes
      ? inboxRes.items.filter(i => i.status === 'nuevo').length
      : inboxFallback ?? 0,
    todosPendientes: todosD.todos.filter(t => t.status === 'pendiente').length,
    todosEnCurso: todosD.todos.filter(t => t.status === 'en-curso').length,
    todosAlta,
    todosVencidos,
    accountsTotal: accountsD.accounts.length,
    accountsAtencion,
  };
}
