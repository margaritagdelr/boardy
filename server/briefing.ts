import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, hasGeminiKey } from './gemini.js';
import { readInbox } from './inbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BRIEFING_PATH = path.join(DATA_DIR, 'briefing.json');
const TODOS_PATH = path.join(DATA_DIR, 'todos.json');
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');

export type Briefing = {
  date: string;          // YYYY-MM-DD
  text: string;          // narrative paragraph from Gemini
  generatedAt: string;   // ISO timestamp
  stats: {
    pendientes: number;
    enCurso: number;
    alta: number;
    vencidos: number;
    venceHoy: number;
    venceProximo: number; // next 3 days
    nuevosInbox: number;
    cuentasAtencion: number;
  };
};

const SYSTEM_PROMPT = `Sos una asistente que prepara un briefing matutino para una Manager de Web y Diseño.
Te paso datos resumidos de sus pendientes, mensajes nuevos y cuentas a revisar.

Tu tarea: escribir un único párrafo de 3-5 oraciones en español rioplatense (voseo, registro de oficina informal) que la ponga al día sobre el día.

Tono: amistoso, claro, accionable. Como si fueras una compañera que llegó temprano y le hace el "qué hay para hoy".

Reglas:
- No uses viñetas, listas ni títulos. Solo un párrafo corrido.
- Mencioná lo más importante primero: deadlines, prioridades altas, urgencias.
- Si hay nada de qué preocuparse, decilo (no inventes urgencia).
- Si hay pendientes vencidos o que vencen hoy, destacarlos.
- No copies literalmente los títulos — parafraseá y agrupá si conviene.
- Empezá con un saludo corto ("Buen día!", "Hola!", o similar).
- No menciones números genéricos como "tenés 5 pendientes" — solo si es relevante.
- Si hay una cuenta de redes/stores que necesita atención, mencionala con nombre.`;

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function buildContextSummary(today: string): Promise<{ prompt: string; stats: Briefing['stats'] }> {
  type Todo = {
    id: string;
    title: string;
    priority: 'alta' | 'media' | 'baja';
    status: 'pendiente' | 'en-curso' | 'hecho';
    notes: string;
    dueDate: string;
  };
  type Account = {
    platform: string;
    brand: string;
    status: 'activa' | 'revisar' | 'necesita-trabajo' | 'inactiva';
    notes: string;
  };

  const todosData = await readJson<{ todos: Todo[] }>(TODOS_PATH, { todos: [] });
  const accountsData = await readJson<{ accounts: Account[] }>(ACCOUNTS_PATH, { accounts: [] });
  const inboxState = await readInbox();

  const open = todosData.todos.filter(t => t.status !== 'hecho');
  const venceHoy = open.filter(t => t.dueDate === today);
  const vencidos = open.filter(t => t.dueDate && t.dueDate < today);
  const proximo3 = (() => {
    const limit = new Date(today);
    limit.setDate(limit.getDate() + 3);
    const limitIso = limit.toISOString().slice(0, 10);
    return open.filter(t => t.dueDate && t.dueDate > today && t.dueDate <= limitIso);
  })();
  const alta = open.filter(t => t.priority === 'alta');
  const inboxNuevos = inboxState.items.filter(i => i.status === 'nuevo');
  const cuentasAtencion = accountsData.accounts.filter(
    a => a.status === 'revisar' || a.status === 'necesita-trabajo',
  );

  const stats: Briefing['stats'] = {
    pendientes: open.filter(t => t.status === 'pendiente').length,
    enCurso: open.filter(t => t.status === 'en-curso').length,
    alta: alta.length,
    vencidos: vencidos.length,
    venceHoy: venceHoy.length,
    venceProximo: proximo3.length,
    nuevosInbox: inboxNuevos.length,
    cuentasAtencion: cuentasAtencion.length,
  };

  const lines: string[] = [];
  lines.push(`Hoy es ${today}.`);
  lines.push('');

  if (vencidos.length > 0) {
    lines.push(`VENCIDOS (${vencidos.length}):`);
    for (const t of vencidos.slice(0, 5)) {
      lines.push(`- [${t.priority}] "${trimTitle(t.title)}" venció ${t.dueDate}`);
    }
    lines.push('');
  }

  if (venceHoy.length > 0) {
    lines.push(`VENCE HOY (${venceHoy.length}):`);
    for (const t of venceHoy.slice(0, 5)) {
      lines.push(`- [${t.priority}] "${trimTitle(t.title)}"`);
    }
    lines.push('');
  }

  if (proximo3.length > 0) {
    lines.push(`VENCE EN PRÓXIMOS 3 DÍAS (${proximo3.length}):`);
    for (const t of proximo3.slice(0, 5)) {
      lines.push(`- [${t.priority}] "${trimTitle(t.title)}" vence ${t.dueDate}`);
    }
    lines.push('');
  }

  const altaSinFecha = alta.filter(t => !t.dueDate && !venceHoy.includes(t) && !vencidos.includes(t));
  if (altaSinFecha.length > 0) {
    lines.push(`ALTA PRIORIDAD sin fecha (${altaSinFecha.length}):`);
    for (const t of altaSinFecha.slice(0, 5)) {
      lines.push(`- "${trimTitle(t.title)}"`);
    }
    lines.push('');
  }

  const otrosPendientes = open.filter(
    t => t.priority !== 'alta' && !t.dueDate && !venceHoy.includes(t),
  );
  if (otrosPendientes.length > 0) {
    lines.push(`OTROS PENDIENTES: ${otrosPendientes.length} (sin fecha ni prioridad alta)`);
    lines.push('');
  }

  if (inboxNuevos.length > 0) {
    lines.push(`MENSAJES NUEVOS EN BANDEJA: ${inboxNuevos.length}`);
    for (const item of inboxNuevos.slice(0, 3)) {
      lines.push(`- de ${item.senderDisplayName}: "${trimTitle(item.text)}"`);
    }
    lines.push('');
  }

  if (cuentasAtencion.length > 0) {
    lines.push(`CUENTAS QUE REQUIEREN ATENCIÓN (${cuentasAtencion.length}):`);
    for (const a of cuentasAtencion.slice(0, 5)) {
      lines.push(`- ${a.platform} (${a.brand}) — estado: ${a.status}${a.notes ? ` — ${trimTitle(a.notes)}` : ''}`);
    }
  }

  return { prompt: lines.join('\n'), stats };
}

