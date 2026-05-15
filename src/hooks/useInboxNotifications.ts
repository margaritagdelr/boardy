import { useEffect, useRef } from 'react';
import type { InboxItem, InboxState } from '../types';

const STORAGE_KEY = 'boardy-notified-ids';
const POLL_MS = 3 * 60 * 1000; // 3 minutes
const NOTIFY_TAGS = ['urgente', 'nueva tarea'];

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>): void {
  try {
    // Cap to avoid runaway growth in localStorage.
    const arr = [...ids].slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignore quota errors
  }
}

function shouldNotify(item: InboxItem): boolean {
  if (item.status !== 'nuevo') return false;
  const tags = item.tags ?? [];
  return tags.some(t => NOTIFY_TAGS.includes(t));
}

function buildNotification(item: InboxItem): { title: string; body: string } {
  const isUrgent = (item.tags ?? []).includes('urgente');
  const prefix = isUrgent ? '🔴 Urgente' : '📥 Nueva tarea';
  const title = `${prefix} · ${item.senderDisplayName}`;
  const preview = item.text.replace(/\s+/g, ' ').trim().slice(0, 140);
  const body = preview ? `${preview}\n— ${item.spaceDisplayName}` : `(sin texto) — ${item.spaceDisplayName}`;
  return { title, body };
}

export function useInboxNotifications(onFocusInbox?: () => void): void {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    seenIdsRef.current = loadSeenIds();

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    let cancelled = false;

    async function poll() {
      try {
        const r = await fetch('/api/inbox');
        if (!r.ok) return;
        const state = (await r.json()) as InboxState;
        if (cancelled) return;

        const newItems = state.items.filter(i => shouldNotify(i));

        if (!initializedRef.current) {
          // First load: mark everything we see as already seen, don't notify retroactively.
          for (const i of newItems) seenIdsRef.current.add(i.id);
          saveSeenIds(seenIdsRef.current);
          initializedRef.current = true;
          return;
        }

        const toNotify = newItems.filter(i => !seenIdsRef.current.has(i.id));
        if (toNotify.length === 0) return;

        const canNotify =
          typeof Notification !== 'undefined' && Notification.permission === 'granted';

        for (const item of toNotify) {
          seenIdsRef.current.add(item.id);
          if (!canNotify) continue;
          const { title, body } = buildNotification(item);
          try {
            const n = new Notification(title, {
              body,
              icon: '/branding/assets/boardy-icon.svg',
              tag: 'boardy-inbox',
            });
            n.onclick = () => {
              window.focus();
              onFocusInbox?.();
              n.close();
            };
          } catch {
            // Notification constructor can throw on some platforms; degrade silently.
          }
        }
        saveSeenIds(seenIdsRef.current);
      } catch {
        // network/transient errors — ignore
      }
    }

    // Run once immediately, then on interval.
    poll();
    const timer = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onFocusInbox]);
}
