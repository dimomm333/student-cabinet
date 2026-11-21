import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary as commonDictionary } from "@zxcvbn-ts/language-common";
import { dictionary as englishDictionary } from "@zxcvbn-ts/language-en";
import { passwordLengthError, type PasswordPolicyError } from "./password-policy.ts";

// One immutable configuration, all evaluation is local. No breach/network matcher.
const estimator = new ZxcvbnFactory({
  graphs: adjacencyGraphs,
  dictionary: { ...commonDictionary, ...englishDictionary },
  useLevenshteinDistance: true,
});

export function newPasswordError(password: string): PasswordPolicyError | null {
  // Bound work before dictionary/pattern matching, including direct API calls.
  const lengthError = passwordLengthError(password);
  if (lengthError) return lengthError;
  // The 10^8 guess boundary permits unpredictable eight-character passwords.
  // Using score >= 3 would reject even random length-8 strings due to the
  // estimator's five-guess score margin. No character-class rules are imposed.
  return estimator.check(password).guesses < 100_000_000 ? "PASSWORD_TOO_WEAK" : null;
}
