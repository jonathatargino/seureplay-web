/**
 * A job request must name one time range (whole-day downloads are not allowed)
 * and only use values the site's own filter form offers for that arena/court.
 * Returns an error message for the user, or null when the request is valid.
 */
export function validateJobRequest({ arena, court, date, timeRange }, arenas, { courts, dates, timeRanges }) {
  if (!timeRange) return 'Escolha um horário: não é possível baixar o dia inteiro.';
  if (!arenas.includes(arena) || !courts.includes(court) || !dates.includes(date) || !timeRanges.includes(timeRange)) {
    return 'Arena, quadra, data ou horário inválido.';
  }
  return null;
}
