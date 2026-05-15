import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Folder,
  HardDrive,
  FileType2,
  Database,
  Figma,
  Link2,
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { DocKind, Document, DocumentsState } from '../types';

type KindFilter = 'todos' | DocKind;

const KIND_META: Record<DocKind, { label: string; icon: typeof FileText; color: string }> = {
  'drive-doc':    { label: 'Docs',    icon: FileText,        color: 'bg-sage-100 text-sage-700' },
  'drive-sheet':  { label: 'Sheets',  icon: FileSpreadsheet, color: 'bg-sage-100 text-sage-700' },
  'drive-slide':  { label: 'Slides',  icon: Presentation,    color: 'bg-ochre-100 text-ochre-700' },
  'drive-folder': { label: 'Carpeta', icon: Folder,          color: 'bg-ochre-100 text-ochre-700' },
  'drive-file':   { label: 'Drive',   icon: HardDrive,       color: 'bg-sage-100 text-sage-700' },
  'pdf':          { label: 'PDF',     icon: FileType2,       color: 'bg-terracota-100 text-terracota-700' },
  'zoho':         { label: 'Zoho',    icon: Database,        color: 'bg-ochre-100 text-ochre-700' },
  'figma':        { label: 'Figma',   icon: Figma,           color: 'bg-terracota-100 text-terracota-700' },
  'link':         { label: 'Link',    icon: Link2,           color: 'bg-ink/10 text-ink/70' },
};

export default function Documents() {
  const [state, setState] = useState<DocumentsState | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('todos');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const d = await fetch('/api/documents').then(r => r.json() as Promise<DocumentsState>);
    setState(d);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function backfill() {
    setBusy(true);
    try {
      await fetch('/api/documents/backfill', { method: 'POST' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Sacar este documento del listado? (no toca nada en Chat ni Drive)')) return;
    const r = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const next = (await r.json()) as DocumentsState;
    setState(next);
  }

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLowerCase();
    return state.documents.filter(d => {
      if (kindFilter !== 'todos' && d.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.url.toLowerCase().includes(q) ||
        d.senderDisplayName.toLowerCase().includes(q) ||
        d.spaceDisplayName.toLowerCase().includes(q)
      );
    });
  }, [state, query, kindFilter]);

  const counts = useMemo(() => {
    const out: Record<KindFilter, number> = {
      todos: state?.documents.length ?? 0,
      'drive-doc': 0, 'drive-sheet': 0, 'drive-slide': 0, 'drive-folder': 0, 'drive-file': 0,
      pdf: 0, zoho: 0, figma: 0, link: 0,
    };
    state?.documents.forEach(d => { out[d.kind] += 1; });
    return out;
  }, [state]);

  if (!state) return <div className="text-ink-soft">Cargando…</div>;

  const KIND_ORDER: DocKind[] = ['drive-doc', 'drive-sheet', 'drive-slide', 'drive-folder', 'drive-file', 'pdf', 'figma', 'zoho', 'link'];

  return (
    <>
      <PageHeader
        title="Documentos"
        subtitle="Archivos y links compartidos en los chats que monitoreás."
        actions={
          <button
            onClick={backfill}
            disabled={busy}
            className="inline-flex items-center gap-1 btn-secondary disabled:opacity-50"
            title="Re-escanear inbox actual buscando links"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Escanear inbox
          </button>
        }
      />

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por título, URL, persona o conversación…"
            className="input pl-9"
          />
        </div>
      </div>

      <div className="flex gap-1.5 mb-5 flex-wrap">
        <FilterChip active={kindFilter === 'todos'} onClick={() => setKindFilter('todos')} label={`Todos (${counts.todos})`} />
        {KIND_ORDER.filter(k => counts[k] > 0).map(k => (
          <FilterChip
            key={k}
            active={kindFilter === k}
            onClick={() => setKindFilter(k)}
            label={`${KIND_META[k].label} (${counts[k]})`}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-ink/40">
          {state.documents.length === 0 ? (
            <>
              <FileText size={32} className="mx-auto mb-2 text-ink/30" />
              <p className="italic">Todavía no hay documentos.</p>
              <p className="text-xs mt-1">A medida que te lleguen mensajes con links de Drive, PDFs o Zoho, van a aparecer acá.</p>
            </>
          ) : (
            <p className="italic">No hay documentos que coincidan con el filtro.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(d => (
            <DocumentRow key={d.id} doc={d} onDelete={() => remove(d.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded-md text-xs font-medium transition',
        active
          ? 'bg-ink text-paper'
          : 'bg-paper border border-ink-mute text-ink/70 hover:bg-cream',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function DocumentRow({ doc, onDelete }: { doc: Document; onDelete: () => void }) {
  const meta = KIND_META[doc.kind];
  const Icon = meta.icon;
  return (
    <li className="bg-paper border border-ink-mute rounded-lg p-3 shadow-sm group hover:bg-cream transition">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-md shrink-0 ${meta.color}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-ink hover:text-terracota-700 truncate"
              title={doc.url}
            >
              {doc.title}
            </a>
            <span className={`pill ${meta.color}`}>{meta.label}</span>
          </div>
          <div className="text-xs text-ink-soft mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{doc.senderDisplayName}</span>
            <span className="text-ink/30">·</span>
            <span>{doc.spaceDisplayName || '(sin nombre)'}</span>
            <span className="text-ink/30">·</span>
            <span className="mono text-[10px]">{formatRelative(doc.createTime)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded hover:bg-sage-100 text-ink/50 hover:text-ink"
            title="Abrir"
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-terracota-100 text-ink/40 hover:text-terracota-700"
            title="Sacar del listado"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
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
  const days = Math.round(hr / 24);
  if (days < 30) return `hace ${days} d`;
  return date.toLocaleString('es-AR', { dateStyle: 'short' });
}
