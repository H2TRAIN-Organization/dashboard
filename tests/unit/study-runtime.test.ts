import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only',()=>({}))
const mocks=vi.hoisted(()=>({getSession:vi.fn(),getData:vi.fn(),readKubios:vi.fn()}))
vi.mock('@/server/composition/runtime',()=>({getServerRuntime:async()=>({useCases:{auth:{getSession:mocks.getSession},data:{getDecryptedData:mocks.getData}}})}))
vi.mock('@/server/composition/kubios-admin-runtime',()=>({readAllAdminKubios:mocks.readKubios}))
import { readStudy } from '@/server/composition/study-runtime'
import { GET } from '@/app/api/study/route'
import { NextRequest } from 'next/server'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/server/domain/privacy'
const session=(role='admin',state='complete')=>({user:{id:'999',username:'admin-without-link',role},privacy:{policyVersion:PRIVACY_POLICY_VERSION,policyHash:PRIVACY_POLICY_HASH,state}})
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
  mocks.getSession.mockResolvedValue(session())
  mocks.getData.mockReset();mocks.getData.mockResolvedValue({exerciseData:[{username:'alice',date_time:'2026-11-03T12:00:00Z',duration:30,intensity:2}],moodData:[{username:'alice',date_time:'2026-11-03T12:00:00Z',mood_value:8}],insulinData:[],foodData:[],periodData:[]})
  mocks.readKubios.mockReset();mocks.readKubios.mockResolvedValue([{userId:1,username:'alice',status:'ready',results:[{measured_timestamp:'2026-11-03T12:00:00Z',result:{rmssd_ms:40}}]}])
})
afterEach(()=>vi.useRealTimers())
describe('Study runtime role, privacy and partial data',()=>{
  it('blocks ordinary users and initial privacy before reading any data',async()=>{
    await expect(readStudy(undefined,'90d')).rejects.toMatchObject({statusCode:401})
    mocks.getSession.mockResolvedValue(session('user'))
    await expect(readStudy('opaque','90d')).rejects.toMatchObject({statusCode:403})
    mocks.getSession.mockResolvedValue(session('admin','initial'))
    await expect(readStudy('opaque','90d')).rejects.toMatchObject({statusCode:403,code:'PRIVACY_ACTION_REQUIRED'})
    expect(mocks.getData).not.toHaveBeenCalled();expect(mocks.readKubios).not.toHaveBeenCalled()
  })
  it('keeps doctor health data without calling global Kubios',async()=>{
    mocks.getSession.mockResolvedValue(session('doctor'))
    const result=await readStudy('opaque','365d')
    expect(result.sources.kubios).toBe('restricted')
    expect(result.days).toMatchObject([{person:'alice',exerciseDuration:30,moodValue:8,rmssd:null}])
    expect(mocks.getData).toHaveBeenCalledWith(expect.objectContaining({role:'doctor'}),expect.objectContaining({timeRange:'365d'}))
    expect(mocks.readKubios).not.toHaveBeenCalled()
  })
  it('joins verified participant usernames to same-day real cache metrics, without needing own link',async()=>{
    const result=await readStudy('opaque','7d')
    expect(result.records.kubios).toBe(1)
    expect(result.days).toMatchObject([{person:'alice',day:'2026-11-03',rmssd:40}])
    expect(result.associations.durationRmssd).toEqual({coefficient:null,sampleSize:1,participants:1})
    expect(result.sources.kubios).toBe('ready')
  })
  it('returns explicit unavailable with preserved health data and no fabricated Kubios after a cache error',async()=>{
    mocks.readKubios.mockRejectedValue(new Error('private error'))
    const result=await readStudy('opaque','all')
    expect(result.sources.kubios).toBe('unavailable')
    expect(result.records).toMatchObject({exercise:1,mood:1,kubios:0})
    expect(result.days[0]?.rmssd).toBeNull()
    expect(JSON.stringify(result)).not.toContain('private error')
  })
  it('labels stale/pending or invalid measurement dates partial and filters the same requested window',async()=>{
    mocks.readKubios.mockResolvedValue([{userId:1,username:'alice',status:'stale',results:[{measured_timestamp:null},{measured_timestamp:'2025-01-01T00:00:00Z',result:{rmssd_ms:12}}]}])
    const result=await readStudy('opaque','30d')
    expect(result.sources.kubios).toBe('partial')
    expect(result.records.kubios).toBe(0)
    expect(result.days[0]?.rmssd).toBeNull()
  })
  it('handles the real HTTP adapter with typed periods and private no-store responses',async()=>{
    const request=new NextRequest('https://dashboard.test/api/study?period=365d',{headers:{cookie:'dashboard_session=opaque'}})
    const response=await GET(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({period:'365d',sources:{health:'ready'}})
    expect((await GET(new NextRequest('https://dashboard.test/api/study?period=90'))).status).toBe(400)
  })
})
