import { z, type ZodTypeAny } from "zod";

/**
 * Optional input that also tolerates an explicit null from the model.
 * null/undefined both normalize to undefined; the advertised schema stays narrow
 * (no ["string","null"]) so the model is never told null is valid.
 */
export const optional = <T extends ZodTypeAny>(s: T) =>
  z.preprocess((v) => v ?? undefined, s.optional());
