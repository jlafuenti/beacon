import { useMemo, useState, useRef, useCallback } from 'react';
import { format, parseISO, isSameDay, startOfDay } from 'date-fns';
import { Plus } from 'lucide-react';
import { CalendarEvent } from '../types';
import { Chore, FamilyMember } from '../types/family';
import { TaskChecklist } from './TaskChecklist';
import { DashboardTodoItem } from '../hooks/useDashboardTasks';
import { useShoppingList } from '../hooks/useShoppingList';
import { useTranslation } from '../i18n';

interface CalendarSidebarProps {
  events: CalendarEvent[];
  chores: Chore[];
  completedChoreIds: Set<string>;
  onToggleChore: (choreId: string) => void;
  todoItems: DashboardTodoItem[];
  onToggleTodo?: (uid: string, currentStatus: string) => void;
  members?: FamilyMember[];
  /** 'tasks' = Beacon's task/chore list (upstream default); 'shopping' = the Shopping card's HA list. */
  mode?: 'tasks' | 'shopping';
  /** HA todo entity shown when mode is 'shopping' (Settings → Integrations → Shopping Card Entity). */
  shoppingEntity?: string;
}

export function CalendarSidebar({
  events,
  chores,
  completedChoreIds,
  onToggleChore,
  todoItems,
  onToggleTodo,
  members = [],
  mode = 'tasks',
  shoppingEntity = '',
}: CalendarSidebarProps) {
  const { t, dateLocale } = useTranslation();
  const today = startOfDay(new Date());

  const todayEvents = useMemo(() => {
    return events
      .filter((e) => isSameDay(startOfDay(parseISO(e.start)), today))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, today]);

  const pendingTodos = todoItems.filter((t) => t.status === 'needs_action');
  const showShopping = mode === 'shopping' && !!shoppingEntity;

  return (
    <aside className="calendar-sidebar">
      {/* Today's Schedule */}
      <section className="cal-sidebar-section">
        <h3 className="cal-sidebar-heading">{t('calendarSidebar.today')}</h3>
        {todayEvents.length === 0 ? (
          <p className="cal-sidebar-empty">{t('calendarSidebar.nothingScheduled')}</p>
        ) : (
          <ul className="cal-sidebar-events">
            {todayEvents.map((event) => (
              <li key={event.id} className="cal-sidebar-event">
                <span
                  className="cal-sidebar-event-dot"
                  style={{ background: event.color || 'var(--accent)' }}
                />
                <div className="cal-sidebar-event-info">
                  <span className="cal-sidebar-event-title">{event.title}</span>
                  {event.start.includes('T') && (
                    <span className="cal-sidebar-event-time">
                      {format(parseISO(event.start), 'h:mm a', { locale: dateLocale })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showShopping ? (
        <ShoppingRail entityId={shoppingEntity} />
      ) : (
        /* Tasks / Chores */
        <section className="cal-sidebar-section">
          <h3 className="cal-sidebar-heading">{t('calendarSidebar.tasks')}</h3>
          {pendingTodos.length > 0 && onToggleTodo ? (
            <ul className="cal-sidebar-todos">
              {pendingTodos.slice(0, 8).map((item) => (
                <li key={item.uid} className="cal-sidebar-todo">
                  <button
                    type="button"
                    className="cal-sidebar-todo-check"
                    onClick={() => onToggleTodo(item.uid, item.status)}
                    aria-label={t('calendarSidebar.completeItem', { name: item.summary })}
                  >
                    <span className="task-checkbox-box" />
                  </button>
                  <span className="cal-sidebar-todo-label">{item.summary}</span>
                </li>
              ))}
            </ul>
          ) : chores.length > 0 ? (
            <TaskChecklist
              chores={chores}
              completedIds={completedChoreIds}
              onToggle={onToggleChore}
              members={members}
            />
          ) : (
            <p className="cal-sidebar-empty">{t('calendarSidebar.allClear')}</p>
          )}
        </section>
      )}
    </aside>
  );
}

/** Shopping list rail: quick add on top, unchecked items below, fills the rest of the column. */
function ShoppingRail({ entityId }: { entityId: string }) {
  const { t } = useTranslation();
  const { items, loading, addItem, toggleItem } = useShoppingList(entityId);
  const [inputValue, setInputValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const unchecked = items.filter((i) => i.status === 'needs_action');

  const handleAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addItem(trimmed);
      setInputValue('');
    } catch (err) {
      console.warn('CalendarSidebar: failed to add shopping item', err);
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }, [inputValue, submitting, addItem]);

  return (
    <section className="cal-sidebar-section cal-sidebar-section--grow">
      <h3 className="cal-sidebar-heading">{t('calendarSidebar.shopping')}</h3>
      <form className="cal-sidebar-add" onSubmit={handleAdd}>
        <input
          ref={inputRef}
          type="text"
          className="cal-sidebar-add-input"
          placeholder={t('calendarSidebar.addItemPlaceholder')}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={submitting}
        />
        <button
          type="submit"
          className="cal-sidebar-add-btn"
          disabled={!inputValue.trim() || submitting}
          aria-label={t('calendarSidebar.addItem')}
        >
          <Plus size={16} />
        </button>
      </form>
      {loading && items.length === 0 ? (
        <p className="cal-sidebar-empty">{t('dashboard.shoppingLoading')}</p>
      ) : unchecked.length === 0 ? (
        <p className="cal-sidebar-empty">{t('calendarSidebar.shoppingEmpty')}</p>
      ) : (
        <ul className="cal-sidebar-todos cal-sidebar-todos--scroll">
          {unchecked.map((item) => (
            <li key={item.uid} className="cal-sidebar-todo">
              <button
                type="button"
                className="cal-sidebar-todo-check"
                onClick={() => toggleItem(item)}
                aria-label={t('dashboard.shoppingCheckItem', { name: item.summary })}
              >
                <span className="task-checkbox-box" />
              </button>
              <span className="cal-sidebar-todo-label">{item.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
