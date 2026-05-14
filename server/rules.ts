import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'data', 'rules.json');

export type RuleColor = 'terracota' | 'ochre' | 'sage' | 'ink';

export type Rule = {
  id: string;
  label: string;
  color: RuleColor;
  matchAny: string[];
  enabled: boolean;
};

export type RulesData = {
  rules: Rule[];
};

const DEFAULT_RULES: RulesData = {
  rules: [
    { id: 'rule-urgent',    label: 'urgente',       color: 'terracota', enabled: true, matchAny: ['urgente', 'asap', 'ya mismo', 'cuanto antes', 'lo antes posible', 'es importante', 'priority', 'es prioridad'] },
    { id: 'rule-task',      label: 'nueva tarea',   color: 'ochre',     enabled: true, matchAny: ['necesito que', 'necesitamos', 'podés', 'podes', 'podrías', 'podrias', 'hay que', 'habría que', 'habria que', 'tenés que', 'tenes que', 'me ayudás', 'me ayudas', 'pedido', 'me podés', 'me podes', 'hacé', 'hace'] },
    { id: 'rule-question',  label: 'pregunta',      color: 'sage',      enabled: true, matchAny: ['sabés', 'sabes', 'alguien sabe', 'cómo hago', 'como hago', 'qué hago', 'que hago', 'duda', 'consulta', '¿', 'sabrías', 'sabrias'] },
    { id: 'rule-bug',       label: 'problema',      color: 'terracota', enabled: true, matchAny: ['no anda', 'no funciona', 'se rompió', 'se rompio', 'error', 'bug', 'roto', 'falla', 'no carga', 'caído', 'caido', 'se cayó', 'se cayo'] },
    { id: 'rule-deadline',  label: 'deadline',      color: 'ochre',     enabled: true, matchAny: ['para el', 'antes del', 'vence', 'deadline', 'fecha límite', 'fecha limite', 'plazo'] },
    { id: 'rule-review',    label: 'revisar',       color: 'sage',      enabled: true, matchAny: ['revisás', 'revisas', 'revisar', 'aprobás', 'aprobas', 'aprobar', 'qué opinás', 'que opinas', 'tu opinión', 'tu opinion', 'qué te parece', 'que te parece', 'feedback'] },
    { id: 'rule-stores',    label: 'stores',        color: 'sage',      enabled: true, matchAny: ['app store', 'play store', 'google play', 'apple store', 'listing'] },
    { id: 'rule-design',    label: 'diseño',        color: 'sage',      enabled: true, matchAny: ['figma', 'diseño', 'diseno', 'mockup', 'prototipo', 'wireframe'] },
    { id: 'rule-meeting',   label: 'reunión',       color: 'sage',      enabled: true, matchAny: ['reunión', 'reunion', 'meet', 'agenda', 'zoom', 'llamada', 'call'] },
    { id: 'rule-mentioned', label: 'me mencionan',  color: 'terracota', enabled: true, matchAny: ['@margarita', 'margarita', 'mar,', 'margui', 'mga'] },
  ],
};

export async function readRules(): Promise<RulesData> {
  try {
    const raw = await fs.readFile(RULES_PATH, 'utf-8');
    return JSON.parse(raw) as RulesData;
  } catch {
    await writeRules(DEFAULT_RULES);
    return DEFAULT_RULES;
  }
}

export async function writeRules(data: RulesData): Promise<void> {
  await fs.mkdir(path.dirname(RULES_PATH), { recursive: true });
  await fs.writeFile(RULES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function applyRules(rules: Rule[], text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    for (const kw of r.matchAny) {
      const needle = kw.trim().toLowerCase();
      if (needle && lower.includes(needle)) {
        tags.push(r.label);
        break;
      }
    }
  }
  return tags;
}
