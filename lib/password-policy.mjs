export const STRONG_PASSWORD_REQUIREMENTS =
  'Use 12–128 characters with at least one uppercase letter, one lowercase letter, one number, and one symbol.';

export function isStrongPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    password.length <= 128 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
