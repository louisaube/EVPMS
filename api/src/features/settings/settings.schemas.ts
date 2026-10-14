import { z } from 'zod'

export const settingsResponseSchema = z
  .object({
    absenceTypes: z.array(
      z
        .object({
          code: z.string(),
          label: z.string(),
          expectedPiece: z.string().nullable(),
          privatePiece: z.boolean(),
          hrReview: z.boolean(),
          payfitCode: z.string().nullable(),
        })
        .meta({ id: 'SettingsAbsenceTypeDto' }),
    ),
    limits: z
      .object({
        sessionHours: z.literal(8),
        uploadLinkMinutes: z.literal(5),
        readLinkSeconds: z.literal(60),
        maxFileBytes: z.literal(10485760),
        formats: z.array(z.enum(['PDF', 'JPEG', 'PNG'])),
      })
      .meta({ id: 'SettingsLimitsDto' }),
    windows: z
      .object({
        payfit: z.string().min(1).meta({ description: 'Window read in PayFit, in words' }),
        aqoona: z.string().min(1).meta({ description: 'Window read in Aqoona, in words' }),
      })
      .meta({ id: 'SettingsWindowsDto' }),
    payfitWritesEnabled: z.literal(false).meta({ description: 'Always false in v1: nothing is ever written to PayFit' }),
  })
  .meta({ id: 'SettingsResponseDto' })
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
