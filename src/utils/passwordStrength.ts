export interface StrengthResult {
  level: 'weak' | 'fair' | 'strong';
  message: string;
  color: string;
}

const WEAK_PINS = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '1234','2345','3456','4567','5678','6789','0123',
  '9876','8765','7654','6543','5432','4321','3210',
  '0000','1230','1212','1122','2211','1010','0101',
]);

export function getPinStrength(pin: string): StrengthResult | null {
  if (!pin || pin.length < 4) return null;
  if (WEAK_PINS.has(pin)) {
    return { level: 'weak', message: 'Weak PIN — easy to guess', color: "var(--col-danger)" };
  }
  const digits = pin.split('');
  if (new Set(digits).size === 1) {
    return { level: 'weak', message: 'Weak PIN — all digits are the same', color: "var(--col-danger)" };
  }
  return { level: 'strong', message: 'Good PIN', color: "var(--col-success)" };
}

const COMMON_PASSWORDS = new Set([
  'password','password1','pass123','123456','1234567','12345678','123456789',
  '111111','000000','qwerty','abc123','letmein','welcome','admin','root',
  '1234','12345','1234567890','iloveyou','monkey','dragon',
]);

export function getPasswordStrength(pw: string): StrengthResult | null {
  if (!pw || pw.length < 2) return null;
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return { level: 'weak', message: 'Weak — too common', color: "var(--col-danger)" };
  }
  if (new Set(pw.split('')).size === 1) {
    return { level: 'weak', message: 'Weak — all characters are the same', color: "var(--col-danger)" };
  }
  if (/^\d+$/.test(pw) && pw.length < 6) {
    return { level: 'weak', message: 'Weak — numbers only, too short', color: "var(--col-danger)" };
  }
  if (pw.length < 6) {
    return { level: 'fair', message: 'Fair — consider a longer password', color: "var(--col-warning)" };
  }
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  if (hasLetter && hasDigit && (hasSpecial || pw.length >= 10)) {
    return { level: 'strong', message: 'Strong password', color: "var(--col-success)" };
  }
  if (hasLetter && hasDigit) {
    return { level: 'fair', message: 'Fair — add symbols or make it longer', color: "var(--col-warning)" };
  }
  if (/^\d+$/.test(pw)) {
    return { level: 'fair', message: 'Fair — consider mixing letters and numbers', color: "var(--col-warning)" };
  }
  return { level: 'fair', message: 'Fair — mix letters, numbers & symbols for better security', color: "var(--col-warning)" };
}
