import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SECRETS_DIR = path.join(ROOT, '.boardy-secrets');
const CREDS_PATH = path.join(SECRETS_DIR, 'google-credentials.json');
const TOKEN_PATH = path.join(SECRETS_DIR, 'google-token.json');
const PEOPLE_CACHE_PATH = path.join(SECRETS_DIR, 'people-cache.json');

export const REDIRECT_URI = 'http://localhost:5174/api/google/auth/callback';

export const SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
  'https://www.googleapis.com/auth/chat.users.readstate.readonly',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
];

type GoogleCredentialsFile = {
  installed?: { client_id: string; client_secret: string; redirect_uris?: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris?: string[] };
};

type SavedToken = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readCreds(): Promise<{ client_id: string; client_secret: string }> {
  if (!(await fileExists(CREDS_PATH))) {
    throw new Error(
      `No se encontró .boardy-secrets/google-credentials.json. Descargalo de Google Cloud Console (OAuth Client "Desktop app") y guardalo ahí.`,
    );
  }
  const raw = await fs.readFile(CREDS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as GoogleCredentialsFile;
  const block = parsed.installed ?? parsed.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error('google-credentials.json no tiene formato esperado (falta installed/web).');
  }
  return { client_id: block.client_id, client_secret: block.client_secret };
}

async function readToken(): Promise<SavedToken | null> {
  if (!(await fileExists(TOKEN_PATH))) return null;
  const raw = await fs.readFile(TOKEN_PATH, 'utf-8');
  return JSON.parse(raw) as SavedToken;
}

async function writeToken(token: SavedToken): Promise<void> {
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf-8');
}

export async function deleteToken(): Promise<void> {
  if (await fileExists(TOKEN_PATH)) {
    await fs.unlink(TOKEN_PATH);
  }
}

export async function hasCredentials(): Promise<boolean> {
  return fileExists(CREDS_PATH);
}

export async function hasToken(): Promise<boolean> {
  return fileExists(TOKEN_PATH);
}

