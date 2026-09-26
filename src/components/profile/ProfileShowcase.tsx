import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Briefcase, CalendarDays, Camera, Loader2, Mail, MapPin, Pencil, Plus, Star,
} from 'lucide-react'
import type { Employee } from '@/types'
import {
  useBadgeDefinitions, useCoreValues, useEmployeeDashboard, useSaveMyProfile, useWalletBalance,
} from '@/hooks/queries'
import { toast } from '@/hooks/use-toast'
import { ROUTES } from '@/lib/constants'
import { roleLabel } from '@/lib/portals'
import { formatIST } from '@/lib/date-utils'
import { nextMilestoneOf } from '@/lib/milestone'
import { getInitials } from '@/lib/utils'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import {
  checkProfileImageFile, ProfileImageError, PROFILE_IMAGE_ACCEPT,
  type PreparedImage, type ProfileImageKind,
} from '@/lib/profile-image'
import { EditProfileDialog } from './EditProfileDialog'
import { ImageCropDialog } from './ImageCropDialog'
import { ProfileSettingsDialog } from './ProfileSettingsDialog'

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * The profile header: banner, photo, name and title, with the person's role
 * and skills on the right and three tiles along the foot that say where they
 * stand in ValueSpot — badge level, recognitions, Value Coins.
 *
 * Only ever the signed-in person's own profile (the route has no id), so the
 * edit affordances are always shown.
 */
