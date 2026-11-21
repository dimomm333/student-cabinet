// Shared UI hints; Better Auth enforces the policy on the server.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordPolicyMessages = {
  PASSWORD_TOO_SHORT: `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов`,
  PASSWORD_TOO_LONG: `Пароль должен содержать не более ${PASSWORD_MAX_LENGTH} символов`,
  PASSWORD_TOO_WEAK: "Этот пароль слишком простой. Придумайте другой",
  PASSWORD_UNCHANGED: "Новый пароль должен отличаться от текущего",
} as const;

export type PasswordPolicyError = keyof typeof passwordPolicyMessages;

export function passwordLengthError(password: string): PasswordPolicyError | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "PASSWORD_TOO_SHORT";
  if (password.length > PASSWORD_MAX_LENGTH) return "PASSWORD_TOO_LONG";
  return null;
}
