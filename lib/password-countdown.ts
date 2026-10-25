export function formatPasswordCountdown(
  expiresAt: number,
  now = Date.now()
): string {
  const secondsRemaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
