import { describe, expect, it } from 'vitest'
import { exerciseMinutes, normalizeIntensity, normalizeStudyDays, studyAssociation, utcTimestamp } from '@/lib/study-normalization'
import { daysForTimeRange } from '@/server/domain/health-data'
import { decryptedDataQuerySchema } from '@/server/http/schemas/data'

describe('Study person-day normalization', () => {
  it('accepts typed periods including a year and rejects the old numeric value', () => {
    expect(daysForTimeRange('365d')).toBe(365)
    expect(decryptedDataQuerySchema.safeParse({timeRange:'365d'}).success).toBe(true)
    expect(decryptedDataQuerySchema.safeParse({timeRange:'90'}).success).toBe(false)
  })
  it('uses UTC for naive legacy timestamps and timezone offsets', () => {
    expect(utcTimestamp('2026-13-01')).toBeNull()
    expect(utcTimestamp('2026-02-30')).toBeNull()
    expect(utcTimestamp('2026-01-02T00:30:00')).toBe(Date.parse('2026-01-02T00:30:00Z'))
    const result = normalizeStudyDays([{username:'a',date_time:'2026-01-02T00:30:00+01:00',duration:30}], [{username:'a',date_time:'2026-01-01T23:45:00Z',mood_value:8}])
    expect(result.days).toMatchObject([{day:'2026-01-01',exerciseDuration:30,moodValue:8}])
  })
  it('aggregates before pairing without mixing people or adjacent dates', () => {
    const result = normalizeStudyDays([
      {username:'alice',date:'2026-01-01',duration:20,intensity:'Baja'},
      {username:'alice',date:'2026-01-01',duration:40,intensity:3},
      {username:'bob',date:'2026-01-01',duration:100,intensity:'moderate'},
    ], [{username:'alice',date:'2026-01-01',mood_value:4}, {username:'alice',date:'2026-01-01',mood_value:8}, {username:'bob',date:'2026-01-02',mood_value:10}])
    expect(result.days).toHaveLength(3)
    expect(result.days.find(d=>d.person==='alice')).toMatchObject({exerciseDuration:60,intensity:2,moodValue:6})
    expect(studyAssociation(result.days,'exerciseDuration','moodValue')).toEqual({coefficient:null,sampleSize:1,participants:1})
  })
  it('computes duration from real start/end, preserves zero and missing values', () => {
    expect(exerciseMinutes({exercise_start_time:'2026-01-01T23:45:00',exercise_end_time:'2026-01-02T00:15:00'})).toBe(30)
    expect(exerciseMinutes({duration:0})).toBe(0)
    expect(exerciseMinutes({duration:'12garbage'})).toBeNull()
    expect(exerciseMinutes({exercise_start_time:'2026-01-02',exercise_end_time:'2026-01-01'})).toBeNull()
    expect(normalizeIntensity('alta')).toBe(3)
    expect(normalizeIntensity('unknown')).toBeNull()
    expect(normalizeIntensity(9)).toBeNull()
  })
  it('reports excluded identities/dates and requires nonconstant matched samples', () => {
    const result = normalizeStudyDays([{date:'invalid',duration:20}, {username:'a',date:'2026-01-01',duration:5}],[])
    expect(result.excludedRecords).toBe(1)
    expect(result.days[0]?.moodValue).toBeNull()
    const days = ['01','02','03'].map((day,i)=>({person:'a',day:`2026-01-${day}`,exerciseDuration:i,moodValue:i*2,intensity:null,rmssd:null,readiness:null}))
    expect(studyAssociation(days,'exerciseDuration','moodValue')).toEqual({coefficient:1,sampleSize:3,participants:1})
    expect(studyAssociation(days.map(d=>({...d,exerciseDuration:1})),'exerciseDuration','moodValue').coefficient).toBeNull()
  })
})
