import type { LinksData, AccountsData, TodosData } from './types';

type DatasetMap = {
  links: LinksData;
  accounts: AccountsData;
  todos: TodosData;
};

export async function loadData<K extends keyof DatasetMap>(name: K): Promise<DatasetMap[K]> {
  const res = await fetch(`/api/data/${name}`);
  if (!res.ok) throw new Error(`failed to load ${name}`);
  return (await res.json()) as DatasetMap[K];
}

export async function saveData<K extends keyof DatasetMap>(name: K, data: DatasetMap[K]): Promise<void> {
  const res = await fetch(`/api/data/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`failed to save ${name}`);
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
