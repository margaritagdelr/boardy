import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContextBefore, getEnrichedSpaces, getMessageById, getMyUserId, getSpaceReadStates, listMessagesSince, resolveUserNames, type ChatMessage } from './google.js';
import { summarizeConversation, type SummaryMessage } from './gemini.js';
import { applyRules, readRules } from './rules.js';
import { ingestMessages as ingestDocuments, pruneDocumentsByMonitoredSpaces } from './documents.js';

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
  sourceInboxIds?: string[];
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
  // Also prune documents to match the same monitored-space scope.
  await pruneDocumentsByMonitoredSpaces(new Set(settings.monitoredSpaces), settings.monitorAllSpaces);
  if (settings.monitorAllSpaces) return state; // nothing to prune in inbox
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

  // Extract documents (Drive, PDFs, Zoho, Slides, links) from the new messages.
  if (freshItems.length > 0) {
    await ingestDocuments(freshItems);
  }

  // Auto-convert messages tagged "nueva tarea" into pending todos.
  // Runs BEFORE the read-state filter so a message you already opened in Chat
  // (but haven't actually done) still becomes a pending todo.
  const toConvert = freshItems.filter(i => (i.tags ?? []).includes(AUTO_TASK_LABEL));
  const autoTodos = await autoConvertToTodos(toConvert);
  if (autoTodos > 0) {
    const convertedIds = new Set(toConvert.map(i => i.id));
    state.items = state.items.map(i =>
      convertedIds.has(i.id) ? { ...i, status: 'descartado' as const } : i,
    );
  }

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

const CONTEXT_MESSAGES = 5;
const CONTEXT_TEXT_LIMIT = 240;
const CONTEXT_DIVIDER = '— Contexto previo —';
const MESSAGES_DIVIDER = '— Mensajes —';
const SUMMARY_DIVIDER = '— Resumen —';

function toSummaryMessage(m: { senderName: string; senderDisplayName: string; text: string; createTime: string }, myId: string | null): SummaryMessage {
  return {
    senderDisplayName: m.senderDisplayName,
    text: m.text,
    createTime: m.createTime,
    isMe: !!myId && m.senderName === myId,
  };
}

function collectSourceIds(todo: AutoTodo): string[] {
  if (todo.sourceInboxIds && todo.sourceInboxIds.length > 0) return todo.sourceInboxIds;
  if (todo.sourceInboxId) return [todo.sourceInboxId];
  return [];
}

function spaceFromMessageId(messageId: string): string {
  return messageId.split('/').slice(0, 2).join('/');
}

async function autoConvertToTodos(items: InboxItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const file = await readTodosFile();

  // Dedup set: any source ID across both legacy and new fields.
  const alreadyConverted = new Set<string>();
  for (const t of file.todos) {
    for (const id of collectSourceIds(t)) alreadyConverted.add(id);
  }
  const fresh = items.filter(i => !alreadyConverted.has(i.id));
  if (fresh.length === 0) return 0;

  const myId = await getMyUserId();
  const today = new Date().toISOString().slice(0, 10);

  // Group fresh items by space — same space = same conversation.
  const bySpace = new Map<string, InboxItem[]>();
  for (const i of fresh) {
    const list = bySpace.get(i.spaceName) ?? [];
    list.push(i);
    bySpace.set(i.spaceName, list);
  }

  let changed = 0;

  for (const [spaceName, group] of bySpace) {
    group.sort((a, b) => a.createTime.localeCompare(b.createTime));

    // If there's already an open auto-todo from today for this space, append.
    const existing = findMergeTarget(file.todos, spaceName, today);

    if (existing) {
      const existingIds = collectSourceIds(existing);
      existing.sourceInboxIds = [...existingIds, ...group.map(i => i.id)];
      delete existing.sourceInboxId; // migrate legacy single field
      // Refetch all source messages so we can regenerate summary + log cleanly.
      const allMessages = await Promise.all(
        existing.sourceInboxIds.map(id => getMessageById(id)),
      );
      const allValid = allMessages.filter((m): m is ChatMessage => m !== null);
      allValid.sort((a, b) => a.createTime.localeCompare(b.createTime));
      const groupItems = allValid.map(m => ({
        ...m,
        spaceDisplayName: group[0].spaceDisplayName,
        receivedAt: '',
        status: 'descartado' as const,
      })) as InboxItem[];
      const ctxRaw = await getContextBefore(spaceName, allValid[0]?.createTime ?? group[0].createTime, CONTEXT_MESSAGES + groupItems.length);
      const cleanCtx = ctxRaw
        .filter(m => !existing.sourceInboxIds!.includes(m.id))
        .slice(-CONTEXT_MESSAGES);
      const result = await summarizeConversation({
        spaceDisplayName: group[0].spaceDisplayName,
        context: cleanCtx.map(m => toSummaryMessage(m, myId)),
        messages: groupItems.map(m => toSummaryMessage(m, myId)),
        todayIso: today,
      });
      existing.notes = buildBundledNotes(groupItems, cleanCtx, myId, result.summary);
      // Only set dueDate if the todo doesn't already have one (don't overwrite user edits).
      if (result.dueDate && !existing.dueDate) existing.dueDate = result.dueDate;
      changed++;
    } else {
      const first = group[0];
      const context = await getContextBefore(spaceName, first.createTime, CONTEXT_MESSAGES);
      const result = await summarizeConversation({
        spaceDisplayName: first.spaceDisplayName,
        context: context.map(m => toSummaryMessage(m, myId)),
        messages: group.map(m => toSummaryMessage(m, myId)),
        todayIso: today,
      });
      file.todos.push({
        id: `todo-${Math.random().toString(36).slice(2, 9)}`,
        title: buildBundledTitle(group),
        priority: 'media',
        status: 'pendiente',
        tags: ['chat', 'auto'],
        notes: buildBundledNotes(group, context, myId, result.summary),
        createdAt: today,
        dueDate: result.dueDate ?? '',
        sourceInboxIds: group.map(i => i.id),
      });
      changed++;
    }
  }

  if (changed > 0) await writeTodosFile(file);
  return changed;
}

