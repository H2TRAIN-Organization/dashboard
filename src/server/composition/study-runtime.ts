import 'server-only'
import { z } from 'zod'
import { STUDY_PERIODS, type StudyResponse } from '@/lib/study-contract'
import { normalizeStudyDays, studyAssociation, utcTimestamp, type StudyRecord } from '@/lib/study-normalization'
import { assertPrivacyAcknowledged } from '@/server/domain/privacy'
import { ForbiddenError, UnauthorizedError, ServiceUnavailableError } from '@/server/domain/errors'
import { toActiveActor } from '@/server/domain/session'
import { getServerRuntime } from './runtime'
import { readAllAdminKubios } from './kubios-admin-runtime'
export const studyQuerySchema = z.strictObject({ period: z.enum(STUDY_PERIODS).default('90d') })
export async function readStudy(token: string | undefined, period: typeof STUDY_PERIODS[number]): Promise<StudyResponse> {
  if (!token) throw new UnauthorizedError()
  const app = await getServerRuntime()
  const session = await app.useCases.auth.getSession(token)
  assertPrivacyAcknowledged(session)
  const actor = toActiveActor(session)
  if (actor.role !== 'admin' && actor.role !== 'doctor') throw new ForbiddenError()
  const health = await app.useCases.data.getDecryptedData(actor, { selectedUser: 'all', selectedDataType: 'all', timeRange: period, dateFilter: null, dateFrom: null, dateTo: null })
  const kubios: StudyRecord[] = []
  let kubiosSource: StudyResponse['sources']['kubios'] = 'restricted'
  if (actor.role === 'admin') {
    try {
      const participants = await readAllAdminKubios(actor)
      kubiosSource = participants.some(p => p.status === 'pending' || p.status === 'stale') ? 'partial' : 'ready'
      const now = Date.now(); const lower = period === 'all' ? -Infinity : now - Number(period.slice(0,-1))*86400000
      for (const participant of participants) {
        const username = participant.username
        if (!username) throw new ServiceUnavailableError()
        for (const row of participant.results) {
          const time = utcTimestamp(row.measured_timestamp)
          if (time === null) { kubiosSource = 'partial'; continue }
          if (time >= lower && time < now) kubios.push({ ...row, username })
        }
      }
    } catch { kubios.length = 0; kubiosSource = 'unavailable' }
  }
  const normalized = normalizeStudyDays(health.exerciseData, health.moodData, kubios)
  return { period, ...normalized, records: { exercise: health.exerciseData.length, mood: health.moodData.length, insulin: health.insulinData.length, food: health.foodData.length, kubios: kubios.length },
    sources: { health: 'ready', kubios: kubiosSource }, associations: {
      durationMood: studyAssociation(normalized.days, 'exerciseDuration', 'moodValue'),
      intensityMood: studyAssociation(normalized.days, 'intensity', 'moodValue'),
      durationRmssd: studyAssociation(normalized.days, 'exerciseDuration', 'rmssd'),
    } }
}
