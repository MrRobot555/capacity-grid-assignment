package main

import (
	"net/http"
	"time"
)

const (
	dateLayout = "2006-01-02"
	// maxWeeks bounds one request to roughly the two years of history production
	// keeps. Longer ranges are a paging problem, not a bigger-query problem.
	maxWeeks = 106
)

type capacityResponse struct {
	// Weeks are the Mondays of every week in the range, in order. Each person's
	// allocated array is aligned to this slice.
	Weeks  []string         `json:"weeks"`
	People []personCapacity `json:"people"`
}

type personCapacity struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	// WeeklyHours is the person's capacity for every week. The schema keeps a
	// single current value with no history, so it is not repeated per week.
	WeeklyHours float64   `json:"weeklyHours"`
	Allocated   []float64 `json:"allocated"`
}

// capacityQuery returns one row per person with allocated hours for each week
// in $1, an ordered array of Mondays.
//
// The weeks come in as an array rather than from generate_series: the planner
// guesses 1000 rows for generate_series, overestimates the people × weeks join,
// and turns on JIT, which cost ~370 ms of a ~400 ms query for 8 weeks. With
// the array it knows the real week count and the query runs in ~20 ms.
//
// Assignments are stored as several rows per logical assignment and every row
// counts, so they are summed, never de-duplicated. hours_per_day applies to
// working days only: an assignment contributes hours_per_day for each Mon–Fri
// day where it overlaps the week, so weekends inside start_date..end_date add
// nothing. People with no assignments in the range still get a row of zeros.
const capacityQuery = `
WITH weeks AS (
  SELECT week_start FROM unnest($1::date[]) AS week_start
),
allocated AS (
  SELECT a.person_id,
         w.week_start,
         SUM(a.hours_per_day * (LEAST(a.end_date, w.week_start + 4)
                                - GREATEST(a.start_date, w.week_start) + 1)) AS hours
  FROM assignments a
  JOIN weeks w
    ON a.start_date <= w.week_start + 4
   AND a.end_date   >= w.week_start
  WHERE a.start_date <= (SELECT max(week_start) FROM weeks) + 4
    AND a.end_date   >= (SELECT min(week_start) FROM weeks)
  GROUP BY a.person_id, w.week_start
)
SELECT p.id,
       p.name,
       p.weekly_hours::float8,
       array_agg(COALESCE(al.hours, 0)::float8 ORDER BY w.week_start) AS allocated
FROM people p
CROSS JOIN weeks w
LEFT JOIN allocated al
  ON al.person_id = p.id
 AND al.week_start = w.week_start
GROUP BY p.id
ORDER BY p.name, p.id`

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The range is widened to whole weeks: from the Monday of from's week to the
// week containing to (to is inclusive).
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	from, err := time.Parse(dateLayout, r.URL.Query().Get("from"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "from must be a date in YYYY-MM-DD format")
		return
	}
	to, err := time.Parse(dateLayout, r.URL.Query().Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "to must be a date in YYYY-MM-DD format")
		return
	}
	if to.Before(from) {
		writeError(w, http.StatusBadRequest, "to must not be before from")
		return
	}

	weeks := weekStarts(from, to)
	if len(weeks) > maxWeeks {
		writeError(w, http.StatusBadRequest, "range is too long: at most 106 weeks per request")
		return
	}

	rows, err := s.db.Query(r.Context(), capacityQuery, weeks)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load capacity")
		return
	}
	defer rows.Close()

	resp := capacityResponse{Weeks: make([]string, len(weeks)), People: []personCapacity{}}
	for i, wk := range weeks {
		resp.Weeks[i] = wk.Format(dateLayout)
	}
	for rows.Next() {
		var p personCapacity
		if err := rows.Scan(&p.ID, &p.Name, &p.WeeklyHours, &p.Allocated); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load capacity")
			return
		}
		resp.People = append(resp.People, p)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load capacity")
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// weekStarts returns the Monday of every week that overlaps from..to.
func weekStarts(from, to time.Time) []time.Time {
	var weeks []time.Time
	for wk := mondayOf(from); !wk.After(to); wk = wk.AddDate(0, 0, 7) {
		weeks = append(weeks, wk)
	}
	return weeks
}

func mondayOf(t time.Time) time.Time {
	sinceMonday := (int(t.Weekday()) + 6) % 7
	return t.AddDate(0, 0, -sinceMonday)
}
