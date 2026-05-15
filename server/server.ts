import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import {
  clearEnrichedSpacesCache,
  deleteToken,
  exchangeCode,
  getAuthUrl,
  getEnrichedSpaces,
  hasCredentials,
  hasToken,
} from './google.js';
import {
  consolidateAutoTodos,
  dismissItem,
  enrichExistingAutoTodos,
  markStatus,
  pollNow,
  pruneInboxBySettings,
  readInbox,
  readSettings,
  retagAllItems,
  startPollingLoop,
  writeSettings,
  type Settings,
} from './inbox.js';
import { readRules, writeRules, type RulesData } from './rules.js';
import { getOrGenerateBriefing } from './briefing.js';
import { deleteDocument, ingestMessages as ingestDocuments, readDocuments } from './documents.js';
import type { ChatMessage } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DIST_DIR = path.join(ROOT, 'dist');

const ALLOWED_DATA = new Set(['links', 'accounts', 'todos']);

const app = express();
app.use(express.json({ limit: '5mb' }));

// ----- Generic data files (links, accounts, todos) -----

app.get('/api/data/:name', async (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_DATA.has(name)) return res.status(400).json({ error: 'unknown dataset' });
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${name}.json`), 'utf-8');
    res.type('application/json').send(raw);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/data/:name', async (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_DATA.has(name)) return res.status(400).json({ error: 'unknown dataset' });
  try {
    const pretty = JSON.stringify(req.body, null, 2) + '\n';
    await fs.writeFile(path.join(DATA_DIR, `${name}.json`), pretty, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ----- Google OAuth -----

app.get('/api/google/auth/status', async (_req, res) => {
  res.json({
    hasCredentials: await hasCredentials(),
    hasToken: await hasToken(),
  });
});

app.post('/api/google/auth/start', async (_req, res) => {
  try {
    const url = await getAuthUrl();
    await open(url); // launches default browser
    res.json({ ok: true, url });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/google/auth/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const err = typeof req.query.error === 'string' ? req.query.error : null;
  if (err) {
    return res.status(400).send(htmlPage(`Autorización cancelada: ${err}`, false));
  }
  if (!code) {
    return res.status(400).send(htmlPage('Falta el parámetro "code"', false));
  }
  try {
    await exchangeCode(code);
    await startPollingLoop();
    res.send(htmlPage('¡Listo! Ya podés cerrar esta pestaña y volver a Boardy.', true));
  } catch (e) {
    res.status(500).send(htmlPage(`Error: ${(e as Error).message}`, false));
  }
});

app.post('/api/google/auth/signout', async (_req, res) => {
  await deleteToken();
  res.json({ ok: true });
});

app.get('/api/google/spaces', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    if (force) clearEnrichedSpacesCache();
    const spaces = await getEnrichedSpaces(force);
    res.json({ spaces });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ----- Inbox + settings -----

app.get('/api/inbox', async (_req, res) => {
  res.json(await readInbox());
});

app.post('/api/inbox/refresh', async (_req, res) => {
  try {
    const result = await pollNow();
    const state = await readInbox();
    res.json({ result, state });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/inbox/:id', async (req, res) => {
  const state = await dismissItem(req.params.id);
  res.json(state);
});

app.get('/api/briefing', async (_req, res) => {
  try {
    const b = await getOrGenerateBriefing(false);
    res.json(b);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/briefing/regenerate', async (_req, res) => {
  try {
    const b = await getOrGenerateBriefing(true);
    res.json(b);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/todos/consolidate', async (_req, res) => {
  try {
    const result = await consolidateAutoTodos();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/todos/enrich-context', async (_req, res) => {
  try {
    const result = await enrichExistingAutoTodos();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/inbox/:id/status', async (req, res) => {
  const { status } = req.body as { status: 'nuevo' | 'descartado' };
  const state = await markStatus(req.params.id, status);
  res.json(state);
});

app.get('/api/documents', async (_req, res) => {
  res.json(await readDocuments());
});

// Backfill: re-extract documents from current inbox items (URLs only — attachments need a fresh poll).
app.post('/api/documents/backfill', async (_req, res) => {
  try {
    const inbox = await readInbox();
    const messages: ChatMessage[] = inbox.items.map(i => ({
      id: i.id,
      spaceName: i.spaceName,
      spaceDisplayName: i.spaceDisplayName,
      senderName: i.senderName,
      senderDisplayName: i.senderDisplayName,
      text: i.text,
      createTime: i.createTime,
      threadName: i.threadName,
    }));
    const added = await ingestDocuments(messages);
    const state = await readDocuments();
    res.json({ added, total: state.documents.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  const state = await deleteDocument(req.params.id);
  res.json(state);
});

app.get('/api/settings', async (_req, res) => {
  res.json(await readSettings());
});

app.get('/api/rules', async (_req, res) => {
  res.json(await readRules());
});

app.put('/api/rules', async (req, res) => {
  const incoming = req.body as RulesData;
  if (!incoming || !Array.isArray(incoming.rules)) {
    return res.status(400).json({ error: 'invalid rules payload' });
  }
  await writeRules(incoming);
  await retagAllItems();
  const inbox = await readInbox();
  const rules = await readRules();
  res.json({ rules: rules.rules, inbox });
});

app.put('/api/settings', async (req, res) => {
  const incoming = req.body as Partial<Settings>;
  const current = await readSettings();
  const next: Settings = {
    pollingIntervalMinutes: Math.max(1, Number(incoming.pollingIntervalMinutes ?? current.pollingIntervalMinutes)),
    monitoredSpaces: incoming.monitoredSpaces ?? current.monitoredSpaces,
    monitorAllSpaces: incoming.monitorAllSpaces ?? current.monitorAllSpaces,
  };
  await writeSettings(next);
  await pruneInboxBySettings(); // remove items from spaces no longer monitored
  await startPollingLoop();
  res.json(next);
});

// ----- Static (prod only) -----

const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

const PORT = Number(process.env.PORT) || 5174;
app.listen(PORT, async () => {
  console.log(`[boardy] server listening on http://localhost:${PORT}`);
  if (await hasToken()) {
    await startPollingLoop();
    console.log('[boardy] polling loop started');
  }
});

function htmlPage(message: string, ok: boolean): string {
  const color = ok ? '#0a8a3f' : '#b91c1c';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Boardy</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:white;padding:2rem 2.5rem;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,0.06);max-width:480px;text-align:center}
.dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};margin-bottom:12px}
h1{font-size:1.1rem;margin:0 0 .5rem;color:#0f172a}
p{margin:0;color:#475569}</style></head>
<body><div class="card"><div class="dot"></div><h1>Boardy</h1><p>${message}</p></div></body></html>`;
}
