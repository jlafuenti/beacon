import { useState } from 'react';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { Check, CalendarClock, AlertTriangle } from 'lucide-react';
import { FamilyMember } from '../types/family';
import { GrocyMemberChores, GrocyChoreRow } from '../hooks/useGrocyChores';
import { useTranslation } from '../i18n';

interface GrocyChoreColumnProps {
  group: GrocyMemberChores;
  onComplete: (choreId: number, member: FamilyMember) => Promise<void> | void;
}

/** One adult's column on the Chores tab when chores come from Grocy (Lafuenti fork). */
export function GrocyChoreColumn({ group, onComplete }: GrocyChoreColumnProps) {
  const { t, dateLocale } = useTranslation();
  const { member, due, comingUp } = group;
  const [busyId, setBusyId] = useState<number | null>(null);

  const dueLabel = (chore: GrocyChoreRow): string => {
    if (!chore.nextDue) return '';
    const d = parseISO(chore.nextDue);
    if (chore.overdue) return t('chores.grocyOverdue', { date: format(d, 'MMM d', { locale: dateLocale }) });
    if (isToday(d)) return t('chores.grocyDueToday');
    if (isTomorrow(d)) return t('chores.grocyDueTomorrow');
    return format(d, 'EEE, MMM d', { locale: dateLocale });
  };

  const handleDone = async (chore: GrocyChoreRow) => {
    if (busyId !== null) return;
    setBusyId(chore.id);
    try {
      await onComplete(chore.id, member);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="chores-member-col chores-member-col--grocy">
      <div className="dash-member-header">
        <span
          className="dash-member-avatar"
          style={{ backgroundColor: member.color + '22', borderColor: member.color }}
        >
          {member.avatar}
        </span>
        <span className="dash-member-name" style={{ color: member.color }}>
          {member.name}
        </span>
        {due.length > 0 && (
          <span className="grocy-chore-count" style={{ backgroundColor: member.color }}>{due.length}</span>
        )}
      </div>

      <div className="chores-member-col-list">
        <h3 className="grocy-chore-group-title">{t('chores.grocyDue')}</h3>
        {due.length === 0 ? (
          <div className="chores-member-empty">{t('chores.grocyNothingDue')}</div>
        ) : (
          <div className="chores-list">
            {due.map((chore) => (
              <div key={chore.id} className={`chore-card grocy-chore-card${chore.overdue ? ' grocy-chore-card--overdue' : ''}`}>
                <button
                  type="button"
                  className="grocy-chore-done"
                  style={{ borderColor: member.color, color: member.color }}
                  onClick={() => handleDone(chore)}
                  disabled={busyId !== null}
                  aria-label={t('chores.grocyMarkDone', { name: chore.name })}
                >
                  <Check size={20} strokeWidth={2.5} />
                </button>
                <div className="grocy-chore-body">
                  <span className="chore-card-name">{chore.name}</span>
                  <span className={`grocy-chore-when${chore.overdue ? ' grocy-chore-when--overdue' : ''}`}>
                    {chore.overdue && <AlertTriangle size={13} />}
                    {dueLabel(chore) || t('chores.grocyDueNow')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {comingUp.length > 0 && (
          <>
            <h3 className="grocy-chore-group-title grocy-chore-group-title--later">{t('chores.grocyComingUp')}</h3>
            <ul className="grocy-chore-upcoming">
              {comingUp.map((chore) => (
                <li key={chore.id} className="grocy-chore-upcoming-item">
                  <CalendarClock size={14} className="grocy-chore-upcoming-icon" />
                  <span className="grocy-chore-upcoming-name">{chore.name}</span>
                  <span className="grocy-chore-upcoming-date">{dueLabel(chore)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grocy-chore-footer">{t('chores.grocyManaged')}</div>
    </section>
  );
}
