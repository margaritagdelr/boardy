import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { loadData, saveData, newId } from '../api';
import type { Todo, TodosData } from '../types';
import PageHeader from '../components/PageHeader';
import { Modal, Field } from './Dashboard';

const PRIORITY_STYLES: Record<Todo['priority'], string> = {
  alta: 'bg-terracota-100 text-terracota-700',
  media: 'bg-ochre-100 text-ochre-700',
  baja: 'bg-sage-100 text-sage-700',
};

export default function Todos() {
  const [data, setData] = useState<TodosData | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [filter, setFilter] = useState<'todos' | Todo['status']>('todos');

  useEffect(() => {
    loadData('todos').then(setData).catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const arr = filter === 'todos' ? data.todos : data.todos.filter(t => t.status === filter);
    return [...arr].sort((a, b) => {
      const order = { alta: 0, media: 1, baja: 2 } as const;
      return order[a.priority] - order[b.priority];
    });
  }, [data, filter]);

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

      <div className="flex gap-2 mb-4">
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
        <TodoModal todo={editing} onClose={() => setEditing(null)} onSave={saveTodo} />
      )}
    </>
  );
}

function labelFilter(f: 'todos' | Todo['status']) {
  return f === 'todos' ? 'Todos' : f === 'en-curso' ? 'En curso' : f === 'pendiente' ? 'Pendiente' : 'Hecho';
}

export function TodoModal({
  todo,
  onClose,
  onSave,
}: {
  todo: Todo;
  onClose: () => void;
  onSave: (t: Todo) => void;
}) {
  const [t, setT] = useState<Todo>(todo);
  const [tagsInput, setTagsInput] = useState(todo.tags.join(', '));

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