function findMergeTarget(todos: AutoTodo[], spaceName: string, today: string): AutoTodo | undefined {
  for (const t of todos) {
    if (t.status === 'hecho') continue;
    if (t.createdAt !== today) continue;
    const ids = collectSourceIds(t);
    if (ids.length === 0) continue;
    if (spaceFromMessageId(ids[0]) === spaceName) return t;
  }
  return undefined;
}

function buildBundledTitle(group: InboxItem[]): string {
  const first = group[0];
  const firstLine = first.text.split('\n')[0].trim();
  const base = firstLine.slice(0, 90) || `Conversación con ${first.senderDisplayName}`;
  return group.length > 1 ? `${base} (+${group.length - 1})` : base;
}

function buildBundledNotes(group: InboxItem[], context: ChatMessage[], myId: string | null, summary?: string | null): string {
  const first = group[0];
  const lines: string[] = [];
  lines.push(`Conversación en ${first.spaceDisplayName}:`);

  if (summary && summary.trim() && summary.trim() !== '(sin tarea clara)') {
    lines.push('');
    lines.push(SUMMARY_DIVIDER);
    lines.push(summary.trim());
  }

  if (context.length > 0) {
    lines.push('');
    lines.push(CONTEXT_DIVIDER);
    for (const m of context) {
      lines.push(formatMessageLine(m, myId));
    }
  }

  lines.push('');
  lines.push(MESSAGES_DIVIDER);
  for (const item of group) {
    lines.push(formatMessageLine(item, myId));
  }
  return lines.join('\n');
}

