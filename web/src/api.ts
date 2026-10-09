import type { ISODate } from './dates'

export type CapacityPerson = {
  id: number
  name: string
  /** Capacity for every week. The schema keeps one value per person, no history. */
  weeklyHours: number
  /** Allocated hours, aligned to CapacityResponse.weeks. */
  allocated: number[]
}

export type CapacityResponse = {
  /** The Monday of each week in the range. */
  weeks: ISODate[]
  people: CapacityPerson[]
}

export type Person = { id: number; name: string; weeklyHours: number }

/**
 * A failure with a message that can be shown to a manager as-is. `status` is
 * set when the server answered; without it we don't know what the server did.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (init?.signal?.aborted) throw err
    throw new ApiError("Couldn't reach the server. Check your connection and try again.")
  }
  // Error bodies are JSON from our API, but a proxy or a stopped API container
  // answers with plain text or HTML, so a parse failure is not exceptional.
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error
    throw new ApiError(
      typeof message === 'string' ? message : `The server couldn't handle the request (${res.status}).`,
      res.status,
    )
  }
  if (body === null) throw new ApiError('The server sent a response we could not read.')
  return body as T
}

export function fetchCapacity(from: ISODate, to: ISODate, signal?: AbortSignal) {
  return request<CapacityResponse>(`/api/capacity?from=${from}&to=${to}`, { signal })
}

export function updateWeeklyHours(id: number, weeklyHours: number) {
  return request<Person>(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyHours }),
  })
}
