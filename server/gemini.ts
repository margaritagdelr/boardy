import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEY_PATH = path.join(ROOT, '.boardy-secrets', 'gemini-key.txt');

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

let cachedKey: string | null | undefined;

async function readApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  try {
    const raw = await fs.readFile(KEY_PATH, 'utf-8');
    const key = raw.trim();
    cachedKey = key || null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

export async function hasGeminiKey(): Promise<boolean> {
  return (await readApiKey()) !== null;
}

export function invalidateGeminiKeyCache(): void {
  cachedKey = undefined;
}

export type SummaryMessage = {
  senderDisplayName: string;
  text: string;
  createTime: string;
  isMe: boolean;
};

export type SummarizeInput = {
  spaceDisplayName: string;
  context: SummaryMessage[];
  messages: SummaryMessage[];
  todayIso: string; // YYYY-MM-DD — used to resolve relative dates like "el viernes"
};

export type SummaryResult = {
  summary: string | null;
  dueDate: string | null; // YYYY-MM-DD, or null if no deadline mentioned
};

function buildSystemInstruction(todayIso: string): string {
  return `Sos una asistente que resume conversaciones de Google Chat para una Manager de Web y Diseño.
Te paso una conversación: primero el contexto previo, después los mensajes "target" (los que motivaron crear un pendiente).

Tu tarea: devolver un JSON con dos campos: "summary" y "dueDate".

CAMPO summary:
Resumí en 2-3 oraciones en español rioplatense (voseo, registro informal de oficina) qué pasó:
- Quién planteó qué tarea o pedido
- Qué se decidió, sugirió o quedó pendiente
- Cualquier detalle concreto útil (links, nombres de proyecto)

Escribí como si le contaras a una compañera de trabajo. Ejemplos del tono esperado:
  "Acá con Leo charlaban sobre el wording del slide y quedó que pensarías cómo encararlo."
  "Daniel te pidió un número de cuántos usuarios usan los manuales, lo necesita para evaluar si volamos los PDFs viejos."

Reglas para summary:
- No copies texto textual de los mensajes.
- No incluyas timestamps ni "el usuario dijo".
- Si no hay tarea clara o el contexto es insuficiente, devolvé exactamente: (sin tarea clara)
- Máximo 3 oraciones. Sin viñetas, sin títulos. Solo el párrafo.

CAMPO dueDate:
Si en la conversación se menciona un deadline o fecha de entrega, devolvelo en formato YYYY-MM-DD.
Si no hay deadline, devolvé null.
Hoy es ${todayIso}. Resolvé referencias relativas:
  "para el viernes" → próximo viernes
  "antes del 20" → 20 del mes actual (si ya pasó, del mes siguiente)
  "esta semana" → último día de esta semana
  "el lunes que viene" → próximo lunes

No inventes deadlines. Si la persona dice "lo antes posible" o "urgente" sin fecha, dejalo null.`;
}

function buildUserPrompt(input: SummarizeInput): string {
  const lines: string[] = [];
  lines.push(`Conversación en: ${input.spaceDisplayName}`);
  if (input.context.length > 0) {
    lines.push('');
    lines.push('Contexto previo:');
    for (const m of input.context) {
      const who = m.isMe ? 'Yo' : m.senderDisplayName;
      const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 400);
      lines.push(`${who}: ${text || '(sin texto)'}`);
    }
  }
  lines.push('');
  lines.push('Mensajes a resumir:');
  for (const m of input.messages) {
    const who = m.isMe ? 'Yo' : m.senderDisplayName;
    const text = m.text.replace(/\s+/g, ' ').trim();
    lines.push(`${who}: ${text || '(sin texto)'}`);
  }
  return lines.join('\n');
}

const EMPTY_RESULT: SummaryResult = { summary: null, dueDate: null };

// Returns { summary, dueDate }. Never throws; returns nulls on any failure.
export async function summarizeConversation(input: SummarizeInput): Promise<SummaryResult> {
  const key = await readApiKey();
  if (!key) return EMPTY_RESULT;
  if (input.messages.length === 0) return EMPTY_RESULT;

  const body = {
    systemInstruction: { parts: [{ text: buildSystemInstruction(input.todayIso) }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          dueDate: { type: 'string', nullable: true },
        },
        required: ['summary'],
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[gemini] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return EMPTY_RESULT;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return EMPTY_RESULT;

    let parsed: { summary?: string; dueDate?: string | null };
    try {
      parsed = JSON.parse(raw) as { summary?: string; dueDate?: string | null };
    } catch {
      console.warn('[gemini] non-JSON response:', raw.slice(0, 200));
      return EMPTY_RESULT;
    }

    return {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null,
      dueDate: isValidIsoDate(parsed.dueDate) ? parsed.dueDate! : null,
    };
  } catch (err) {
    console.warn('[gemini] request failed:', (err as Error).message);
    return EMPTY_RESULT;
  }
}

function isValidIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// Free-form generator for other use cases (e.g. daily briefing). Returns text or null.
export async function generateText(systemPrompt: string, userPrompt: string, maxTokens = 800): Promise<string | null> {
  const key = await readApiKey();
  if (!key) return null;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: maxTokens,
      responseMimeType: 'text/plain',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[gemini] HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (err) {
    console.warn('[gemini] request failed:', (err as Error).message);
    return null;
  }
}
