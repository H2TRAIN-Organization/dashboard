import AdminKubios from '@/components/AdminKubios'
export default async function Page({ params }: { params: Promise<{ userId: string }> }) { return <AdminKubios userId={(await params).userId} /> }
