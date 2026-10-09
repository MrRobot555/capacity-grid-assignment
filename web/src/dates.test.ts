import { afterEach, describe, expect, it } from 'vitest'
import { addDays, formatShort, mondayOf, shiftWeeks, todayISO, weekCount, weekRange, weeksFrom } from './dates'

// Date bugs hide in the viewer's time zone, so run the sensitive cases in zones
// on both sides of UTC. Node picks up a change to process.env.TZ immediately.
// (Declared here rather than pulling Node's types into the browser app.)
declare const process: { env: { TZ?: string } }
const originalTZ = process.env.TZ
afterEach(() => {
  process.env.TZ = originalTZ
})

describe.each(['America/Los_Angeles', 'Europe/Budapest', 'Pacific/Kiritimati'])('in %s', (tz) => {
  it('snaps any day to its Monday, across the year boundary', () => {
    process.env.TZ = tz
    expect(mondayOf('2025-12-29')).toBe('2025-12-29') // Monday
    expect(mondayOf('2026-01-01')).toBe('2025-12-29') // Thursday, new year
    expect(mondayOf('2026-01-04')).toBe('2025-12-29') // Sunday belongs to the week before
  })

  it('moves by whole weeks across a DST change', () => {
    process.env.TZ = tz
    // Europe falls back on 2026-10-25, the US on 2026-11-01.
    const range = weeksFrom('2026-10-19', 2)
    expect(shiftWeeks(range, 1)).toEqual({ from: '2026-10-26', to: '2026-11-08' })
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31')
  })

  it('formats the date it was given, not the day before', () => {
    process.env.TZ = tz
    expect(formatShort('2025-12-29')).toBe('29 Dec')
  })

  it("reads today from the viewer's calendar, not UTC", () => {
    process.env.TZ = tz
    // Just after midnight local time is still the previous day in UTC east of it.
    expect(todayISO(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })
})

describe('week ranges', () => {
  it('widens any two dates to whole weeks', () => {
    expect(weekRange('2025-12-31', '2026-01-16')).toEqual({ from: '2025-12-29', to: '2026-01-18' })
    expect(weekCount('2025-12-29', '2026-01-18')).toBe(3)
  })

  it('never produces a backwards range', () => {
    expect(weekRange('2026-01-12', '2026-01-01')).toEqual({ from: '2026-01-12', to: '2026-01-18' })
  })
})
