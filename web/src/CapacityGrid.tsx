import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { allocationStatus, parseWeeklyHours, rangeKey, type Status } from './capacityState'
import {
  formatLong,
  formatShort,
  isSupportedDate,
  MAX_DATE,
  MIN_DATE,
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
// Rows are virtualised: only the ones in view (plus OVERSCAN either side) are
// rendered, so a roster of thousands over two years stays responsive. That
// needs every row to be the same height. styles.css fixes it at 44px, but zoom
// or a larger default font can change it, and an error of 1px per row adds up
// to a blank band at the bottom of 3000 rows, so the real height is measured.
const ROW_HEIGHT_GUESS = 44
const OVERSCAN = 8

type Editing = {
  id: number
  draft: string
  saving: boolean
  error: string | null
  /** The last attempt reached the server and failed, so the action is a retry. */
  failed: boolean
}

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// A person's weekly hours are editable from the grid. The grid only ever shows
// what the server has confirmed: while a save is in flight, or after it fails,
// the typed value lives in the editor, not in the grid.
export function CapacityGrid({ from, to, onRangeChange }: Props) {
  const { state, retry, saveWeeklyHours } = useCapacity(from, to)
  const [onlyOver, setOnlyOver] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const slow = useSlow(state.loading ? state.requestedKey : null)
  const { scrollerRef, first, last, rowHeight, onScroll } = useRowWindow()

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
  const needle = searchable(query.trim())
  const visible = rows.filter((r) => (!onlyOver || r.isOver) && (!needle || searchable(r.name).includes(needle)))
  const windowEnd = Math.min(visible.length, last)
  const windowStart = Math.min(first, windowEnd)
  const showingOtherRange = data !== null && data.key !== rangeKey(from, to)

  async function submit() {
    if (!editing || editing.saving) return
    const { id } = editing
    const hours = parseWeeklyHours(editing.draft)
    if (typeof hours === 'string') {
      setEditing({ ...editing, error: hours, failed: false })
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
      const error = `Not saved. ${err instanceof Error ? err.message : String(err)}`
      setEditing((cur) => (cur?.id === id ? { ...cur, saving: false, error, failed: true } : cur))
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
            min={MIN_DATE}
            max={MAX_DATE}
            onChange={(e) => {
              // A date input reports each half-typed year (0002, 0020, 0202…): wait for a real one.
              const value = e.target.value
              if (!isSupportedDate(value)) return
              // Moving the start past the end keeps the number of weeks shown.
              onRangeChange(value > to ? weeksFrom(value, weeks) : weekRange(value, to))
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={MIN_DATE}
            max={MAX_DATE}
            onChange={(e) => isSupportedDate(e.target.value) && onRangeChange(weekRange(from, e.target.value))}
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
        <label>
          Find person
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
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
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className={`scroller${state.loading || showingOtherRange ? ' stale' : ''}`}
          aria-busy={state.loading}
        >
          <table aria-rowcount={visible.length + 1}>
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
                    {needle
                      ? `Nobody matching “${query.trim()}”${onlyOver ? ' is over capacity in these weeks' : ''}.`
                      : onlyOver
                        ? 'Nobody is over capacity in these weeks.'
                        : 'No people to show.'}
                  </td>
                </tr>
              )}
              <Spacer height={windowStart * rowHeight} colSpan={data.weeks.length + 2} />
              {visible.slice(windowStart, windowEnd).map((row, i) => (
                <tr
                  key={row.id}
                  className={row.isOver ? 'is-over' : undefined}
                  aria-rowindex={windowStart + i + 2}
                >
                  <th scope="row" className="name">
                    {row.name}
                  </th>
                  <td className="cap">
                    {/* Always the confirmed value; the draft lives in the editor below the row. */}
                    <button
                      type="button"
                      className="cap-button"
                      aria-label={`Weekly hours for ${row.name}: ${hours(row.weeklyHours)}. Edit`}
                      aria-expanded={editing?.id === row.id}
                      // While a save is in flight its editor must stay open, or a
                      // failure would have nowhere to be shown.
                      disabled={editing?.id === row.id || editing?.saving === true}
                      onClick={() =>
                        setEditing({ id: row.id, draft: String(row.weeklyHours), saving: false, error: null, failed: false })
                      }
                    >
                      {hours(row.weeklyHours)}
                    </button>
                    {editing?.id === row.id && (
                      <CapacityEditor
                        name={row.name}
                        editing={editing}
                        onChange={(draft) => setEditing({ ...editing, draft, error: null, failed: false })}
                        onSubmit={submit}
                        onCancel={() => setEditing(null)}
                      />
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
              <Spacer height={(visible.length - windowEnd) * rowHeight} colSpan={data.weeks.length + 2} />
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
        {editing.saving ? 'Saving…' : editing.failed ? 'Retry' : 'Save'}
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

/** Stands in for rows outside the window, so the scrollbar stays honest. */
function Spacer({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null
  return (
    <tr aria-hidden="true" className="spacer">
      <td colSpan={colSpan} style={{ height }} />
    </tr>
  )
}

/** Which rows of the scroller are in view. */
function useRowWindow() {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(800)
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT_GUESS)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight || 800))
    observer.observe(el)
    return () => observer.disconnect()
  })

  // After every render: are real rows the height the spacers assume? Rows are
  // styled to be identical; taking the tallest means that if they ever aren't,
  // the value is stable instead of flipping with whichever row is first.
  useLayoutEffect(() => {
    const rows = scrollerRef.current?.querySelectorAll('tbody tr:not(.spacer)') ?? []
    const measured = Math.max(0, ...Array.from(rows, (row) => row.getBoundingClientRect().height))
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.1) setRowHeight(measured)
  })

  return {
    scrollerRef,
    rowHeight,
    first: Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN),
    last: Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN,
    onScroll: (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop),
  }
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

// Lower-case, without accents, so "soren ob" finds "Søren Öberg". Some letters
// don't decompose into a base letter plus an accent, so they're mapped by hand.
const LETTERS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ł: 'l', þ: 'th', ð: 'd' }

function searchable(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[øæœßđłþð]/g, (c) => LETTERS[c])
}

function formatHours(n: number): string {
  return String(Number(n.toFixed(2)))
}

function hours(n: number): string {
  return `${formatHours(n)}h`
}
