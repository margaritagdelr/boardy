import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, CheckCircle2, Circle, Loader2, Link2, Search } from 'lucide-react';
import { loadData, saveData, newId } from '../api';
import type { Account, Todo, TodosData } from '../types';
import PageHeader from '../components/PageHeader';
import { Modal, Field } from './Dashboard';

const PRIORITY_STYLES: Record<Todo['priority'], string> = {
  alta: 'bg-iris-100 text-iris-700',
  media: 'bg-ochre-100 text-ochre-700',
  baja: 'bg-sage-100 text-sage-700',
};

type SortMode = 'prioridad' | 'vence' | 'recientes' | 'antiguos' | 'alfabetico';

const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 } as const;

export default function Todos() {
  const [data, setData] = useState<TodosData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [filter, setFilter] = useState<'todos' | Todo['status']>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('prioridad');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData('todos').then(setData).catch(console.error);
    loadData('accounts').then(d => setAccounts(d.accounts)).catch(console.error);
  }, []);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    const pool = filter === 'todos' ? data.todos : data.todos.filter(t => t.status === filter);
    for (const t of pool) for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    return map;
  }, [data, filter]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let arr = filter === 'todos' ? data.todos : data.todos.filter(t => t.status === filter);

    if (activeTags.size > 0) {
      arr = arr.filter(t => t.tags.some(tag => activeTags.has(tag)));
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)),
      );
    }

    return [...arr].sort((a, b) => sortCompare(a, b, sortMode));
  }, [data, filter, searchQuery, sortMode, activeTags]);

  if (!data) return <div className="text-ink-soft">Cargando…</div>;

  function persist(next: TodosData) {
    setData(next);
    saveData('todos', next).catch(console.error);
  }

  function saveTodo(todo: Todo) {
    if (!data) return;
    const exists = data.todos.some(t => t.id === todo.id);
    persist({
      todos: exists ? data.todos.map(t => (t.id === todo.id ? todo : t)) : [...data.todos, todo],
    });
    setEditing(null);
  }

  function cycleStatus(todo: Todo) {
    const next: Todo['status'] =
      todo.status === 'pendiente' ? 'en-curso' : todo.status === 'en-curso' ? 'hecho' : 'pendiente';
    persist({ todos: data!.todos.map(t => (t.id === todo.id ? { ...t, status: next } : t)) });
  }

  function deleteTodo(id: string) {
    if (!data) return;
    if (!confirm('¿Borrar este pendiente?')) return;
    persist({ todos: data.todos.filter(t => t.id !== id) });
  }

  const counts = {
    todos: data.todos.length,
    pendiente: data.todos.filter(t => t.status === 'pendiente').length,
    'en-curso': data.todos.filter(t => t.status === 'en-curso').length,
    hecho: data.todos.filter(t => t.status === 'hecho').length,
  };

  return (
    <>
      <PageHeader
        title="Pendientes"
        subtitle="Lo que no querés perder de vista."
        actions={
          <button
            onClick={() =>
              setEditing({
                id: newId('todo'),
                title: '',
                priority: 'media',
                status: 'pendiente',
                tags: [],
                notes: '',
                createdAt: new Date().toISOString().slice(0, 10),
                dueDate: '',
              })
            }
            className="inline-flex items-center gap-1 btn-primary"
          >
            <Plus size={16} /> Nuevo pendiente
          </button>
        }
      />

      <div className="mb-4 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por título, notas o tag…"
              className="input pl-9 text-sm"
            />
          </div>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="select w-auto text-sm"
            title="Ordenar"
          >
            <option value="prioridad">Por prioridad</option>
            <option value="vence">Vence primero</option>
            <option value="recientes">Más recientes</option>
            <option value="antiguos">Más antiguos</option>
            <option value="alfabetico">Alfabético</option>
          </select>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(['todos', 'pendiente', 'en-curso', 'hecho'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'px-3 py-1.5 rounded-md text-sm font-medium transition',
                filter === f
                  ? 'bg-ink text-paper'
                  : 'bg-paper border border-ink-mute text-ink/70 hover:bg-cream',
              ].join(' ')}
            >
              {labelFilter(f)} <span className="opacity-60">({counts[f]})</span>
            </button>
          ))}
        </div>

        {tagCounts.size > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {activeTags.size > 0 && (
              <button
                onClick={() => setActiveTags(new Set())}
                className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-paper border border-ink-mute text-ink-soft hover:text-ink hover:bg-cream"
              >
                ✕ Limpiar tags
              </button>
            )}
            {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => {
              const active = activeTags.has(tag);
              return (
                <button
                  key={tag}
                  onClick={() => {
                    const next = new Set(activeTags);
                    if (active) next.delete(tag); else next.add(tag);
                    setActiveTags(next);
                  }}
                  className={[
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium mono transition border',
                    active
                      ? 'bg-ink text-paper border-transparent'
                      : 'bg-sage-100 border-transparent text-ink/70 hover:bg-sage-200',
                  ].join(' ')}
                >
                  #{tag} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {filtered.map(t => (
          <article
            key={t.id}
            className={[
              'bg-paper border rounded-lg p-4 shadow-sm flex items-start gap-3 group',
              t.status === 'hecho' ? 'opacity-60 border-ink-mute' : 'border-ink-mute',
            ].join(' ')}
          >
            <button onClick={() => cycleStatus(t)} className="mt-0.5 text-ink/40 hover:text-terracota-700" title="Cambiar estado">
              {t.status === 'pendiente' && <Circle size={20} />}
              {t.status === 'en-curso' && <Loader2 size={20} className="text-ochre" />}
              {t.status === 'hecho' && <CheckCircle2 size={20} className="text-terracota" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={`font-semibold tracking-tight2 ${t.status === 'hecho' ? 'line-through text-ink-soft' : 'text-ink'}`}>
                  {t.title}
                </h3>
                <span className={`pill ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                {t.tags.map(tag => (
                  <span key={tag} className="pill bg-sage-100 text-ink/70 mono">#{tag}</span>
                ))}
                {t.accountId && (() => {
                  const acc = accounts.find(a => a.id === t.accountId);
                  return acc ? (
                    <span className="pill bg-ochre-100 text-ochre-700 inline-flex items-center gap-1">
                      <Link2 size={10} /> {acc.platform}
                    </span>
                  ) : null;
                })()}
                {t.dueDate && (
                  <span className="text-xs text-ink-soft mono">vence {t.dueDate}</span>
                )}
              </div>
              {t.notes && (
                <p className="text-sm text-ink/70 mt-1 whitespace-pre-wrap">{t.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
              <button onClick={() => setEditing(t)} className="p-1.5 rounded hover:bg-cream text-ink/50">
                <Pencil size={14} />
              </button>
              <button onClick={() => deleteTodo(t.id)} className="p-1.5 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700">
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-ink/40 italic">No hay pendientes en este filtro.</div>
        )}
      </div>

      {editing && (
        <TodoModal todo={editing} onClose={() => setEditing(null)} onSave={saveTodo} accounts={accounts} />
      )}
    </>
  );
}

function labelFilter(f: 'todos' | Todo['status']) {
  return f === 'todos' ? 'Todos' : f === 'en-curso' ? 'En curso' : f === 'pendiente' ? 'Pendiente' : 'Hecho';
}

function sortCompare(a: Todo, b: Todo, mode: SortMode): number {
  switch (mode) {
    case 'prioridad':
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        || cmpString(a.dueDate, b.dueDate, /*emptyLast*/ true);
    case 'vence': {
      // Items with a dueDate first (ascending). Items without dueDate go to the end.
      const aHas = !!a.dueDate, bHas = !!b.dueDate;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    }
    case 'recientes':
      return cmpString(b.createdAt, a.createdAt, false); // newer first
    case 'antiguos':
      return cmpString(a.createdAt, b.createdAt, false); // older first
    case 'alfabetico':
      return a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
  }
}

function cmpString(a: string, b: string, emptyLast: boolean): number {
  if (emptyLast) {
    if (!a && b) return 1;
    if (a && !b) return -1;
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function TodoModal({
  todo,
  onClose,
  onSave,
  accounts,
}: {
  todo: Todo;
  onClose: () => void;
  onSave: (t: Todo) => void;
  accounts?: Account[];
}) {
  const [t, setT] = useState<Todo>(todo);
  const [tagsInput, setTagsInput] = useState(todo.tags.join(', '));
  const [accountList, setAccountList] = useState<Account[]>(accounts ?? []);

  useEffect(() => {
    if (accounts) return; // already supplied by caller
    loadData('accounts').then(d => setAccountList(d.accounts)).catch(() => {});
  }, [accounts]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!t.title.trim()) return;
    onSave({
      ...t,
      title: t.title.trim(),
      tags: tagsInput.split(',').map(s => s.trim()).filter(Boolean),
    });
  }

  return (
    <Modal title={todo.title ? 'Editar pendiente' : 'Nuevo pendiente'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Título">
          <input autoFocus value={t.title} onChange={e => setT({ ...t, title: e.target.value })} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioridad">
            <select value={t.priority} onChange={e => setT({ ...t, priority: e.target.value as Todo['priority'] })} className="select">
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </Field>
          <Field label="Estado">
            <select value={t.status} onChange={e => setT({ ...t, status: e.target.value as Todo['status'] })} className="select">
              <option value="pendiente">Pendiente</option>
              <option value="en-curso">En curso</option>
              <option value="hecho">Hecho</option>
            </select>
          </Field>
        </div>
        <Field label="Tags (separados por coma)">
          <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} className="input" placeholder="web, marca, stores" />
        </Field>
        <Field label="Vence">
          <input type="date" value={t.dueDate} onChange={e => setT({ ...t, dueDate: e.target.value })} className="input" />
        </Field>
        <Field label="Cuenta vinculada (opcional)">
          <select
            value={t.accountId ?? ''}
            onChange={e => setT({ ...t, accountId: e.target.value || undefined })}
            className="select"
          >
            <option value="">— Ninguna —</option>
            {accountList.map(a => (
              <option key={a.id} value={a.id}>{a.platform} ({a.brand})</option>
            ))}
          </select>
        </Field>
        <Field label="Notas">
          <textarea value={t.notes} onChange={e => setT({ ...t, notes: e.target.value })} className="textarea" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
