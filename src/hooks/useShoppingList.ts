import { useState, useCallback, useEffect } from 'react';
import { AnyListClient } from '../api/anylist';
import { callHaService } from '../api/ha-rest';

export interface ShoppingItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
}

const REFRESH_MS = 30_000;

/**
 * Items of one HA todo list with optimistic add / check-off, shared by the
 * week-view rail and anything else that wants a compact shopping list.
 * (The dashboard ShoppingCard carries its own copy of this logic.)
 */
export function useShoppingList(entityId: string) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [client] = useState(() => new AnyListClient());

  const reload = useCallback(async () => {
    if (!entityId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const result = await callHaService('todo', 'get_items', { entity_id: entityId }, true) as {
        service_response?: Record<string, { items?: ShoppingItem[] }>;
      };
      setItems(result?.service_response?.[entityId]?.items ?? []);
    } catch (err) {
      console.warn('useShoppingList: failed to load items', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!entityId) return;
    const interval = setInterval(reload, REFRESH_MS);
    return () => clearInterval(interval);
  }, [entityId, reload]);

  const addItem = useCallback(async (summary: string) => {
    const trimmed = summary.trim();
    if (!trimmed || !entityId) return;
    await client.addItem(entityId, trimmed);
    setItems((prev) => [...prev, { uid: `temp-${Date.now()}`, summary: trimmed, status: 'needs_action' }]);
    setTimeout(reload, 500);
  }, [client, entityId, reload]);

  const toggleItem = useCallback(async (item: ShoppingItem) => {
    const newStatus = item.status === 'needs_action' ? 'completed' : 'needs_action';
    setItems((prev) => prev.map((i) => (i.uid === item.uid ? { ...i, status: newStatus } : i)));
    try {
      if (newStatus === 'completed') {
        await client.checkItem(entityId, item.summary);
      } else {
        await client.uncheckItem(entityId, item.summary);
      }
      setTimeout(reload, 500);
    } catch (err) {
      console.warn('useShoppingList: failed to toggle item', err);
      setItems((prev) => prev.map((i) => (i.uid === item.uid ? { ...i, status: item.status } : i)));
    }
  }, [client, entityId, reload]);

  return { items, loading, reload, addItem, toggleItem };
}
