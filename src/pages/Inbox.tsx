import { useCallback, useEffect, useState } from 'react';
import { Inbox as InboxIcon, RefreshCw, Settings as SettingsIcon, Trash2, Plus, ExternalLink, AlertCircle, CheckCircle2, Search, User, Users, Hash, Tag, GripVertical } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Modal, Field } from './Dashboard';
import { TodoModal } from './Todos';
import { newId } from '../api';
import type { AuthStatus, ChatSpace, InboxItem, InboxState, Rule, RuleColor, RulesData, Settings, Todo, TodosData } from '../types';

export default function Inbox({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [state, setState] = useState<InboxState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<{ item: InboxItem; draft: Todo } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rulesByLabel, setRulesByLabel] = useState<Record<string, Rule>>({});
  const [sortMode, setSortMode] = useState<'recientes' | 'antiguos' | 'conversacion'>('recientes');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const loadRules = useCallback(async () => {
    const d = await fetch('/api/rules').then(r => r.json() as Promise<RulesData>);
    const map: Record<string, Rule> = {};
    for (const r of d.rules) map[r.label] = r;
    setRulesByLabel(map);
  }, []);

  const refresh = useCallback(async () => {
    const s = await fetch('/api/google/auth/status').then(r => r.json() as Promise<AuthStatus>);
    setAuth(s);
    if (s.hasToken) {
      const inb = await fetch('/api/inbox').then(r => r.json() as Promise<InboxState>);
      setState(inb);
    }
  }, []);

  useEffect(() => {
    refresh();
    loadRules();
    const t = setInterval(refresh, 60_000); // re-check every minute for new inbox items
    return () => clearInterval(t);
  }, [refresh, loadRules]);

  useEffect(() => {
    if (!state || !onCountChange) return;
    onCountChange(state.items.filter(i => i.status === 'nuevo').length);
  }, [state, onCountChange]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/google/auth/start', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'No se pudo iniciar OAuth');
      // Browser opened by server. Poll for hasToken.
      const start = Date.now();
      while (Date.now() - start < 5 * 60 * 1000) {
        await new Promise(res => setTimeout(res, 2000));
        const s = await fetch('/api/google/auth/status').then(r => r.json() as Promise<AuthStatus>);
        if (s.hasToken) {
          await refresh();
          await doRefreshPoll();
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!confirm('¿Desconectar Google Chat? El refresh token local se borra.')) return;
    await fetch('/api/google/auth/signout', { method: 'POST' });
    await refresh();
  }

  async function doRefreshPoll() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/inbox/refresh', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error al refrescar');
      if (j.result?.error) setError(j.result.error);
      setState(j.state);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(id: string) {
    const r = await fetch(`/api/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const next = (await r.json()) as InboxState;
    setState(next);
  }

  function startConvert(item: InboxItem) {
    const today = new Date().toISOString().slice(0, 10);
    const title = item.text.split('\n')[0].slice(0, 100) || `Mensaje de ${item.senderDisplayName}`;
    const draft: Todo = {
      id: newId('todo'),
      title,
      priority: 'media',
      status: 'pendiente',
      tags: ['chat'],
      notes: `De ${item.senderDisplayName} en ${item.spaceDisplayName}:\n\n${item.text}`,
      createdAt: today,
      dueDate: '',
    };
    setConverting({ item, draft });
  }

  async function saveConverted(todo: Todo) {
    if (!converting) return;
    // Read current todos, append, save.
    const current = await fetch('/api/data/todos').then(r => r.json() as Promise<TodosData>);
    const next: TodosData = { todos: [...current.todos, todo] };
    await fetch('/api/data/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    await dismiss(converting.item.id);
    setConverting(null);
  }

  if (!auth) return <div className="text-slate-500">Cargando…</div>;

  if (!auth.hasCredentials) {
    return (
      <>
        <PageHeader title="Bandeja de Chat" subtitle="Mensajes de Google Chat para convertir en pendientes." />
        <NoCredentialsCard />
      </>
    );
  }

  if (!auth.hasToken) {
    return (
      <>
        <PageHeader title="Bandeja de Chat" subtitle="Mensajes de Google Chat para convertir en pendientes." />
        <ConnectCard onConnect={connect} busy={busy} error={error} />
      </>
    );
  }

  const allNew = (state?.items ?? []).filter(i => i.status === 'nuevo');

  const tagCounts = new Map<string, number>();
  for (const i of allNew) {
    for (const t of i.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  const filteredItems = allNew.filter(i => {
    if (activeTags.size > 0) {
      if (!(i.tags ?? []).some(t => activeTags.has(t))) return false;
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${i.senderDisplayName} ${i.spaceDisplayName} ${i.text}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const newItems = [...filteredItems].sort((a, b) =>
    sortMode === 'antiguos'
      ? a.createTime > b.createTime ? 1 : -1
      : a.createTime < b.createTime ? 1 : -1,
  );

  const groupedItems = sortMode === 'conversacion' ? groupByConversation(filteredItems) : null;

  return (
    <>
      <PageHeader
        title="Bandeja de Chat"
        subtitle={
          state?.lastPolledAt
            ? `Último chequeo: ${formatRelative(state.lastPolledAt)}`
            : 'Sin chequear todavía.'
        }
        actions={
          <>
            <button
              onClick={doRefreshPoll}
              disabled={busy}
              className="inline-flex items-center gap-1 btn-secondary disabled:opacity-50"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refrescar
            </button>
            <button onClick={() => setShowRules(true)} className="inline-flex items-center gap-1 btn-secondary">
              <Tag size={14} /> Etiquetas
            </button>
            <button onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1 btn-secondary">
              <SettingsIcon size={14} /> Configurar
            </button>
            <button onClick={signOut} className="text-xs text-ink-soft hover:text-terracota-700 ml-1">
              Desconectar
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-md bg-terracota-50 border border-terracota-200 text-terracota-700 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {allNew.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por persona, conversación o texto…"
                className="input pl-9 text-sm"
              />
            </div>
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as 'recientes' | 'antiguos' | 'conversacion')}
              className="select w-auto text-sm"
              title="Ordenar"
            >
              <option value="recientes">Más recientes</option>
              <option value="antiguos">Más antiguos</option>
              <option value="conversacion">Por conversación</option>
            </select>
          </div>

          {tagCounts.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveTags(new Set())}
                className={[
                  'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium transition',
                  activeTags.size === 0
                    ? 'bg-ink text-paper'
                    : 'bg-paper border border-ink-mute text-ink/70 hover:bg-cream',
                ].join(' ')}
              >
                Todos <span className="opacity-60 ml-1">({allNew.length})</span>
              </button>
              {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => {
                const active = activeTags.has(tag);
                const ruleColor = rulesByLabel[tag]?.color ?? 'sage';
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      const next = new Set(activeTags);
                      if (active) next.delete(tag); else next.add(tag);
                      setActiveTags(next);
                    }}
                    className={[
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition border',
                      active
                        ? `${TAG_COLOR_STYLES[ruleColor]} border-transparent ring-1 ring-ink/30`
                        : 'bg-paper border-ink-mute text-ink/70 hover:bg-cream',
                    ].join(' ')}
                  >
                    <Tag size={10} className="opacity-70" />
                    {tag} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {allNew.length === 0 ? (
        <div className="text-center py-16 text-ink/40">
          <CheckCircle2 size={32} className="mx-auto mb-2 text-terracota-400" />
          <p className="italic">No hay mensajes nuevos para procesar.</p>
          <p className="text-xs mt-1">Boardy revisa cada {state ? 'el intervalo configurado' : '...'} cuando está corriendo.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12 text-ink/40 italic">
          Ningún mensaje matchea los filtros activos.
        </div>
      ) : groupedItems ? (
        <div className="space-y-5">
          {groupedItems.map(group => (
            <section key={group.spaceName}>
              <header className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-xs font-semibold text-ink/70 uppercase tracking-wide mono flex items-center gap-2">
                  <span>{group.spaceDisplayName || '(sin nombre)'}</span>
                  <span className="text-ink/40 font-normal normal-case">·</span>
                  <span className="text-ink/40 font-normal normal-case">{group.items.length}</span>
                </h3>
              </header>
              <ul className="space-y-2">
                {group.items.map(item => (
                  <InboxItemRow
                    key={item.id}
                    item={item}
                    rulesByLabel={rulesByLabel}
                    onConvert={() => startConvert(item)}
                    onDismiss={() => dismiss(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {newItems.map(item => (
            <InboxItemRow
              key={item.id}
              item={item}
              rulesByLabel={rulesByLabel}
              onConvert={() => startConvert(item)}
              onDismiss={() => dismiss(item.id)}
            />
          ))}
        </ul>
      )}

      {converting && (
        <TodoModal
          todo={converting.draft}
          onClose={() => setConverting(null)}
          onSave={saveConverted}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false);
            refresh(); // re-fetch inbox so the prune is reflected immediately
          }}
        />
      )}

      {showRules && (
        <RulesModal
          onClose={() => {
            setShowRules(false);
            loadRules();
            refresh(); // tags may have been re-applied to existing items
          }}
        />
      )}
    </>
  );
}

function NoCredentialsCard() {
  return (
    <div className="bg-ochre-100 border border-ochre-700/20 rounded-lg p-6">
      <h3 className="font-semibold text-ochre-700 mb-2 tracking-tight2">Falta el archivo de credenciales</h3>
      <p className="text-sm text-ink/75 mb-3">
        Boardy no encuentra <code className="px-1.5 py-0.5 bg-paper border border-ink-mute rounded text-xs mono">.boardy-secrets/google-credentials.json</code>.
      </p>
      <ol className="list-decimal list-inside text-sm text-ink/80 space-y-1">
        <li>Andá a Google Cloud Console y creá un OAuth Client tipo "Desktop app".</li>
        <li>Descargá el JSON y renombralo a <code className="px-1.5 py-0.5 bg-paper border border-ink-mute rounded text-xs mono">google-credentials.json</code>.</li>
        <li>Guardalo en la carpeta <code className="px-1.5 py-0.5 bg-paper border border-ink-mute rounded text-xs mono">.boardy-secrets/</code> de este proyecto.</li>
        <li>Refrescá esta página.</li>
      </ol>
    </div>
  );
}

function ConnectCard({ onConnect, busy, error }: { onConnect: () => void; busy: boolean; error: string | null }) {
  return (
    <div className="bg-paper border border-ink-mute rounded-lg p-10 text-center shadow-sm">
      <InboxIcon size={40} className="mx-auto mb-3 text-terracota" />
      <h3 className="text-xl font-bold mb-1 tracking-tight2 text-ink">Conectá tu Google Chat</h3>
      <p className="text-sm text-ink/70 max-w-md mx-auto mb-5">
        Boardy va a leer periódicamente mensajes de tus DMs y spaces para que no se te pierda ninguna tarea que te pasen por ahí.
      </p>
      <button
        onClick={onConnect}
        disabled={busy}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-terracota hover:bg-terracota-600 text-ink font-semibold disabled:opacity-50"
      >
        {busy ? <RefreshCw size={16} className="animate-spin" /> : <ExternalLink size={16} />}
        {busy ? 'Esperando autorización…' : 'Conectar con Google'}
      </button>
      {error && <p className="text-sm text-terracota-700 mt-3">{error}</p>}
      <p className="text-xs text-ink/40 mt-6">
        Permisos solicitados: leer mensajes, listar spaces y directorio. Solo lectura, nunca posteo en tu nombre.
      </p>
    </div>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [spaces, setSpaces] = useState<ChatSpace[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [query, setQuery] = useState('');

  const loadSpaces = useCallback(async (force = false) => {
    setLoadingSpaces(true);
    try {
      const url = force ? '/api/google/spaces?refresh=1' : '/api/google/spaces';
      const r = await fetch(url).then(r => r.json() as Promise<{ spaces: ChatSpace[] }>);
      setSpaces(r.spaces ?? []);
    } finally {
      setLoadingSpaces(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json() as Promise<Settings>).then(setSettings);
    loadSpaces();
  }, [loadSpaces]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    onClose();
  }

  function toggleSpace(name: string, checked: boolean) {
    if (!settings) return;
    const next = checked
      ? [...settings.monitoredSpaces, name]
      : settings.monitoredSpaces.filter(x => x !== name);
    setSettings({ ...settings, monitoredSpaces: next });
  }

  function selectAllInGroup(names: string[]) {
    if (!settings) return;
    const set = new Set([...settings.monitoredSpaces, ...names]);
    setSettings({ ...settings, monitoredSpaces: [...set] });
  }

  function clearAllInGroup(names: string[]) {
    if (!settings) return;
    const remove = new Set(names);
    setSettings({ ...settings, monitoredSpaces: settings.monitoredSpaces.filter(x => !remove.has(x)) });
  }

  if (!settings) {
    return (
      <Modal title="Configuración" onClose={onClose}>
        <p className="text-ink-soft">Cargando…</p>
      </Modal>
    );
  }

  const grouped = groupSpaces(spaces ?? [], query);
  const selectedCount = settings.monitoredSpaces.length;

  return (
    <Modal title="Configuración de la Bandeja" onClose={onClose} wide>
      <div className="space-y-5">
        <Field label="Intervalo de chequeo (minutos)">
          <input
            type="number"
            min={1}
            max={60}
            value={settings.pollingIntervalMinutes}
            onChange={e => setSettings({ ...settings, pollingIntervalMinutes: Number(e.target.value) })}
            className="input w-32"
          />
        </Field>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ink-soft">¿Qué querés trackear?</span>
            <button
              onClick={() => loadSpaces(true)}
              disabled={loadingSpaces}
              className="text-xs text-ink-soft hover:text-terracota-700 inline-flex items-center gap-1"
            >
              <RefreshCw size={11} className={loadingSpaces ? 'animate-spin' : ''} /> Refrescar lista
            </button>
          </div>

          <label className="flex items-center gap-2 mb-3 text-sm text-ink/80">
            <input
              type="checkbox"
              checked={settings.monitorAllSpaces}
              onChange={e => setSettings({ ...settings, monitorAllSpaces: e.target.checked })}
              className="accent-terracota"
            />
            <span>Monitorear <strong>todo</strong> (todos los DMs, grupos y spaces — bot DMs excluidos)</span>
          </label>

          {!settings.monitorAllSpaces && (
            <>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por nombre…"
                  className="input pl-9 text-sm"
                />
              </div>

              <div className="text-xs text-ink-soft mb-2">
                {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}
              </div>

              <div className="max-h-80 overflow-y-auto border border-ink-mute rounded-md divide-y divide-ink-mute bg-paper">
                {spaces === null && (
                  <p className="text-xs text-ink/40 italic px-3 py-3">Cargando spaces…</p>
                )}
                {spaces !== null && grouped.dms.length === 0 && grouped.groups.length === 0 && grouped.spaces.length === 0 && (
                  <p className="text-xs text-ink/40 italic px-3 py-3">No hay coincidencias.</p>
                )}
                <SpaceGroup
                  title="Mensajes directos"
                  icon={User}
                  items={grouped.dms}
                  settings={settings}
                  onToggle={toggleSpace}
                  onSelectAll={selectAllInGroup}
                  onClearAll={clearAllInGroup}
                />
                <SpaceGroup
                  title="Chats grupales"
                  icon={Users}
                  items={grouped.groups}
                  settings={settings}
                  onToggle={toggleSpace}
                  onSelectAll={selectAllInGroup}
                  onClearAll={clearAllInGroup}
                />
                <SpaceGroup
                  title="Spaces"
                  icon={Hash}
                  items={grouped.spaces}
                  settings={settings}
                  onToggle={toggleSpace}
                  onSelectAll={selectAllInGroup}
                  onClearAll={clearAllInGroup}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SpaceGroup({
  title,
  icon: Icon,
  items,
  settings,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  title: string;
  icon: typeof User;
  items: ChatSpace[];
  settings: Settings;
  onToggle: (name: string, checked: boolean) => void;
  onSelectAll: (names: string[]) => void;
  onClearAll: (names: string[]) => void;
}) {
  if (items.length === 0) return null;
  const names = items.map(i => i.name);
  const selectedInGroup = items.filter(i => settings.monitoredSpaces.includes(i.name)).length;

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 bg-sage-50 sticky top-0 border-b border-ink-mute">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-ink/70 uppercase tracking-wide mono">
          <Icon size={12} /> {title}
          <span className="text-ink/40 font-normal normal-case">
            ({selectedInGroup}/{items.length})
          </span>
        </div>
        <div className="flex gap-3 text-xs">
          <button onClick={() => onSelectAll(names)} className="text-terracota-700 hover:underline">Todos</button>
          <button onClick={() => onClearAll(names)} className="text-ink-soft hover:underline">Ninguno</button>
        </div>
      </div>
      <ul>
        {items.map(s => {
          const checked = settings.monitoredSpaces.includes(s.name);
          return (
            <li key={s.name}>
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-cream text-sm cursor-pointer text-ink/80">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => onToggle(s.name, e.target.checked)}
                  className="accent-terracota"
                />
                <span className="flex-1 truncate" title={s.displayName}>{s.displayName || '(sin nombre)'}</span>
                {typeof s.memberCount === 'number' && s.memberCount > 0 && (
                  <span className="text-[10px] text-ink/40 mono">{s.memberCount}p</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function groupSpaces(spaces: ChatSpace[], query: string) {
  const q = query.trim().toLowerCase();
  const filter = (s: ChatSpace) => !q || s.displayName.toLowerCase().includes(q);
  const sort = (a: ChatSpace, b: ChatSpace) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
  return {
    dms: spaces.filter(s => s.spaceType === 'DIRECT_MESSAGE' && filter(s)).sort(sort),
    groups: spaces.filter(s => s.spaceType === 'GROUP_CHAT' && filter(s)).sort(sort),
    spaces: spaces.filter(s => s.spaceType === 'SPACE' && filter(s)).sort(sort),
  };
}

const TAG_COLOR_STYLES: Record<RuleColor, string> = {
  terracota: 'bg-terracota-100 text-terracota-700',
  ochre:     'bg-ochre-100 text-ochre-700',
  sage:      'bg-sage-100 text-sage-700',
  ink:       'bg-ink/10 text-ink/80',
};

function TagPill({ label, color }: { label: string; color: RuleColor }) {
  return (
    <span className={`pill ${TAG_COLOR_STYLES[color]}`}>
      <Tag size={10} className="mr-0.5 opacity-70" /> {label}
    </span>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<RulesData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/rules').then(r => r.json() as Promise<RulesData>).then(setData);
  }, []);

  function updateRule(id: string, patch: Partial<Rule>) {
    if (!data) return;
    setData({ ...data, rules: data.rules.map(r => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function deleteRule(id: string) {
    if (!data) return;
    if (!confirm('¿Borrar esta regla?')) return;
    setData({ ...data, rules: data.rules.filter(r => r.id !== id) });
  }

  function addRule() {
    if (!data) return;
    const newRule: Rule = {
      id: `rule-${Math.random().toString(36).slice(2, 9)}`,
      label: 'nueva etiqueta',
      color: 'sage',
      matchAny: [],
      enabled: true,
    };
    setData({ ...data, rules: [...data.rules, newRule] });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    await fetch('/api/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSaving(false);
    onClose();
  }

  if (!data) {
    return (
      <Modal title="Etiquetas automáticas" onClose={onClose}>
        <p className="text-ink-soft">Cargando…</p>
      </Modal>
    );
  }

  return (
    <Modal title="Etiquetas automáticas" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-ink-soft">
          Si el mensaje contiene <strong>cualquiera</strong> de las palabras clave (separadas por coma), Boardy le pone la etiqueta.
          Sin distinguir mayúsculas/minúsculas.
        </p>

        <ul className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {data.rules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onChange={p => updateRule(rule.id, p)}
              onDelete={() => deleteRule(rule.id)}
            />
          ))}
        </ul>

        <button
          onClick={addRule}
          className="w-full inline-flex items-center justify-center gap-1 py-2 rounded-md border-2 border-dashed border-ink-mute text-ink-soft hover:text-ink hover:border-terracota-300 text-sm font-medium"
        >
          <Plus size={14} /> Agregar regla
        </button>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar y re-etiquetar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: Rule;
  onChange: (p: Partial<Rule>) => void;
  onDelete: () => void;
}) {
  const colors: RuleColor[] = ['terracota', 'ochre', 'sage', 'ink'];
  return (
    <li className={`border border-ink-mute rounded-md p-3 ${rule.enabled ? 'bg-paper' : 'bg-cream opacity-70'}`}>
      <div className="flex items-center gap-2 mb-2">
        <GripVertical size={14} className="text-ink/30 shrink-0" />
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={e => onChange({ enabled: e.target.checked })}
          className="accent-terracota"
          title="Activar/desactivar"
        />
        <input
          value={rule.label}
          onChange={e => onChange({ label: e.target.value })}
          className="input flex-1 font-semibold"
          placeholder="nombre de la etiqueta"
        />
        <div className="flex gap-0.5">
          {colors.map(c => (
            <button
              key={c}
              onClick={() => onChange({ color: c })}
              className={[
                'w-6 h-6 rounded-full border-2 transition',
                COLOR_SWATCH[c],
                rule.color === c ? 'border-ink ring-2 ring-ink/20' : 'border-ink-mute',
              ].join(' ')}
              title={c}
            />
          ))}
        </div>
        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700"
          title="Borrar regla"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <textarea
        value={rule.matchAny.join(', ')}
        onChange={e => onChange({ matchAny: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        className="textarea text-xs min-h-[50px]"
        placeholder="palabra clave 1, palabra clave 2, frase exacta, ..."
      />
    </li>
  );
}

const COLOR_SWATCH: Record<RuleColor, string> = {
  terracota: 'bg-terracota',
  ochre: 'bg-ochre',
  sage: 'bg-sage',
  ink: 'bg-ink',
};

function InboxItemRow({
  item,
  rulesByLabel,
  onConvert,
  onDismiss,
}: {
  item: InboxItem;
  rulesByLabel: Record<string, Rule>;
  onConvert: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="bg-paper border border-ink-mute rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-ink-soft mb-1 flex-wrap">
            <span className="font-semibold text-ink">{item.senderDisplayName}</span>
            <span className="text-ink/30">·</span>
            <span>{item.spaceDisplayName}</span>
            <span className="text-ink/30">·</span>
            <span className="mono text-[10px]">{formatRelative(item.createTime)}</span>
          </div>
          <div className="text-sm text-ink/85 whitespace-pre-wrap line-clamp-6">
            {item.text || <em className="text-ink/40">(sin texto — quizá un archivo o tarjeta)</em>}
          </div>
          {item.tags && item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map(t => (
                <TagPill key={t} label={t} color={rulesByLabel[t]?.color ?? 'sage'} />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onConvert}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-terracota hover:bg-terracota-600 text-ink text-xs font-semibold"
            title="Convertir a pendiente"
          >
            <Plus size={14} /> Pendiente
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700"
            title="Descartar"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

type ConversationGroup = {
  spaceName: string;
  spaceDisplayName: string;
  items: InboxItem[];
};

function groupByConversation(items: InboxItem[]): ConversationGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const i of items) {
    const arr = groups.get(i.spaceName) ?? [];
    arr.push(i);
    groups.set(i.spaceName, arr);
  }
  const out: ConversationGroup[] = [];
  for (const [spaceName, list] of groups) {
    list.sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
    out.push({ spaceName, spaceDisplayName: list[0].spaceDisplayName, items: list });
  }
  // Sort groups by most-recent message desc
  out.sort((a, b) => (a.items[0].createTime < b.items[0].createTime ? 1 : -1));
  return out;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'recién';
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}