async function buildClient(): Promise<OAuth2Client> {
  const { client_id, client_secret } = await readCreds();
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

export async function getAuthUrl(): Promise<string> {
  const client = await buildClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = await buildClient();
  const { tokens } = await client.getToken(code);
  await writeToken(tokens);
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const client = await buildClient();
  const token = await readToken();
  if (!token) throw new Error('No hay token guardado. Conectá tu cuenta de Google primero.');
  client.setCredentials(stripNulls(token));
  // Persist refreshed access tokens
  client.on('tokens', async newTokens => {
    const merged: SavedToken = { ...token, ...newTokens };
    await writeToken(merged);
  });
  return client;
}

function stripNulls(t: SavedToken): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(t)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

export type ChatSpace = {
  name: string;
  displayName: string;
  spaceType: string;
  singleUserBotDm?: boolean;
  memberCount?: number;
};

export async function listSpaces(): Promise<ChatSpace[]> {
  const auth = await getAuthenticatedClient();
  const chat = google.chat({ version: 'v1', auth });
  const out: ChatSpace[] = [];
  let pageToken: string | undefined;
  do {
    const res = await chat.spaces.list({ pageSize: 100, pageToken });
    for (const s of res.data.spaces ?? []) {
      if (!s.name) continue;
      out.push({
        name: s.name,
        displayName: s.displayName ?? '',
        spaceType: s.spaceType ?? 'UNKNOWN',
        singleUserBotDm: s.singleUserBotDm ?? false,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

let myUserIdCache: string | null | undefined;
export async function getMyUserId(): Promise<string | null> {
  if (myUserIdCache !== undefined) return myUserIdCache;
  try {
    const auth = await getAuthenticatedClient();
    const people = google.people({ version: 'v1', auth });
    const res = await people.people.get({ resourceName: 'people/me', personFields: 'metadata' });
    const id = res.data.metadata?.sources?.find(s => s.type === 'PROFILE')?.id;
    myUserIdCache = id ? `users/${id}` : null;
  } catch (err) {
    console.warn('[people] could not resolve "me":', (err as Error).message);
    myUserIdCache = null;
  }
  return myUserIdCache;
}

let enrichedSpacesCache: { at: number; spaces: ChatSpace[] } | null = null;
const ENRICHED_TTL_MS = 60 * 60 * 1000; // 1h

export async function getEnrichedSpaces(force = false): Promise<ChatSpace[]> {
  if (!force && enrichedSpacesCache && Date.now() - enrichedSpacesCache.at < ENRICHED_TTL_MS) {
    return enrichedSpacesCache.spaces;
  }

  const spaces = await listSpaces();
  const me = await getMyUserId();
  const auth = await getAuthenticatedClient();
  const chat = google.chat({ version: 'v1', auth });

  // Only fetch members for DM/Group spaces missing a name. Named SPACES already have a title.
  const needsMembers = spaces.filter(
    s => !s.displayName && (s.spaceType === 'DIRECT_MESSAGE' || s.spaceType === 'GROUP_CHAT'),
  );

  const memberResults = await Promise.allSettled(
    needsMembers.map(s => chat.spaces.members.list({ parent: s.name, pageSize: 30 })),
  );

  const peersBySpace: Record<string, string[]> = {};
  const memberCountBySpace: Record<string, number> = {};
  const peerIds = new Set<string>();

  memberResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const space = needsMembers[i];
    const peers: string[] = [];
    for (const m of r.value.data.memberships ?? []) {
      const userName = m.member?.name;
      if (!userName) continue;
      peers.push(userName);
      if (userName !== me) peerIds.add(userName);
    }
    peersBySpace[space.name] = peers;
    memberCountBySpace[space.name] = peers.length;
  });

  const resolved = peerIds.size > 0 ? await resolveUserNames([...peerIds]) : {};

  const enriched: ChatSpace[] = spaces.map(s => {
    const memberCount = memberCountBySpace[s.name];
    if (s.displayName) return { ...s, memberCount };

    const peers = (peersBySpace[s.name] ?? []).filter(p => p !== me);
    const names = peers.map(p => resolved[p] || senderFallback({ name: p, type: 'HUMAN' }));

    let displayName: string;
    if (s.spaceType === 'DIRECT_MESSAGE') {
      displayName = names[0] ?? 'DM sin título';
    } else if (s.spaceType === 'GROUP_CHAT') {
      displayName = names.length > 0 ? names.join(', ').slice(0, 80) : 'Grupo sin título';
    } else {
      displayName = 'Sin título';
    }
    return { ...s, displayName, memberCount };
  });

  enrichedSpacesCache = { at: Date.now(), spaces: enriched };
  return enriched;
}

export function clearEnrichedSpacesCache(): void {
  enrichedSpacesCache = null;
  myUserIdCache = undefined;
}

function senderFallback(sender: { name?: string | null; type?: string | null } | null | undefined): string {
  if (!sender?.name) return '(remitente desconocido)';
  const id = sender.name.replace(/^users\//, '');
  if (sender.type === 'BOT') return `App (${id.slice(0, 6)}…)`;
  return `Usuario ${id.slice(0, 6)}…`;
}

// ----- People API: resolve user IDs to display names with cache -----

let peopleCache: Record<string, string> | null = null;

async function readPeopleCache(): Promise<Record<string, string>> {
  if (peopleCache !== null) return peopleCache;
  try {
    const raw = await fs.readFile(PEOPLE_CACHE_PATH, 'utf-8');
    peopleCache = JSON.parse(raw) as Record<string, string>;
  } catch {
    peopleCache = {};
  }
  return peopleCache;
}

async function flushPeopleCache(): Promise<void> {
  if (!peopleCache) return;
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  await fs.writeFile(PEOPLE_CACHE_PATH, JSON.stringify(peopleCache, null, 2) + '\n', 'utf-8');
}

// Resolves a set of "users/XXX" resource names to their display names via People API.
// Returns only successfully-resolved entries. Caches results (including misses) on disk.
export async function resolveUserNames(userResourceNames: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (userResourceNames.length === 0) return out;

  const cache = await readPeopleCache();
  const toLookup: string[] = [];

  for (const u of userResourceNames) {
    if (cache[u] !== undefined) {
      if (cache[u]) out[u] = cache[u];
    } else {
      toLookup.push(u);
    }
  }

  if (toLookup.length === 0) return out;

  try {
    const auth = await getAuthenticatedClient();
    const people = google.people({ version: 'v1', auth });
    // getBatchGet allows up to 200 resource names per request.
    for (let i = 0; i < toLookup.length; i += 200) {
      const batch = toLookup.slice(i, i + 200);
      const res = await people.people.getBatchGet({
        resourceNames: batch.map(u => `people/${u.replace(/^users\//, '')}`),
        personFields: 'names',
      });
      const responses = res.data.responses ?? [];
      for (let j = 0; j < responses.length; j++) {
        const r = responses[j];
        const requested = r.requestedResourceName ?? `people/${batch[j].replace(/^users\//, '')}`;
        const userId = `users/${requested.replace(/^people\//, '')}`;
        const name = r.person?.names?.[0]?.displayName ?? '';
        cache[userId] = name; // store even empty string so we don't retry hopelessly
        if (name) out[userId] = name;
      }
    }
    await flushPeopleCache();
  } catch (err) {
    console.warn('[people] lookup failed:', (err as Error).message);
  }

  return out;
}

export type ChatMessage = {
  id: string; // full resource name: spaces/XXX/messages/YYY
  spaceName: string;
  spaceDisplayName: string;
  senderName: string;
  senderDisplayName: string;
  text: string;
  createTime: string;
  threadName?: string;
  webUri?: string;
};

const MAX_PAGES_PER_SPACE = 5; // 5 pages * 100 = 500 messages cap per poll per space
const MAX_MS_PER_SPACE = 8000; // skip if listing takes longer than 8s

// Per-space last-read timestamps (ISO) from Google Chat's spaceReadState.
// Returns {} if the scope was not granted yet — caller should treat as "no sync available".
export async function getSpaceReadStates(spaceNames: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (spaceNames.length === 0) return out;
  let auth;
  try {
    auth = await getAuthenticatedClient();
  } catch {
    return out;
  }
  const chat = google.chat({ version: 'v1', auth });

  const results = await Promise.allSettled(
    spaceNames.map(name =>
      chat.users.spaces.getSpaceReadState({ name: `users/me/${name}/spaceReadState` }),
    ),
  );

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const lastReadTime = r.value.data.lastReadTime;
    if (lastReadTime) out[spaceNames[i]] = lastReadTime;
  });

  return out;
}

export async function listMessagesSince(
  spaceName: string,
  spaceDisplayName: string,
  sinceIso: string | undefined,
): Promise<ChatMessage[]> {
  const auth = await getAuthenticatedClient();
  const chat = google.chat({ version: 'v1', auth });
  const filter = sinceIso ? `createTime > "${sinceIso}"` : undefined;
  const out: ChatMessage[] = [];
  let pageToken: string | undefined;
  const start = Date.now();
  for (let page = 0; page < MAX_PAGES_PER_SPACE; page++) {
    if (Date.now() - start > MAX_MS_PER_SPACE) {
      console.warn(`[chat] timeout listing ${spaceName} after ${page} page(s)`);
      break;
    }
    const res = await chat.spaces.messages.list({
      parent: spaceName,
      pageSize: 100,
      pageToken,
      filter,
      orderBy: 'createTime asc',
    });
    for (const m of res.data.messages ?? []) {
      if (!m.name || !m.createTime) continue;
      if (!m.sender?.displayName) {
        console.log('[chat] sender without displayName:', JSON.stringify(m.sender));
      }
      out.push({
        id: m.name,
        spaceName,
        spaceDisplayName,
        senderName: m.sender?.name ?? '',
        senderDisplayName: m.sender?.displayName || senderFallback(m.sender),
        text: m.text ?? '',
        createTime: m.createTime,
        threadName: m.thread?.name ?? undefined,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return out;
}
