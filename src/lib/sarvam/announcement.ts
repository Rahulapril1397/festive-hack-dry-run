import type { AppLanguage } from "./languages";

/**
 * Contract C3: the spoken announcement for a stage call. Token number only — never a name.
 * Kept in step with the SQL tv_instruction() wording.
 */
export function announcementText(token: number, lang: AppLanguage): string {
  if (!Number.isInteger(token) || token <= 0) throw new Error("token must be a positive integer");
  return lang === "hi" ? `टोकन नंबर ${token}, कृपया मंच पर आइए।` : `Token number ${token}, please come to the stage.`;
}