export function ProfileShowcase({ employee }: { employee: Employee }) {
  const [editing, setEditing]   = useState(false)
  const [settings, setSettings] = useState(false)
  const [uploading, setUploading] = useState<ProfileImageKind | null>(null)

  const save = useSaveMyProfile()
  const avatarInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)

  // Absent until migration 054 is applied; the card must still render.
  const designation = employee.designation ?? null
  const location = employee.location ?? null
  const skills = employee.skills ?? []
  const coverUrl = employee.cover_url ?? null

  const [avatarBroken, setAvatarBroken] = useState<string | null>(null)
  const [coverBroken, setCoverBroken]   = useState<string | null>(null)
  const showAvatar = employee.avatar_url && avatarBroken !== employee.avatar_url
  const showCover = coverUrl && coverBroken !== coverUrl

  /**
   * The quick path: the pencil on the banner and the camera on the photo.
   * Picking a file opens the cropper; its Save uploads straight away.
   */
  const [cropping, setCropping] = useState<{ kind: ProfileImageKind; file: File } | null>(null)

  const pick = (kind: ProfileImageKind, file: File | undefined) => {
    if (!file || uploading) return
    try {
      checkProfileImageFile(file)
    } catch (err) {
      toast({
        title: kind === 'avatar' ? 'Photo not updated' : 'Background not updated',
        description: err instanceof ProfileImageError ? err.message : 'That image could not be used.',
        variant: 'destructive',
      })
      return
    }
    setCropping({ kind, file })
  }

  /**
   * Errors are left to propagate: the cropper stays open and shows them, so a
   * failed upload does not throw away the framing the person just chose.
   */
  const saveCrop = async ({ image }: { image: PreparedImage }) => {
    if (!cropping) return
    const { kind } = cropping
    setUploading(kind)
    try {
      await save.mutateAsync({ [kind]: image })
      setCropping(null)
      toast({ title: kind === 'avatar' ? 'Profile photo updated' : 'Background updated', variant: 'success' })
    } finally {
      setUploading(null)
    }
  }

  return (
    <section className="vp-scope" aria-label="Profile">
      <div className="vp-card">
        {/* ---- Banner ---- */}
        <div className="vp-cover">
          {showCover && (
            <img src={coverUrl} alt="" onError={() => setCoverBroken(coverUrl)} />
          )}
          {uploading === 'cover' && (
            <div className="vp-busy" style={{ borderRadius: 0 }}>
              <Loader2 size={22} className="animate-spin" aria-label="Uploading background" />
            </div>
          )}
          <button
            type="button"
            className="vp-cover-edit"
            onClick={() => coverInput.current?.click()}
            disabled={uploading !== null}
            aria-label={coverUrl ? 'Change background image' : 'Add a background image'}
            title={coverUrl ? 'Change background image' : 'Add a background image'}
          >
            <Pencil size={16} />
          </button>
        </div>

        <div className="vp-body">
          {/* ---- Left: who ---- */}
          <div className="vp-identity">
            <div className="vp-avatar">
              <div className="vp-avatar-face">
                {showAvatar
                  ? <img src={employee.avatar_url!} alt={employee.full_name} onError={() => setAvatarBroken(employee.avatar_url)} />
                  : <span aria-hidden="true">{getInitials(employee.full_name)}</span>}
              </div>
              {uploading === 'avatar' && (
                <div className="vp-busy">
                  <Loader2 size={22} className="animate-spin" aria-label="Uploading photo" />
                </div>
              )}
              <button
                type="button"
                className="vp-avatar-edit"
                onClick={() => avatarInput.current?.click()}
                disabled={uploading !== null}
                aria-label={employee.avatar_url ? 'Change profile photo' : 'Add a profile photo'}
                title={employee.avatar_url ? 'Change profile photo' : 'Add a profile photo'}
              >
                <Camera size={15} />
              </button>
            </div>

            <h2 className="vp-name">{employee.full_name}</h2>
            <p className="vp-title">{designation ?? roleLabel(employee.role)}</p>

            <div className="vp-meta">
              {location && <span><MapPin size={14} aria-hidden="true" />{location}</span>}
              <span><Mail size={14} aria-hidden="true" />{employee.email}</span>
              {employee.joined_at && (
                <span><CalendarDays size={14} aria-hidden="true" />Joined {formatIST(employee.joined_at, 'MMMM yyyy')}</span>
              )}
            </div>

            <div className="vp-actions">
              <button type="button" className="vp-btn vp-btn-solid" onClick={() => setEditing(true)}>
                Edit Profile
              </button>
              <button type="button" className="vp-btn vp-btn-outline" onClick={() => setSettings(true)}>
                Settings
              </button>
            </div>
          </div>

          {/* ---- Right: role and skills ---- */}
          <div className="vp-aside">
            <div className="vp-aside-block">
              <span className="vp-aside-label">Current role <Briefcase size={17} aria-hidden="true" /></span>
              <div className="vp-chips">
                {designation
                  ? <span className="vp-chip">{designation}</span>
                  : (
                    <button type="button" className="vp-chip vp-chip-add" onClick={() => setEditing(true)}>
                      <Plus size={13} aria-hidden="true" /> Add your designation
                    </button>
                  )}
              </div>
            </div>

            <div className="vp-aside-block">
              <span className="vp-aside-label">Skills <Star size={17} aria-hidden="true" /></span>
              <div className="vp-chips">
                {skills.length > 0
                  ? skills.map(skill => <span key={skill} className="vp-chip">{skill}</span>)
                  : (
                    <button type="button" className="vp-chip vp-chip-add" onClick={() => setEditing(true)}>
                      <Plus size={13} aria-hidden="true" /> Add skills
                    </button>
                  )}
              </div>
            </div>
          </div>

          {/* ---- Foot: standing in ValueSpot ---- */}
          <ProfileHighlights employeeId={employee.id} />
        </div>
      </div>

      <input
        ref={avatarInput}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        hidden
        onChange={e => { pick('avatar', e.target.files?.[0]); e.target.value = '' }}
      />
      <input
        ref={coverInput}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        hidden
        onChange={e => { pick('cover', e.target.files?.[0]); e.target.value = '' }}
      />

      <ImageCropDialog
        open={cropping !== null}
        file={cropping?.file ?? null}
        kind={cropping?.kind ?? 'avatar'}
        applyLabel="Save"
        onCancel={() => setCropping(null)}
        onApply={saveCrop}
      />
      <EditProfileDialog open={editing} onClose={() => setEditing(false)} employee={employee} />
      <ProfileSettingsDialog open={settings} onClose={() => setSettings(false)} employee={employee} />
    </section>
  )
}

/* ------------------------------------------------------------------------- */

interface TileProps {
  to: string
  kicker: string
  title: string
  desc: string
  loading?: boolean
}

function Tile({ to, kicker, title, desc, loading }: TileProps) {
  return (
    <Link to={to} className="vp-tile" aria-busy={loading || undefined}>
      <div className="vp-tile-text">
        <span className="vp-tile-kicker">{kicker}</span>
        {loading ? (
          <>
            <Skeleton style={{ height: 16, width: '70%', borderRadius: 6 }} />
            <Skeleton style={{ height: 12, width: '90%', marginTop: 8, borderRadius: 6 }} />
          </>
        ) : (
          <>
            <span className="vp-tile-title">{title}</span>
            <span className="vp-tile-desc">{desc}</span>
          </>
        )}
      </div>
      <span className="vp-tile-go" aria-hidden="true"><ArrowRight size={16} /></span>
    </Link>
  )
}

