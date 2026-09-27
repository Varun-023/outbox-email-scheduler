/**
 * Date and time formatting helpers matching the Figma designs.
 */

/**
 * Formats a scheduled time for the Scheduled list: "Tue 9:15:12 AM" or with date if further out.
 */
export function formatScheduledTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    const time = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return `${weekday} ${time}`;
  } catch {
    return dateString;
  }
}

/**
 * Formats a sent / detail time: "Nov 3, 10:23 AM" or "Nov 3, 2026, 10:23 AM".
 */
export function formatEmailDetailDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const now = new Date();
    const isSameYear = date.getFullYear() === now.getFullYear();

    const monthDay = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' }),
    });

    const time = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return `${monthDay}, ${time}`;
  } catch {
    return dateString;
  }
}

/**
 * Formats an ISO string for HTML datetime-local input: "YYYY-MM-DDTHH:mm".
 */
export function toDateTimeLocalString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
