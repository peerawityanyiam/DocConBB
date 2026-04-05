const thaiDateFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Bangkok',
});

const thaiDateTimeFormatter = new Intl.DateTimeFormat('th-TH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Bangkok',
});

const thaiShortDateFormatter = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
  timeZone: 'Asia/Bangkok',
});

export function formatThaiDate(date: string | Date): string {
  return thaiDateFormatter.format(new Date(date));
}

export function formatThaiDateTime(date: string | Date): string {
  return thaiDateTimeFormatter.format(new Date(date));
}

export function formatThaiShortDate(date: string | Date): string {
  return thaiShortDateFormatter.format(new Date(date));
}

export function daysAgo(date: string | Date): number {
  const now = new Date();
  const d = new Date(date);
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