function trimTitle(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > 100 ? clean.slice(0, 100) + '…' : clean;
}

export async function readBriefing(): Promise<Briefing | null> {
  try {
    const raw = await fs.readFile(BRIEFING_PATH, 'utf-8');
    return JSON.parse(raw) as Briefing;
  } catch {
    return null;
  }
}

async function writeBriefing(b: Briefing): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BRIEFING_PATH, JSON.stringify(b, null, 2) + '\n', 'utf-8');
}

// Returns today's briefing — cached if already generated today, otherwise generates fresh.
// If `force` is true, always regenerates.
export async function getOrGenerateBriefing(force = false): Promise<Briefing | null> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = await readBriefing();
  if (!force && cached && cached.date === today) return cached;

  if (!(await hasGeminiKey())) {
    // Without LLM we still return a stub briefing built from stats, so the UI shows something useful.
    const { stats } = await buildContextSummary(today);
    return {
      date: today,
      text: buildStubBriefing(stats),
      generatedAt: new Date().toISOString(),
      stats,
    };
  }

  const { prompt, stats } = await buildContextSummary(today);
  const text = await generateText(SYSTEM_PROMPT, prompt, 500);
  if (!text) {
    // Gemini failed — fall back to stub but don't cache it (so we retry next request).
    return {
      date: today,
      text: buildStubBriefing(stats),
      generatedAt: new Date().toISOString(),
      stats,
    };
  }

  const briefing: Briefing = {
    date: today,
    text,
    generatedAt: new Date().toISOString(),
    stats,
  };
  await writeBriefing(briefing);
  return briefing;
}

function buildStubBriefing(stats: Briefing['stats']): string {
  const parts: string[] = ['Buen día!'];
  if (stats.vencidos > 0) parts.push(`Tenés ${stats.vencidos} pendiente${stats.vencidos === 1 ? '' : 's'} vencido${stats.vencidos === 1 ? '' : 's'}.`);
  if (stats.venceHoy > 0) parts.push(`${stats.venceHoy} vence${stats.venceHoy === 1 ? '' : 'n'} hoy.`);
  if (stats.alta > 0) parts.push(`${stats.alta} de alta prioridad.`);
  if (stats.nuevosInbox > 0) parts.push(`${stats.nuevosInbox} mensaje${stats.nuevosInbox === 1 ? '' : 's'} nuevo${stats.nuevosInbox === 1 ? '' : 's'} en la bandeja.`);
  if (stats.cuentasAtencion > 0) parts.push(`${stats.cuentasAtencion} cuenta${stats.cuentasAtencion === 1 ? '' : 's'} requiere${stats.cuentasAtencion === 1 ? '' : 'n'} atención.`);
  if (parts.length === 1) parts.push('Todo al día — buen momento para arrancar algo nuevo.');
  return parts.join(' ');
}
