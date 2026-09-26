import { useAuth } from '@/context/AuthContext'
import { PageHeader } from '@/components/shared/PageHeader'
import { ProfileIdCard } from '@/components/shared/ProfileIdCard'
import { ProfileShowcase } from '@/components/profile/ProfileShowcase'
import { Skeleton } from '@/components/shared/SkeletonLoader'

export default function ProfilePage() {
  const { employee, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <Skeleton style={{ height: 34, width: 160, marginBottom: 24 }} />
        <Skeleton style={{ height: 180, width: '100%', borderRadius: 20, marginBottom: 16 }} />
        <Skeleton style={{ height: 18, width: 220, marginBottom: 10 }} />
        <Skeleton style={{ height: 13, width: 160 }} />
      </div>
    )
  }

  if (!employee) return null

  return (
    <div className="animate-fade-in">
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <PageHeader kicker="Account" title="My Profile" />
      </div>

      {/*
        The badge swings across the WHOLE content column, not the reading
        measure the rest of the page uses. A lanyard this long throws the card
        some 240px sideways at full tilt, and inside a narrow column it hit
        the edge almost immediately — which read as the card being stuck in a
        box rather than hanging off a strap.

        overflow-x: clip rather than hidden: it stops the swing from adding a
        sideways scrollbar to the page without turning this into a scroll
        container, so the shadow and the rope still spill vertically the way
        they should.
      */}
      <div style={{ overflowX: 'clip', padding: '2px 0 10px', marginBottom: 4 }}>
        <ProfileIdCard employee={employee} />
      </div>

      {/*
        The profile proper: banner, photo, name and designation, role and
        skills, and where this person stands in ValueSpot. The details the old
        list showed here live on in it — email and joining date under the
        name, company ID and access level under Settings, status on the badge.
      */}
      <ProfileShowcase employee={employee} />
    </div>
  )
}
