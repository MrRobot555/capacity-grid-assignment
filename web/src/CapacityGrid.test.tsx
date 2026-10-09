import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CapacityResponse } from './api'
import { CapacityGrid } from './CapacityGrid'

const capacity: CapacityResponse = {
  weeks: ['2026-01-05', '2026-01-12'],
  people: [
    { id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocated: [0, 30] },
    { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [45, 40] },
  ],
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The editing flow end to end: a failed save must leave every number on screen
// as the server has it, and a successful retry must update every number that
// depends on the edited person, without reloading the range.
it('keeps the grid honest through a failed save and a successful retry', async () => {
  const patchResponses = [
    json(500, { error: 'could not update person' }),
    json(200, { id: 4, name: 'Dee Okafor', weeklyHours: 50 }),
  ]
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? patchResponses.shift()! : json(200, capacity),
  )
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-18" onRangeChange={() => {}} />)

  const dee = (await screen.findByText('Dee Okafor')).closest('tr')!
  const firstWeekHeader = screen.getByRole('columnheader', { name: /5 Jan/ })
  expect(firstWeekHeader).toHaveTextContent('1 over')
  expect(within(dee).getByText('+5')).toBeInTheDocument()

  fireEvent.click(within(dee).getByRole('button', { name: /Weekly hours for Dee Okafor/ }))
  fireEvent.change(screen.getByLabelText('Weekly hours for Dee Okafor'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  // Failed: the error is shown, the typed value is kept, the grid is unchanged.
  expect(await screen.findByRole('alert')).toHaveTextContent('could not update person')
  expect(screen.getByLabelText('Weekly hours for Dee Okafor')).toHaveValue(50)
  expect(within(dee).getByText('+5')).toBeInTheDocument()
  expect(firstWeekHeader).toHaveTextContent('1 over')

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  // Confirmed: the capacity, the cell and the column count all follow.
  await waitFor(() => expect(within(dee).getByRole('button', { name: /Weekly hours/ })).toHaveTextContent('50h'))
  expect(within(dee).queryByText('+5')).not.toBeInTheDocument()
  expect(firstWeekHeader).toHaveTextContent('none over')

  // ...from the PATCH response, not by reloading the range.
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'PATCH')).toHaveLength(1)
})

it('shows a reachable error and a retry when the range fails to load', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }))
    .mockResolvedValueOnce(json(200, capacity))
  vi.stubGlobal('fetch', fetchMock)

  render(<CapacityGrid from="2026-01-05" to="2026-01-18" onRangeChange={() => {}} />)

  expect(await screen.findByRole('alert')).toHaveTextContent("The server couldn't handle the request (502)")
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Dee Okafor')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
