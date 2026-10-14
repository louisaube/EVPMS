import { z } from 'zod'

/** rule-evp-login-safe-redirect: a relative path of 1 to 300 characters; an unsafe one is ignored (default `/`). */
export const startQuerySchema = z.object({
  redirection: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .meta({ description: 'Relative path of the studio to open after the sign-in; ignored when not a safe relative path' }),
})
export type StartQuery = z.infer<typeof startQuerySchema>

export const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional().meta({ description: 'Authorization code returned by Google' }),
  state: z.string().min(1).max(2048).optional().meta({ description: 'State sent at the start, bound to the browser' }),
  error: z.string().min(1).max(200).optional().meta({ description: 'Error returned by Google (refusal of the user)' }),
})
export type CallbackQuery = z.infer<typeof callbackQuerySchema>
