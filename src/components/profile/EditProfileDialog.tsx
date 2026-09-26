import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Crop, ImagePlus, Trash2, X } from 'lucide-react'
import type { Employee } from '@/types'
import { ApiError } from '@/lib/api'
import { useSaveMyProfile } from '@/hooks/queries'
import { toast } from '@/hooks/use-toast'
import { getInitials } from '@/lib/utils'
import {
  checkProfileImageFile, ProfileImageError, PROFILE_IMAGE_ACCEPT,
  type PreparedImage, type ProfileImageKind,
} from '@/lib/profile-image'
import { ProfileDialog } from './ProfileDialog'
import { ImageCropDialog, type CropState } from './ImageCropDialog'

/** Limits mirrored from update_my_profile() (054), so the form says them first. */
export const PROFILE_LIMITS = {
  name: 80,
  designation: 60,
  location: 80,
  skills: 12,
  skill: 30,
} as const

/** Offered as suggestions only — any title may be typed. */
const DESIGNATION_SUGGESTIONS = [
  'Software Engineer', 'Senior Software Engineer', 'Frontend Developer', 'Backend Developer',
  'Full Stack Developer', 'QA Engineer', 'Software Tester', 'Automation Test Engineer',
  'DevOps Engineer', 'Data Analyst', 'Data Scientist', 'UI/UX Designer', 'Product Manager',
  'Project Manager', 'Business Analyst', 'Scrum Master', 'Technical Lead', 'Engineering Manager',
  'HR Executive', 'HR Manager', 'Intern',
]

/**
 * A staged image change: `undefined` untouched, `null` removed, otherwise the
 * cropped replacement and a local preview of it. The original file and the
 * crop are kept so "Adjust" can reopen the cropper exactly where it was left.
 */
type Staged = {
  image: PreparedImage
  preview: string
  file: File
  crop: CropState
} | null | undefined

/** The cropper, while it is open. */
interface Cropping {
  kind: ProfileImageKind
  file: File
  initial?: CropState
}

/** Collapse runs of whitespace and trim — the database does the same. */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

interface EditProfileDialogProps {
  open: boolean
  onClose: () => void
  employee: Employee
}

