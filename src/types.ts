export type LinkItem = {
  id: string;
  label: string;
  url: string;
  note: string;
};

export type LinkGroup = {
  id: string;
  title: string;
  color: string;
  links: LinkItem[];
};

export type LinksData = {
  groups: LinkGroup[];
};

export type Account = {
  id: string;
  platform: string;
  category: string;
  brand: string;
  url: string;
  owner: string;
  status: 'activa' | 'revisar' | 'necesita-trabajo' | 'inactiva';
  lastReview: string;
  notes: string;
};

export type AccountsData = {
  accounts: Account[];
};

export type Todo = {
  id: string;
  title: string;
  priority: 'alta' | 'media' | 'baja';
  status: 'pendiente' | 'en-curso' | 'hecho';
  tags: string[];
  notes: string;
  createdAt: string;
  dueDate: string;
  accountId?: string;
};

export type TodosData = {
  todos: Todo[];
};

export type InboxItem = {
  id: string;
  spaceName: string;
  spaceDisplayName: string;
  senderName: string;
  senderDisplayName: string;
  text: string;
  createTime: string;
  threadName?: string;
  webUri?: string;
  receivedAt: string;
  status: 'nuevo' | 'descartado';
  tags?: string[];
};

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

export type InboxState = {
  items: InboxItem[];
  perSpaceLastSeen: Record<string, string>;
  lastPolledAt: string | null;
};

export type AuthStatus = {
  hasCredentials: boolean;
  hasToken: boolean;
};

export type ChatSpace = {
  name: string;
  displayName: string;
  spaceType: string;
  singleUserBotDm?: boolean;
  memberCount?: number;
};

export type Settings = {
  pollingIntervalMinutes: number;
  monitoredSpaces: string[];
  monitorAllSpaces: boolean;
};

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

export type DocumentsState = {
  documents: Document[];
};
