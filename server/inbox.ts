import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnrichedSpaces, getMyUserId, getSpaceReadStates, listMessagesSince, resolveUserNames, type ChatMessage } from './google.js';
import { applyRules, readRules } from './rules.js';

const AUTO_TASK_LABEL = 'nueva tarea';

type AutoTodo = {
  id: string;
  title: string;
  priority: 'alta' | 'media' | 'baja';
  status: 'pendiente' | 'en-curso' | 'hecho';
  tags: string[];
  notes: string;
  createdAt: string;
  dueDate: string;
  sourceInboxId?: string;
};

type TodosFile = { todos: AutoTodo[] };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INBOX_PATH = path.join(DATA_DIR, 'inbox.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const TODOS_PATH = path.join(DATA_DIR, 'todos.json');

export type InboxItem = ChatMessage & {
  receivedAt: string;
  status: 'nuevo' | 'descartado';
  tags?: string[];
};

export type InboxState = {
  items: InboxItem[];
  perSpaceLastSeen: Record<string, string>;
  lastPolledAt: string | null;
};

export type Settings = {
  pollingIntervalMinutes: number;
  monitoredSpaces: string[]; // space.name resource ids; empty array = all spaces
  monitorAllSpaces: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  pollingIntervalMinutes: 10,
  monitoredSpaces: [],
  monitorAllSpaces: true,
};

const DEFAULT_STATE: InboxState = {
  items: [],
  perSpaceLastSeen: {},
  lastPolledAt: null,
};

async function ensureFile<T>(p: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(defaultValue, null, 2) + '\n', 'utf-8');
    return defaultValue;
  }
}

export async function readInbox(): Promise<InboxState> {
  return ensureFile(INBOX_PATH, DEFAULT_STATE);
}

export async function writeInbox(state: InboxState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INBOX_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export async function readSettings(): Promise<Settings> {
  return ensureFile(SETTINGS_PATH, DEFAULT_SETTINGS);
}

export async function writeSettings(s: Settings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n', 'utf-8');
}

const FIRST_POLL_LOOKBACK_MS = 10 * 60 * 1000; // 10 minutes

export async function retagAllItems(): Promise<InboxState> {
  const state = await readInbox();
  const rulesData = await readRules();
  state.items = state.items.map(i => ({ ...i, tags: applyRules(rulesData.rules, i.text) }));
  await writeInbox(state);
  return state;
}

export async function pruneInboxBySettings(): Promise<InboxState> {
  const state = await readInbox();
  const settings = await readSettings();
  if (settings.monitorAllSpaces) return state; // nothing to prune
  const monitored = new Set(settings.monitoredSpaces);
  const before = state.items.length;
  state.items = state.items.filter(i => monitored.has(i.spaceName));
  if (state.items.length !== before) {
    await writeInbox(state);
  }
  return state;
}

export async function pollNow(): Promise<{ newCount: number; checkedSpaces: number; autoTodos: number; error?: string }> {
  // Drop items from spaces that are no longer monitored (so narrowing settings cleans the inbox).
  await pruneInboxBySettings();
  let state = await readInbox();
  const settings = await readSettings();
  let spaces;
  try {
    spaces = await getEnrichedSpaces();
  } catch (err) {
    return { newCount: 0, checkedSpaces: 0, autoTodos: 0, error: (err as Error).message };
  }

  let target = settings.monitorAllSpaces
    ? spaces
    : spaces.filter(s => settings.monitoredSpaces.includes(s.name));

  // Skip bot DMs — those are conversations with apps, not people sending tasks.
  target = target.filter(s => !s.singleUserBotDm);

  const lookbackIso = new Date(Date.now() - FIRST_POLL_LOOKBACK_MS).toISOString();

  // Set baseline for never-before-seen spaces so first poll fetches only last 10 min.
  for (const s of target) {
    if (!state.perSpaceLastSeen[s.name]) {
      state.perSpaceLastSeen[s.name] = lookbackIso;
    }
  }

  const rulesData = await readRules();
  const myId = await getMyUserId();

  // Parallelize per-space fetches (was sequential — main cause of slowness).
  const results = await Promise.allSettled(
    target.map(s => listMessagesSince(s.name, s.displayName, state.perSpaceLastSeen[s.name])),
  );

  // Collect all sender resource names from new messages AND existing unresolved ones.
  const sendersToResolve = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const m of r.value) {
      if (m.senderName) sendersToResolve.add(m.senderName);
    }
  }
  // Also enrich already-stored items that have an unresolved-looking display name.
  for (const item of state.items) {
    if (item.senderName && needsResolve(item.senderDisplayName)) {
      sendersToResolve.add(item.senderName);
    }
  }
  const resolved = sendersToResolve.size > 0
    ? await resolveUserNames([...sendersToResolve])
    : {};

  // Apply resolved names to pre-existing items.
  for (const item of state.items) {
    if (resolved[item.senderName]) item.senderDisplayName = resolved[item.senderName];
  }

  let newCount = 0;
  const seenIds = new Set(state.items.map(i => i.id));
  const freshItems: InboxItem[] = [];

  results.forEach((result, i) => {
    const space = target[i];
    if (result.status === 'rejected') {
      console.warn(`[inbox] error listing ${space.name}:`, (result.reason as Error)?.message ?? result.reason);
      return;
    }
    const msgs = result.value;
    let maxTime = state.perSpaceLastSeen[space.name];
    for (const m of msgs) {
      if (seenIds.has(m.id)) continue;
      // Skip messages I sent — those aren't tasks coming in to me.
      if (myId && m.senderName === myId) {
        if (m.createTime > maxTime) maxTime = m.createTime;
        seenIds.add(m.id);
        continue;
      }
      const display = resolved[m.senderName] || m.senderDisplayName; // resolved beats Chat's value
      const item: InboxItem = {
        ...m,
        senderDisplayName: display,
        receivedAt: new Date().toISOString(),
        status: 'nuevo',
        tags: applyRules(rulesData.rules, m.text),
      };
      state.items.push(item);
      freshItems.push(item);
      seenIds.add(m.id);
      newCount++;
      if (m.createTime > maxTime) maxTime = m.createTime;
    }
    if (maxTime) state.perSpaceLastSeen[space.name] = maxTime;
  });

  // Sync with Google Chat read-state: drop items already read in Chat.
  // Silently degrades if the scope isn't granted (returns {}).
  const readStates = await getSpaceReadStates(target.map(s => s.name));
  if (Object.keys(readStates).length > 0) {
    const before = state.items.length;
    state.items = state.items.filter(i => {
      const lastRead = readStates[i.spaceName];
      return !lastRead || i.createTime > lastRead;
    });
    if (state.items.length !== before) {
      console.log(`[inbox] dropped ${before - state.items.length} item(s) already read in Chat`);
    }
  }

  // Auto-convert messages tagged "nueva tarea" into pending todos.
  // Only items that survived the read-state filter become todos.
  const survivingIds = new Set(state.items.map(i => i.id));
  const toConvert = freshItems.filter(i => survivingIds.has(i.id) && (i.tags ?? []).includes(AUTO_TASK_LABEL));
  const autoTodos = await autoConvertToTodos(toConvert);
  if (autoTodos > 0) {
    const convertedIds = new Set(toConvert.map(i => i.id));
    state.items = state.items.map(i =>
      convertedIds.has(i.id) ? { ...i, status: 'descartado' as const } : i,
    );
  }

  state.lastPolledAt = new Date().toISOString();
  state = capInbox(state);
  await writeInbox(state);
  return { newCount, checkedSpaces: target.length, autoTodos };
}

