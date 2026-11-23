/**
 * Floating notices shared by the whole app: any part announces an outcome here and the single
 * `Toaster` shows it. A module-level store keeps call sites free of context plumbing.
 */
export type NoticeKind = 'success' | 'error';
export type Notice = { id: number; kind: NoticeKind; text: string };

type Listener = (notice: Notice) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notify(kind: NoticeKind, text: string): void {
  const notice = { id: nextId++, kind, text };
  listeners.forEach((listener) => listener(notice));
}

/** Announces in green that an element was created. */
export const notifyCreated = (text: string) => notify('success', text);
