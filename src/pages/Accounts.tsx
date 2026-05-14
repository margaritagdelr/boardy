import { useEffect, useMemo, useState } from 'react';
import { Plus, ExternalLink, Pencil, Trash2, Search } from 'lucide-react';
import { loadData, saveData, newId } from '../api';
import type { Account, AccountsData } from '../types';
import PageHeader from '../components/PageHeader';
import { Modal, Field } from './Dashboard';

const STATUS_STYLES: Record<Account['status'], string> = {
  activa: 'bg-sage-100 text-sage-700',
  revisar: 'bg-ochre-100 text-ochre-700',
  'necesita-trabajo': 'bg-terracota-100 text-terracota-700',
  inactiva: 'bg-ink/8 text-ink-soft',
};

const STATUS_LABEL: Record<Account['status'], string> = {
  activa: 'Activa',
  revisar: 'Revisar',
  'necesita-trabajo': 'Necesita trabajo',
  inactiva: 'Inactiva',
};

export default function Accounts() {
  const [data, setData] = useState<AccountsData | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todas');

  useEffect(() => {
    loadData('accounts').then(setData).catch(console.error);
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    data?.accounts.forEach(a => set.add(a.category));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.toLowerCase();
    return data.accounts.filter(a => {
      if (categoryFilter !== 'todas' && a.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        a.platform.toLowerCase().includes(q) ||
        a.brand.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q)
      );
    });
  }, [data, query, categoryFilter]);

  if (!data) return <div className="text-ink-soft">Cargando…</div>;

  function persist(next: AccountsData) {
    setData(next);
    saveData('accounts', next).catch(console.error);
  }

  function saveAccount(acc: Account) {
    if (!data) return;
    const exists = data.accounts.some(a => a.id === acc.id);
    persist({
      accounts: exists ? data.accounts.map(a => (a.id === acc.id ? acc : a)) : [...data.accounts, acc],
    });
    setEditing(null);
  }

  function deleteAccount(id: string) {
    if (!data) return;
    if (!confirm('¿Borrar esta cuenta?')) return;
    persist({ accounts: data.accounts.filter(a => a.id !== id) });
  }

  return (
    <>
      <PageHeader
        title="Cuentas y plataformas"
        subtitle="Inventario de dónde tenemos presencia. Estado, responsable y notas."
        actions={
          <button
            onClick={() =>
              setEditing({
                id: newId('acc'),
                platform: '',
                category: 'Redes sociales',
                brand: 'Thinfinity',
                url: '',
                owner: 'Margarita',
                status: 'revisar',
                lastReview: '',
                notes: '',
              })
            }
            className="inline-flex items-center gap-1 btn-primary"
          >
            <Plus size={16} /> Nueva cuenta
          </button>
        }
      />

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por plataforma, marca o nota…"
            className="input pl-9"
          />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="select w-auto">
          <option value="todas">Todas las categorías</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="bg-paper border border-ink-mute rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-sage-50 text-ink-soft text-[11px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Plataforma</th>
              <th className="text-left px-4 py-3 font-semibold">Marca</th>
              <th className="text-left px-4 py-3 font-semibold">Categoría</th>
              <th className="text-left px-4 py-3 font-semibold">Estado</th>
              <th className="text-left px-4 py-3 font-semibold">Notas</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id} className="border-t border-ink-mute group hover:bg-cream">
                <td className="px-4 py-3 font-medium text-ink">
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-terracota-700">
                      {a.platform} <ExternalLink size={12} className="text-ink/40" />
                    </a>
                  ) : (
                    a.platform
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">{a.brand}</td>
                <td className="px-4 py-3 text-ink/70">{a.category}</td>
                <td className="px-4 py-3">
                  <span className={`pill ${STATUS_STYLES[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft max-w-xs truncate" title={a.notes}>{a.notes}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(a)} className="p-1.5 rounded hover:bg-sage-100 text-ink/50 opacity-0 group-hover:opacity-100">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteAccount(a.id)} className="p-1.5 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700 opacity-0 group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink/40 italic">
                  No hay cuentas que coincidan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccountModal account={editing} onClose={() => setEditing(null)} onSave={saveAccount} />
      )}
    </>
  );
}

function AccountModal({
  account,
  onClose,
  onSave,
}: {
  account: Account;
  onClose: () => void;
  onSave: (a: Account) => void;
}) {
  const [a, setA] = useState<Account>(account);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!a.platform.trim()) return;
    onSave({ ...a, platform: a.platform.trim() });
  }

  return (
    <Modal title={account.platform ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plataforma">
            <input autoFocus value={a.platform} onChange={e => setA({ ...a, platform: e.target.value })} className="input" placeholder="LinkedIn" />
          </Field>
          <Field label="Marca">
            <input value={a.brand} onChange={e => setA({ ...a, brand: e.target.value })} className="input" placeholder="Thinfinity" />
          </Field>
          <Field label="Categoría">
            <input value={a.category} onChange={e => setA({ ...a, category: e.target.value })} className="input" placeholder="Redes sociales" />
          </Field>
          <Field label="Estado">
            <select value={a.status} onChange={e => setA({ ...a, status: e.target.value as Account['status'] })} className="select">
              <option value="activa">Activa</option>
              <option value="revisar">Revisar</option>
              <option value="necesita-trabajo">Necesita trabajo</option>
              <option value="inactiva">Inactiva</option>
            </select>
          </Field>
        </div>
        <Field label="URL">
          <input value={a.url} onChange={e => setA({ ...a, url: e.target.value })} className="input" placeholder="https://..." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Responsable">
            <input value={a.owner} onChange={e => setA({ ...a, owner: e.target.value })} className="input" />
          </Field>
          <Field label="Último review">
            <input type="date" value={a.lastReview} onChange={e => setA({ ...a, lastReview: e.target.value })} className="input" />
          </Field>
        </div>
        <Field label="Notas">
          <textarea value={a.notes} onChange={e => setA({ ...a, notes: e.target.value })} className="textarea" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" className="btn-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