async function readTodosFile(): Promise<TodosFile> {
  try {
    const raw = await fs.readFile(TODOS_PATH, 'utf-8');
    return JSON.parse(raw) as TodosFile;
  } catch {
    return { todos: [] };
  }
}

async function writeTodosFile(data: TodosFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TODOS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function autoConvertToTodos(items: InboxItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const file = await readTodosFile();
  const alreadyConverted = new Set(file.todos.map(t => t.sourceInboxId).filter(Boolean));
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const item of items) {
    if (alreadyConverted.has(item.id)) continue;
    const title = item.text.split('\n')[0].slice(0, 100) || `Mensaje de ${item.senderDisplayName}`;
    file.todos.push({
      id: `todo-${Math.random().toString(36).slice(2, 9)}`,
      title,
      priority: 'media',
      status: 'pendiente',
      tags: ['chat', 'auto'],
      notes: `De ${item.senderDisplayName} en ${item.spaceDisplayName}:\n\n${item.text}`,
      createdAt: today,
      dueDate: '',
      sourceInboxId: item.id,
    });
    added++;
  }
  if (added > 0) await writeTodosFile(file);
  return added;
}

function needsResolve(displayName: string | undefined): boolean {
  if (!displayName) return true;
  return displayName === '(desconocido)' || displayName.startsWith('Usuario ');
}

function capInbox(state: InboxState): InboxState {
  // Keep only the last 500 items to avoid runaway growth
  if (state.items.length <= 500) return state;
  state.items = state.items.slice(-500);
  return state;
}

export async function dismissItem(id: string): Promise<InboxState> {
  const state = await readInbox();
  state.items = state.items.filter(i => i.id !== id);
  await writeInbox(state);
  return state;
}

export async function markStatus(id: string, status: InboxItem['status']): Promise<InboxState> {
  const state = await readInbox();
  state.items = state.items.map(i => (i.id === id ? { ...i, status } : i));
  await writeInbox(state);
  return state;
}

let pollTimer: NodeJS.Timeout | null = null;

export async function startPollingLoop(): Promise<void> {
  stopPollingLoop();
  const settings = await readSettings();
  const ms = Math.max(1, settings.pollingIntervalMinutes) * 60 * 1000;
  pollTimer = setInterval(async () => {
    try {
      const { newCount, checkedSpaces, autoTodos, error } = await pollNow();
      if (error) {
        console.log(`[inbox] poll skipped: ${error}`);
      } else if (newCount > 0 || autoTodos > 0) {
        console.log(`[inbox] polled ${checkedSpaces} spaces, ${newCount} new message(s)${autoTodos > 0 ? `, ${autoTodos} auto-todo(s)` : ''}`);
      }
    } catch (err) {
      console.warn('[inbox] poll error:', (err as Error).message);
    }
  }, ms);
}

export function stopPollingLoop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