function formatMessageLine(m: { senderName: string; senderDisplayName: string; text: string; createTime: string }, myId: string | null): string {
  const sender = myId && m.senderName === myId ? 'Vos' : m.senderDisplayName;
  const time = formatTime(m.createTime);
  const text = m.text.replace(/\s+/g, ' ').trim();
  const truncated = text.length > CONTEXT_TEXT_LIMIT ? text.slice(0, CONTEXT_TEXT_LIMIT) + '…' : text;
  return `[${sender}${time ? ', ' + time : ''}] ${truncated || '(sin texto)'}`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

// Consolidates auto-todos that belong to the same space + day into a single bundled todo.
// Also regenerates summaries for single auto-todos that don't have one yet.
// Refetches source messages from Chat to rebuild the notes cleanly. Idempotent.
export async function consolidateAutoTodos(): Promise<{ merged: number; removed: number; groupsProcessed: number; summarized: number }> {
  const file = await readTodosFile();
  const myId = await getMyUserId();

  // Group auto-todos (those with any source ID) by spaceName + createdAt.
  const groups = new Map<string, AutoTodo[]>();
  for (const t of file.todos) {
    const ids = collectSourceIds(t);
    if (ids.length === 0) continue;
    const space = spaceFromMessageId(ids[0]);
    const key = `${space}|${t.createdAt}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  let merged = 0;
  let removed = 0;
  let groupsProcessed = 0;
  let summarized = 0;

  for (const [, todosInGroup] of groups) {
    const needsMerge = todosInGroup.length >= 2;
    const needsSummary = !todosInGroup[0].notes.includes(SUMMARY_DIVIDER);
    if (!needsMerge && !needsSummary) continue;
    groupsProcessed++;

    // Collect all source IDs across this group.
    const allSourceIds = Array.from(
      new Set(todosInGroup.flatMap(t => collectSourceIds(t))),
    );

    // Refetch each source message in parallel.
    const fetched = await Promise.all(allSourceIds.map(id => getMessageById(id)));
    const messages = fetched.filter((m): m is ChatMessage => m !== null);
    if (messages.length === 0) continue;
    messages.sort((a, b) => a.createTime.localeCompare(b.createTime));

    // Use the first todo as the target (preserve its id, status, priority, dueDate, etc.).
    const target = todosInGroup[0];
    const space = spaceFromMessageId(allSourceIds[0]);
    const spaceDisplayName = inferSpaceDisplayName(target, messages);
    const context = await getContextBefore(space, messages[0].createTime, CONTEXT_MESSAGES + messages.length);
    const cleanContext = context
      .filter(m => !allSourceIds.includes(m.id))
      .slice(-CONTEXT_MESSAGES);

    // Build a group-like array of "InboxItem-ish" entries for the bundled formatter.
    const groupItems = messages.map(m => ({
      ...m,
      spaceDisplayName,
      receivedAt: '',
      status: 'descartado' as const,
    })) as InboxItem[];

    const today = new Date().toISOString().slice(0, 10);
    const result = await summarizeConversation({
      spaceDisplayName,
      context: cleanContext.map(m => toSummaryMessage(m, myId)),
      messages: groupItems.map(m => toSummaryMessage(m, myId)),
      todayIso: today,
    });

    target.title = buildBundledTitle(groupItems);
    target.notes = buildBundledNotes(groupItems, cleanContext, myId, result.summary);
    target.sourceInboxIds = allSourceIds;
    delete target.sourceInboxId;
    if (result.dueDate && !target.dueDate) target.dueDate = result.dueDate;
    if (needsMerge) merged++;
    if (result.summary) summarized++;

    // Drop the rest of the todos in this group.
    for (let i = 1; i < todosInGroup.length; i++) {
      const idx = file.todos.indexOf(todosInGroup[i]);
      if (idx >= 0) {
        file.todos.splice(idx, 1);
        removed++;
      }
    }
  }

  if (merged > 0 || removed > 0 || summarized > 0) await writeTodosFile(file);
  return { merged, removed, groupsProcessed, summarized };
}

function inferSpaceDisplayName(target: AutoTodo, _messages: ChatMessage[]): string {
  // Try to extract from existing notes header — fallback to the space resource id.
  const headerMatch = target.notes.match(/^(?:De [^\n]+ en|Conversación en) ([^:\n]+):/);
  if (headerMatch) return headerMatch[1].trim();
  const ids = collectSourceIds(target);
  return ids[0] ? spaceFromMessageId(ids[0]) : '(space desconocido)';
}

export async function enrichExistingAutoTodos(): Promise<{ enriched: number; skipped: number }> {
  const file = await readTodosFile();
  const myId = await getMyUserId();
  let enriched = 0;
  let skipped = 0;

  const targets = file.todos.filter(
    t => t.sourceInboxId && !t.notes.includes('— Contexto previo —'),
  );

  if (targets.length === 0) return { enriched: 0, skipped: 0 };

  const beforeIso = new Date().toISOString();
  const enrichments = await Promise.all(
    targets.map(async t => {
      const spaceName = t.sourceInboxId!.split('/').slice(0, 2).join('/'); // "spaces/XXX"
      const ctx = await getContextBefore(spaceName, beforeIso, CONTEXT_MESSAGES + 1);
      // Drop the target message itself from context if it's in there.
      const filtered = ctx.filter(m => m.id !== t.sourceInboxId).slice(-CONTEXT_MESSAGES);
      return { todoId: t.id, context: filtered };
    }),
  );

  for (const { todoId, context } of enrichments) {
    if (context.length === 0) {
      skipped++;
      continue;
    }
    const todo = file.todos.find(t => t.id === todoId)!;
    // Reconstruct: original notes already have "De {sender} en {space}:\n\n{text}"
    // We rebuild by parsing the original sender/space line and the message text.
    const original = todo.notes;
    const headerMatch = original.match(/^De ([^\n]+) en ([^:\n]+):\n\n([\s\S]*)$/);
    if (!headerMatch) {
      skipped++;
      continue;
    }
    const [, senderName, spaceDisplayName, text] = headerMatch;
    todo.notes = buildNotesWithContextRaw({
      senderDisplayName: senderName,
      spaceDisplayName,
      text,
    }, context, myId);
    enriched++;
  }

  if (enriched > 0) await writeTodosFile(file);
  return { enriched, skipped };
}

function buildNotesWithContextRaw(
  item: { senderDisplayName: string; spaceDisplayName: string; text: string },
  context: ChatMessage[],
  myId: string | null,
): string {
  const lines: string[] = [];
  lines.push(`De ${item.senderDisplayName} en ${item.spaceDisplayName}:`);
  if (context.length > 0) {
    lines.push('');
    lines.push('— Contexto previo —');
    for (const m of context) {
      const sender = myId && m.senderName === myId ? 'Vos' : m.senderDisplayName;
      const text = m.text.replace(/\s+/g, ' ').trim();
      const truncated = text.length > CONTEXT_TEXT_LIMIT ? text.slice(0, CONTEXT_TEXT_LIMIT) + '…' : text;
      lines.push(`[${sender}] ${truncated || '(sin texto)'}`);
    }
    lines.push('— Mensaje —');
  } else {
    lines.push('');
  }
  lines.push(item.text);
  return lines.join('\n');
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