/**
 * The three tiles. Each reads a query the rest of the app already caches —
 * the dashboard's badge and recognition figures, the wallet balance — so
 * arriving here from the dashboard costs no new request.
 */
function ProfileHighlights({ employeeId }: { employeeId: string }) {
  const coreValuesQuery = useCoreValues()
  const badgeQuery = useBadgeDefinitions()
  const coreValues = coreValuesQuery.data ?? []
  const badgeDefinitions = badgeQuery.data ?? []
  const dashboard = useEmployeeDashboard(employeeId, coreValues, badgeDefinitions)
  const wallet = useWalletBalance(employeeId)

  const stats = dashboard.data
  /*
    The dashboard query stays DISABLED until both catalogues have rows, so
    "pending" alone would spin forever on a database with no core values or no
    badge levels configured. Loading means: a catalogue is still arriving, or
    the catalogue is there and the figures are on their way.
  */
  const catalogueFailed = coreValuesQuery.isError || badgeQuery.isError
  const catalogueEmpty =
    coreValuesQuery.isSuccess && badgeQuery.isSuccess &&
    (coreValues.length === 0 || badgeDefinitions.length === 0)
  const statsLoading = !stats && !dashboard.isError && !catalogueFailed && !catalogueEmpty

  // ---- Badge level ----
  let badgeTitle = 'Core value badges'
  let badgeDesc = 'Open your journey to see your progress.'
  if (stats) {
    const earned = stats.badges.filter(b => (b.badge_level ?? 0) > 0)
    const best = [...earned].sort(
      (a, b) => (b.badge_level ?? 0) - (a.badge_level ?? 0) || b.recognition_count - a.recognition_count,
    )[0]
    const next = nextMilestoneOf(stats.badges)
    const gap = next ? Math.max(0, (next.next_threshold ?? 0) - next.recognition_count) : 0

    if (best) {
      badgeTitle = `Level ${best.badge_level} · ${best.badge_name ?? 'Badge'}`
      badgeDesc = `Your highest is in ${best.core_value_name}. ` + (
        next && next.next_badge_name
          ? `Next up: ${next.next_badge_name} in ${next.core_value_name}, ${plural(gap, 'recognition')} away.`
          : `Badges in ${earned.length} of ${stats.badges.length} core values.`
      )
    } else {
      badgeTitle = 'No badge yet'
      badgeDesc = next && next.next_badge_name
        ? `${plural(gap, 'recognition')} away from ${next.next_badge_name} in ${next.core_value_name}.`
        : 'Get recognised for a core value to earn your first badge.'
    }
  } else if (dashboard.isError || catalogueFailed) {
    badgeDesc = 'Could not load your badges. Open your journey to see them.'
  } else if (catalogueEmpty) {
    badgeDesc = 'Badges appear here once HR has set up core values.'
  }

  // ---- Recognitions ----
  let recTitle = 'Recognitions'
  let recDesc = 'Open My Recognitions to see what you have received and given.'
  if (stats) {
    recTitle = `${plural(stats.received, 'recognition')} received`
    recDesc = `${stats.given.toLocaleString()} given · ${stats.thisMonth.toLocaleString()} received this month` +
      (stats.mostRecognizedValue ? ` · Most for ${stats.mostRecognizedValue}` : '')
  }

  // ---- Value Coins ----
  let coinTitle = 'Value Wallet'
  let coinDesc = 'Open your wallet to see your Value Coins.'
  if (wallet.data) {
    coinTitle = `${plural(wallet.data.earned, 'Value Coin')} earned`
    coinDesc = `${wallet.data.budget.toLocaleString()} left to give this period. Redeem earned coins in the Value Store.`
  }

  return (
    <div className="vp-highlights" aria-label="Your ValueSpot standing">
      <Tile
        to={ROUTES.CORE_VALUE_JOURNEY}
        kicker="Badge level"
        title={badgeTitle}
        desc={badgeDesc}
        loading={statsLoading}
      />
      <Tile
        to={ROUTES.MY_RECOGNITIONS}
        kicker="Recognitions"
        title={recTitle}
        desc={recDesc}
        loading={statsLoading}
      />
      <Tile
        to={ROUTES.WALLET}
        kicker="Rewards"
        title={coinTitle}
        desc={coinDesc}
        loading={wallet.isPending && !wallet.isError}
      />
    </div>
  )
}
