import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { allocationStatus, parseWeeklyHours, rangeKey, type Status } from './capacityState'
import {
  formatLong,
  formatShort,
  mondayOf,
  shiftWeeks,
  todayISO,
  weekCount,
  weekRange,
  weeksFrom,
  type ISODate,
  type WeekRange,
} from './dates'
import { useCapacity } from './useCapacity'

type Props = {
  /** Monday of the first week. */
  from: ISODate
  /** Sunday of the last week. */
  to: ISODate
  /** The range is owned by the page, so the team timeline can share it. */
  onRangeChange: (range: WeekRange) => void
}

const WEEK_OPTIONS = [4, 8, 13, 26, 52]
const SLOW_AFTER_MS = 1500

type Editing = { id: number; draft: string; saving: boolean; error: string | null }

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// A person's weekly hours are editable from the grid. The grid only ever shows
// what the server has confirmed: while a save is in flight, or after it fails,
// the typed value lives in the editor, not in the grid.
export function CapacityGrid({ from, to, onRangeChange }: Props) {
  const { state, retry, saveWeeklyHours } = useCapacity(from, to)
  const [onlyOver, setOnlyOver] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const slow = useSlow(state.loading ? state.requestedKey : null)

  const range = { from, to }
  const weeks = weekCount(from, to)
  const thisWeek = mondayOf(todayISO())
  const { data, people } = state

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.map((row) => {
      const person = people[row.id]
      const statuses = row.allocated.map((hours) => allocationStatus(hours, person.weeklyHours))
      return { ...row, ...person, statuses, isOver: statuses.includes('over') }
    })
  }, [data, people])

  const overByWeek = useMemo(
    () => (data ? data.weeks.map((_, i) => rows.filter((r) => r.statuses[i] === 'over').length) : []),
    [data, rows],
  )
  const overCount = rows.filter((r) => r.isOver).length
  const visible = onlyOver ? rows.filter((r) => r.isOver) : rows
  const showingOtherRange = data !== null && data.key !== rangeKey(from, to)

  async function submit() {
    if (!editing || editing.saving) return
    const { id } = editing
    const hours = parseWeeklyHours(editing.draft)
    if (typeof hours === 'string') {
      setEditing({ ...editing, error: hours })
      return
    }
    if (hours === people[id]?.weeklyHours) {
      setEditing(null)
      return
    }
    setEditing({ ...editing, saving: true, error: null })
    try {
      await saveWeeklyHours(id, hours)
      setEditing((cur) => (cur?.id === id ? null : cur))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setEditing((cur) => (cur?.id === id ? { ...cur, saving: false, error } : cur))
    }
  }

  return (
    <section className="capacity" aria-label="Team capacity by week">
      <div className="toolbar">
        <div className="nav" role="group" aria-label="Move by week">
          <button type="button" onClick={() => onRangeChange(shiftWeeks(range, -1))} aria-label="Previous week">
            ‹
          </button>
          <button type="button" onClick={() => onRangeChange(weeksFrom(todayISO(), weeks))}>
            This week
          </button>
          <button type="button" onClick={() => onRangeChange(shiftWeeks(range, 1))} aria-label="Next week">
            ›
          </button>
        </div>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => e.target.value && onRangeChange(weekRange(e.target.value, to))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => e.target.value && onRangeChange(weekRange(from, e.target.value))}
          />
        </label>
        <label>
          Show
          <select value={weeks} onChange={(e) => onRangeChange(weeksFrom(from, Number(e.target.value)))}>
            {!WEEK_OPTIONS.includes(weeks) && <option value={weeks}>{weeks} weeks</option>}
            {WEEK_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} weeks
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} />
          Only over capacity
        </label>
        <span className="status" role="status">
          {state.loading && (slow ? 'Still loading — the server is taking a while…' : 'Loading…')}
        </span>
      </div>

      <p className="summary">
        {formatLong(from)} – {formatLong(to)} · {weeks} {weeks === 1 ? 'week' : 'weeks'}
        {data && !showingOtherRange && (
          <>
            {' · '}
            <strong className={overCount ? 'over-text' : undefined}>{overCount}</strong> of {rows.length} people over
            capacity in at least one week
          </>
        )}
      </p>

      {state.error && (
        <div className="banner" role="alert">
          <span>
            Couldn't load {formatLong(from)} – {formatLong(to)}. {state.error}
            {showingOtherRange && ' The grid below still shows the previous range.'}
          </span>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      {!data && state.loading && <Skeleton />}

      {data && (
        <div className={`scroller${state.loading || showingOtherRange ? ' stale' : ''}`} aria-busy={state.loading}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="name">
                  Person
                </th>
                <th scope="col" className="cap">
                  Capacity
                  <span className="sub">h / week</span>
                </th>
                {data.weeks.map((week, i) => (
                  <th scope="col" key={week} className={week === thisWeek ? 'week current' : 'week'}>
                    {formatShort(week)}
                    <span className={overByWeek[i] ? 'sub over-text' : 'sub'}>
                      {overByWeek[i] ? `${overByWeek[i]} over` : 'none over'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={data.weeks.length + 2} className="empty">
                    {onlyOver ? 'Nobody is over capacity in these weeks.' : 'No people to show.'}
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id} className={row.isOver ? 'is-over' : undefined}>
                  <th scope="row" className="name">
                    {row.name}
                  </th>
                  <td className="cap">
                    {editing?.id === row.id ? (
                      <CapacityEditor
                        name={row.name}
                        editing={editing}
                        onChange={(draft) => setEditing({ ...editing, draft, error: null })}
                        onSubmit={submit}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="cap-button"
                        aria-label={`Weekly hours for ${row.name}: ${hours(row.weeklyHours)}. Edit`}
                        onClick={() =>
                          setEditing({ id: row.id, draft: String(row.weeklyHours), saving: false, error: null })
                        }
                      >
                        {hours(row.weeklyHours)}
                      </button>
                    )}
                  </td>
                  {row.allocated.map((allocated, i) => (
                    <AllocationCell
                      key={data.weeks[i]}
                      name={row.name}
                      week={data.weeks[i]}
                      allocated={allocated}
                      capacity={row.weeklyHours}
                      status={row.statuses[i]}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AllocationCell(props: {
  name: string
  week: ISODate
  allocated: number
  capacity: number
  status: Status
}) {
  const { name, week, allocated, capacity, status } = props
  const over = allocated - capacity
  const fill = capacity > 0 ? Math.min(allocated / capacity, 1) : allocated > 0 ? 1 : 0
  const title =
    `${name}, week of ${formatShort(week)}: ${hours(allocated)} allocated of ${hours(capacity)}` +
    (status === 'over' ? ` (${hours(over)} over)` : '')
  return (
    <td className={`alloc ${status}`} style={{ '--fill': fill } as CSSProperties} title={title}>
      <span className="hours">{status === 'none' ? '–' : formatHours(allocated)}</span>
      {status === 'over' && <span className="delta">+{formatHours(over)}</span>}
    </td>
  )
}

function CapacityEditor(props: {
  name: string
  editing: Editing
  onChange: (draft: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const { name, editing, onChange, onSubmit, onCancel } = props
  const hintId = `cap-hint-${editing.id}`
  return (
    <form
      className="cap-editor"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <input
        aria-label={`Weekly hours for ${name}`}
        aria-describedby={hintId}
        aria-invalid={editing.error !== null}
        type="number"
        inputMode="decimal"
        min={0}
        max={168}
        step="any"
        value={editing.draft}
        readOnly={editing.saving}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !editing.saving) onCancel()
        }}
      />
      <button type="submit" disabled={editing.saving}>
        {editing.saving ? 'Saving…' : editing.error ? 'Retry' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} disabled={editing.saving}>
        Cancel
      </button>
      <p id={hintId} className={editing.error ? 'hint error' : 'hint'} role={editing.error ? 'alert' : undefined}>
        {editing.error ?? 'Changes capacity for every week, past and future.'}
      </p>
    </form>
  )
}

function Skeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading capacity">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}

/** True once `key` has been loading for a while; resets when a new load starts. */
function useSlow(key: string | null) {
  const [slowKey, setSlowKey] = useState<string | null>(null)
  useEffect(() => {
    if (key === null) return
    const timer = setTimeout(() => setSlowKey(key), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [key])
  return key !== null && slowKey === key
}

function formatHours(n: number): string {
  return String(Number(n.toFixed(2)))
}

function hours(n: number): string {
  return `${formatHours(n)}h`
}