export function EditProfileDialog({ open, onClose, employee }: EditProfileDialogProps) {
  const save = useSaveMyProfile()

  const [fullName, setFullName]       = useState('')
  const [designation, setDesignation] = useState('')
  const [location, setLocation]       = useState('')
  const [skills, setSkills]           = useState<string[]>([])
  const [skillDraft, setSkillDraft]   = useState('')
  const [avatar, setAvatar]           = useState<Staged>(undefined)
  const [cover, setCover]             = useState<Staged>(undefined)
  const [cropping, setCropping]       = useState<Cropping | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'designation' | 'location' | 'skills', string>>>({})

  const avatarInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const skillInput = useRef<HTMLInputElement>(null)

  // Reset from the record each time the dialog opens, so a cancelled edit
  // never lingers into the next one.
  useEffect(() => {
    if (!open) return
    setFullName(employee.full_name)
    setDesignation(employee.designation ?? '')
    setLocation(employee.location ?? '')
    setSkills(employee.skills ?? [])
    setSkillDraft('')
    setAvatar(undefined)
    setCover(undefined)
    setCropping(null)
    setError(null)
    setFieldErrors({})
    // Only on opening: re-running when `employee` refreshes after a save
    // would wipe what the person is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Local previews are object URLs; release each one when it is replaced.
  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar.preview) }, [avatar])
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.preview) }, [cover])

  const busy = save.isPending
  const working = busy || cropping !== null

  const shownAvatar = avatar === undefined ? employee.avatar_url : avatar?.preview ?? null
  const shownCover = cover === undefined ? (employee.cover_url ?? null) : cover?.preview ?? null
  const initials = useMemo(() => getInitials(tidy(fullName) || employee.full_name), [fullName, employee.full_name])

  /** A file was chosen: check it, then hand it to the cropper. */
  const pick = (kind: ProfileImageKind, file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      checkProfileImageFile(file)
    } catch (err) {
      setError(err instanceof ProfileImageError ? err.message : 'That image could not be used. Please try another.')
      return
    }
    setCropping({ kind, file })
  }

  /** Reopen the cropper on an image chosen earlier in this edit. */
  const adjust = (kind: ProfileImageKind) => {
    const staged = kind === 'avatar' ? avatar : cover
    if (staged) setCropping({ kind, file: staged.file, initial: staged.crop })
  }

  const applyCrop = ({ image, crop }: { image: PreparedImage; crop: CropState }) => {
    if (!cropping) return
    const staged = { image, preview: URL.createObjectURL(image.blob), file: cropping.file, crop }
    if (cropping.kind === 'avatar') setAvatar(staged)
    else setCover(staged)
    setCropping(null)
  }

  /** Add whatever is typed as one or more skills (comma-separated). */
  const commitDraft = (draft = skillDraft): { next: string[]; problem?: string } => {
    const parts = draft.split(',').map(tidy).filter(Boolean)
    if (parts.length === 0) {
      setSkillDraft('')
      return { next: skills }
    }

    const next = [...skills]
    let problem: string | undefined
    for (const part of parts) {
      if (part.length > PROFILE_LIMITS.skill) {
        problem = `Each skill can be at most ${PROFILE_LIMITS.skill} characters.`
        continue
      }
      if (next.some(s => s.toLowerCase() === part.toLowerCase())) continue
      if (next.length >= PROFILE_LIMITS.skills) {
        problem = `You can list up to ${PROFILE_LIMITS.skills} skills.`
        break
      }
      next.push(part)
    }

    setSkills(next)
    // Keep the text when something was refused, so it can be corrected.
    setSkillDraft(problem ? draft.replace(/,/g, ' ').trim() : '')
    setFieldErrors(e => ({ ...e, skills: problem }))
    return { next, problem }
  }

  const removeSkill = (skill: string) => {
    setSkills(s => s.filter(x => x !== skill))
    setFieldErrors(e => ({ ...e, skills: undefined }))
  }

  const validate = (finalSkills: string[]) => {
    const errors: typeof fieldErrors = {}
    const name = tidy(fullName)
    if (name.length < 2) errors.name = 'Your name needs at least 2 characters.'
    else if (name.length > PROFILE_LIMITS.name) errors.name = `Your name can be at most ${PROFILE_LIMITS.name} characters.`
    if (tidy(designation).length > PROFILE_LIMITS.designation) {
      errors.designation = `Designation can be at most ${PROFILE_LIMITS.designation} characters.`
    }
    if (tidy(location).length > PROFILE_LIMITS.location) {
      errors.location = `Location can be at most ${PROFILE_LIMITS.location} characters.`
    }
    if (finalSkills.length > PROFILE_LIMITS.skills) errors.skills = `You can list up to ${PROFILE_LIMITS.skills} skills.`
    return errors
  }

  const onSave = async () => {
    if (working) return
    setError(null)

    // Something still typed in the skills box is meant to be kept.
    let finalSkills = skills
    if (skillDraft.trim()) {
      const { next, problem } = commitDraft()
      if (problem) return
      finalSkills = next
    }

    const errors = validate(finalSkills)
    setFieldErrors(errors)
    if (Object.values(errors).some(Boolean)) return

    try {
      await save.mutateAsync({
        details: {
          fullName: tidy(fullName),
          designation: tidy(designation),
          location: tidy(location),
          skills: finalSkills,
        },
        ...(avatar !== undefined && { avatar: avatar?.image ?? null }),
        ...(cover !== undefined && { cover: cover?.image ?? null }),
      })
      toast({ title: 'Profile updated', variant: 'success' })
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code.startsWith('invalid:')) {
        const field = err.code.slice('invalid:'.length)
        const key = field === 'full_name' ? 'name' : field
        if (key === 'name' || key === 'designation' || key === 'location' || key === 'skills') {
          setFieldErrors({ [key]: err.message })
          return
        }
      }
      setError(err instanceof ApiError ? err.message : 'Could not save your profile. Please try again.')
    }
  }

  const count = (value: string, max: number) => (
    <span className="vp-field-count" aria-hidden="true">{tidy(value).length}/{max}</span>
  )

  return (
    <ProfileDialog
      open={open}
      onClose={onClose}
      title="Edit profile"
      description="This is what colleagues see on your profile and next to your recognitions."
      busy={busy}
      footer={
        <>
          <button type="button" className="vs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="vs-btn vs-btn-primary"
            onClick={onSave}
            disabled={working}
            aria-busy={busy}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {error && <p role="alert" className="vp-form-error">{error}</p>}

      {/* ---- Images ---- */}
      <section aria-label="Photos" className="flex flex-col gap-2">
        <span className="vp-section-title">Photo &amp; background</span>
        <div className="vp-media">
          <div className="vp-cover">
            {shownCover && <img src={shownCover} alt="" />}
          </div>

          <div className="vp-media-row">
            <div className="vp-avatar">
              <div className="vp-avatar-face">
                {shownAvatar ? <img src={shownAvatar} alt="" /> : initials}
              </div>
            </div>

            <div className="flex flex-col gap-2" style={{ paddingTop: 10, minWidth: 0 }}>
              <div className="vp-media-actions">
                <button type="button" className="vp-mini-btn" onClick={() => avatarInput.current?.click()} disabled={working}>
                  <Camera size={14} /> {shownAvatar ? 'Change photo' : 'Add photo'}
                </button>
                {avatar && (
                  <button type="button" className="vp-mini-btn" onClick={() => adjust('avatar')} disabled={working} aria-label="Adjust the crop of the new profile photo">
                    <Crop size={13} /> Adjust
                  </button>
                )}
                {shownAvatar && (
                  <button type="button" className="vp-mini-btn" onClick={() => setAvatar(null)} disabled={working} aria-label="Remove profile photo">
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
              <div className="vp-media-actions">
                <button type="button" className="vp-mini-btn" onClick={() => coverInput.current?.click()} disabled={working}>
                  <ImagePlus size={14} /> {shownCover ? 'Change background' : 'Add background'}
                </button>
                {cover && (
                  <button type="button" className="vp-mini-btn" onClick={() => adjust('cover')} disabled={working} aria-label="Adjust the crop of the new background image">
                    <Crop size={13} /> Adjust
                  </button>
                )}
                {shownCover && (
                  <button type="button" className="vp-mini-btn" onClick={() => setCover(null)} disabled={working} aria-label="Remove background image">
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <p className="vp-field-hint">
          JPG, PNG, WebP or GIF, up to 15 MB. After choosing one you can drag and zoom to pick the part that shows.
        </p>

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

        {/* Opens over this dialog; nothing is saved until "Save changes". */}
        <ImageCropDialog
          open={cropping !== null}
          file={cropping?.file ?? null}
          kind={cropping?.kind ?? 'avatar'}
          initial={cropping?.initial}
          onCancel={() => setCropping(null)}
          onApply={applyCrop}
        />
      </section>

      {/* ---- Details ---- */}
      <div className="vp-field">
        <label htmlFor="vp-name" className="vp-field-label">
          <span>Full name <span aria-hidden="true" style={{ color: 'var(--vp-accent)' }}>*</span></span>
          {count(fullName, PROFILE_LIMITS.name)}
        </label>
        <input
          id="vp-name"
          className="vs-input"
          value={fullName}
          maxLength={PROFILE_LIMITS.name + 20}
          autoComplete="name"
          onChange={e => { setFullName(e.target.value); setFieldErrors(f => ({ ...f, name: undefined })) }}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? 'vp-name-err' : undefined}
          disabled={busy}
        />
        {fieldErrors.name && <p id="vp-name-err" className="vp-field-error">{fieldErrors.name}</p>}
      </div>

      <div className="vp-field">
        <label htmlFor="vp-designation" className="vp-field-label">
          <span>Designation</span>
          {count(designation, PROFILE_LIMITS.designation)}
        </label>
        <input
          id="vp-designation"
          className="vs-input"
          value={designation}
          list="vp-designation-options"
          placeholder="e.g. Software Engineer, QA Engineer"
          maxLength={PROFILE_LIMITS.designation + 20}
          autoComplete="organization-title"
          onChange={e => { setDesignation(e.target.value); setFieldErrors(f => ({ ...f, designation: undefined })) }}
          aria-invalid={fieldErrors.designation ? true : undefined}
          aria-describedby={fieldErrors.designation ? 'vp-designation-err' : 'vp-designation-hint'}
          disabled={busy}
        />
        <datalist id="vp-designation-options">
          {DESIGNATION_SUGGESTIONS.map(d => <option key={d} value={d} />)}
        </datalist>
        {fieldErrors.designation
          ? <p id="vp-designation-err" className="vp-field-error">{fieldErrors.designation}</p>
          : <p id="vp-designation-hint" className="vp-field-hint">Your job title. HR, your managers and administrators see it too.</p>}
      </div>

      <div className="vp-field">
        <label htmlFor="vp-location" className="vp-field-label">
          <span>Location</span>
          {count(location, PROFILE_LIMITS.location)}
        </label>
        <input
          id="vp-location"
          className="vs-input"
          value={location}
          placeholder="e.g. Pune, Maharashtra"
          maxLength={PROFILE_LIMITS.location + 20}
          autoComplete="address-level2"
          onChange={e => { setLocation(e.target.value); setFieldErrors(f => ({ ...f, location: undefined })) }}
          aria-invalid={fieldErrors.location ? true : undefined}
          aria-describedby={fieldErrors.location ? 'vp-location-err' : undefined}
          disabled={busy}
        />
        {fieldErrors.location && <p id="vp-location-err" className="vp-field-error">{fieldErrors.location}</p>}
      </div>

      <div className="vp-field">
        <label htmlFor="vp-skill" className="vp-field-label">
          <span>Skills</span>
          <span className="vp-field-count">{skills.length}/{PROFILE_LIMITS.skills}</span>
        </label>
        <div className="vp-skill-field" onClick={() => skillInput.current?.focus()}>
          {skills.map(skill => (
            <span key={skill} className="vp-chip">
              {skill}
              <button
                type="button"
                className="vp-chip-x"
                onClick={e => { e.stopPropagation(); removeSkill(skill) }}
                aria-label={`Remove ${skill}`}
                disabled={busy}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            id="vp-skill"
            ref={skillInput}
            className="vp-skill-input"
            value={skillDraft}
            placeholder={skills.length >= PROFILE_LIMITS.skills ? 'Limit reached' : skills.length ? 'Add another…' : 'Type a skill and press Enter'}
            disabled={busy || skills.length >= PROFILE_LIMITS.skills}
            onChange={e => {
              const value = e.target.value
              // A typed or pasted comma completes a skill.
              if (value.includes(',')) commitDraft(value)
              else {
                setSkillDraft(value)
                if (fieldErrors.skills) setFieldErrors(f => ({ ...f, skills: undefined }))
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              } else if (e.key === 'Backspace' && !skillDraft && skills.length) {
                removeSkill(skills[skills.length - 1])
              }
            }}
            onBlur={() => { if (skillDraft.trim()) commitDraft() }}
            aria-invalid={fieldErrors.skills ? true : undefined}
            aria-describedby={fieldErrors.skills ? 'vp-skill-err' : 'vp-skill-hint'}
          />
        </div>
        {fieldErrors.skills
          ? <p id="vp-skill-err" className="vp-field-error">{fieldErrors.skills}</p>
          : <p id="vp-skill-hint" className="vp-field-hint">Press Enter or type a comma after each one.</p>}
      </div>
    </ProfileDialog>
  )
}
