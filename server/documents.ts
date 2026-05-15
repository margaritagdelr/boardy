import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatAttachment, ChatMessage } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(ROOT, 'data', 'documents.json');

export type DocKind =
  | 'drive-doc'
  | 'drive-sheet'
  | 'drive-slide'
  | 'drive-folder'
  | 'drive-file'
  | 'pdf'
  | 'zoho'
  | 'figma'
  | 'link';

export type Document = {
  id: string;
  kind: DocKind;
  url: string;
  title: string;
  mimeType?: string;
  sourceMessageId: string;
  spaceName: string;
  spaceDisplayName: string;
  senderName: string;
  senderDisplayName: string;
  createTime: string;
  capturedAt: string;
};

export type DocumentsState = { documents: Document[] };

const DEFAULT_STATE: DocumentsState = { documents: [] };
const MAX_DOCS = 1000;

export async function readDocuments(): Promise<DocumentsState> {
  try {
    return JSON.parse(await fs.readFile(DOCS_PATH, 'utf-8')) as DocumentsState;
  } catch {
    return DEFAULT_STATE;
  }
}

export async function writeDocuments(state: DocumentsState): Promise<void> {
  await fs.mkdir(path.dirname(DOCS_PATH), { recursive: true });
  await fs.writeFile(DOCS_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;

export function extractFromMessage(m: ChatMessage): Document[] {
  const out: Document[] = [];
  const seenUrls = new Set<string>();

  // URLs in text
  const urlMatches = m.text?.match(URL_REGEX) ?? [];
  for (const raw of urlMatches) {
    const url = raw.replace(/[.,;:)\]]+$/, ''); // strip trailing punctuation
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const { kind, label } = classifyUrl(url);
    out.push(buildDoc(m, kind, url, label));
  }

  // Attachments (Drive shares, uploaded files)
  for (const att of m.attachments ?? []) {
    const url = attachmentUrl(att);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const kind = classifyAttachment(att);
    const title = att.contentName?.trim() || labelByKind(kind);
    out.push(buildDoc(m, kind, url, title, att.contentType));
  }

  return out;
}

function classifyUrl(url: string): { kind: DocKind; label: string } {
  const u = url.toLowerCase();
  if (u.includes('docs.google.com/document')) return { kind: 'drive-doc', label: 'Google Docs' };
  if (u.includes('docs.google.com/spreadsheets')) return { kind: 'drive-sheet', label: 'Google Sheets' };
  if (u.includes('docs.google.com/presentation') || u.includes('slides.google.com'))
    return { kind: 'drive-slide', label: 'Google Slides' };
  if (u.includes('drive.google.com/drive/folders')) return { kind: 'drive-folder', label: 'Carpeta Drive' };
  if (u.includes('drive.google.com')) return { kind: 'drive-file', label: 'Archivo Drive' };
  if (u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('.pdf#'))
    return { kind: 'pdf', label: 'PDF' };
  if (u.includes('zoho.com') || u.includes('zohopublic.com')) return { kind: 'zoho', label: 'Zoho' };
  if (u.includes('figma.com')) return { kind: 'figma', label: 'Figma' };
  try {
    return { kind: 'link', label: new URL(url).hostname.replace(/^www\./, '') };
  } catch {
    return { kind: 'link', label: 'Link' };
  }
}

function classifyAttachment(att: ChatAttachment): DocKind {
  const mime = (att.contentType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('document') || mime.includes('msword') || mime.includes('officedocument.wordprocessingml')) return 'drive-doc';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('officedocument.spreadsheetml')) return 'drive-sheet';
  if (mime.includes('presentation') || mime.includes('powerpoint') || mime.includes('officedocument.presentationml')) return 'drive-slide';
  if (att.driveFileId) return 'drive-file';
  return 'link';
}

function attachmentUrl(att: ChatAttachment): string | null {
  if (att.driveFileId) return `https://drive.google.com/file/d/${att.driveFileId}/view`;
  if (att.downloadUri) return att.downloadUri;
  return null;
}

function labelByKind(kind: DocKind): string {
  switch (kind) {
    case 'drive-doc':    return 'Google Docs';
    case 'drive-sheet':  return 'Google Sheets';
    case 'drive-slide':  return 'Google Slides';
    case 'drive-folder': return 'Carpeta Drive';
    case 'drive-file':   return 'Archivo Drive';
    case 'pdf':          return 'PDF';
    case 'zoho':         return 'Zoho';
    case 'figma':        return 'Figma';
    case 'link':         return 'Link';
  }
}

function buildDoc(
  m: ChatMessage,
  kind: DocKind,
  url: string,
  fallbackTitle: string,
  mimeType?: string,
): Document {
  return {
    id: `${m.id}::${hash(url)}`,
    kind,
    url,
    title: deriveTitle(url, fallbackTitle),
    mimeType,
    sourceMessageId: m.id,
    spaceName: m.spaceName,
    spaceDisplayName: m.spaceDisplayName,
    senderName: m.senderName,
    senderDisplayName: m.senderDisplayName,
    createTime: m.createTime,
    capturedAt: new Date().toISOString(),
  };
}

function deriveTitle(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    // For known SaaS link forms, return the fallback (the kind label is more useful than the path).
    if (
      u.hostname.endsWith('docs.google.com') ||
      u.hostname.endsWith('drive.google.com') ||
      u.hostname.endsWith('slides.google.com') ||
      u.hostname.endsWith('figma.com') ||
      u.hostname.includes('zoho')
    ) {
      return fallback;
    }
    // For PDFs and arbitrary files, try the last path segment.
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    if (last) return last.length > 80 ? last.slice(0, 80) + '…' : last;
    return fallback;
  } catch {
    return fallback;
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export async function ingestMessages(messages: ChatMessage[]): Promise<number> {
  if (messages.length === 0) return 0;
  const state = await readDocuments();
  const seen = new Set(state.documents.map(d => d.id));
  let added = 0;
  for (const m of messages) {
    for (const doc of extractFromMessage(m)) {
      if (seen.has(doc.id)) continue;
      state.documents.push(doc);
      seen.add(doc.id);
      added++;
    }
  }
  if (added > 0) {
    state.documents.sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
    if (state.documents.length > MAX_DOCS) state.documents.length = MAX_DOCS;
    await writeDocuments(state);
  }
  return added;
}

export async function pruneDocumentsByMonitoredSpaces(
  monitored: Set<string>,
  monitorAll: boolean,
): Promise<number> {
  if (monitorAll) return 0;
  const state = await readDocuments();
  const before = state.documents.length;
  state.documents = state.documents.filter(d => monitored.has(d.spaceName));
  if (state.documents.length !== before) await writeDocuments(state);
  return before - state.documents.length;
}

export async function deleteDocument(id: string): Promise<DocumentsState> {
  const state = await readDocuments();
  state.documents = state.documents.filter(d => d.id !== id);
  await writeDocuments(state);
  return state;
}
