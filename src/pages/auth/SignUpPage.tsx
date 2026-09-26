import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { employeesApi, referenceApi, ApiError } from '@/lib/api'
import { ROUTES } from '@/lib/constants'
import { roleLabel, type Portal } from '@/lib/portals'
import type { UserRole } from '@/types'
import {
  AuthShell, FieldError, FieldHint, FieldLabel, FormAlert, IconInput,
  PasswordField, PasswordStrength,
} from '@/components/auth/AuthShell'
import { VerifyEmailStep } from '@/components/auth/VerifyEmailStep'

/**
 * Account creation, for all three roles.
 *
 * ONE component, three entry experiences. `portal` changes what the page says
 * and who it is willing to serve. It does not change what the account may do —
 * claim_employee_account() decides that, and it reads only the database:
 *
 *   HR added you    the record already exists at the role HR chose, and
 *                   signing up links your login to it. That role stands.
 *
 *   Nobody did      a new record is created at 'employee', a literal in the
 *                   function. There is no argument, claim or metadata field
 *                   that can raise it.
 *
 * So there is no role selector anywhere on this page, and nothing the browser
 * sends influences the outcome. Someone who opens /hr/setup uninvited gets an
 * ordinary Employee account, not HR — the refusal below is a courtesy that
 * explains why, not the thing preventing it.
 *
 * Client-side validation is for fast feedback only. Registration is two steps:
 * details, then a six-digit code emailed to the address, which proves the
 * mailbox belongs to the person signing up.
 */
const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name'),
    email: z
      .string()
      .trim()
      .min(1, 'Company email address is required')
      .email('Enter a valid company email address'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string().min(1, 'Re-enter your password'),
    /*
      Optional HERE, required by the form below when there is anything to
      choose from. A fresh workspace has no departments yet — the person
      creating the very first account is the one who will go on to create them
      — and a required field with an empty dropdown is a dead end. The rule
      that actually applies is in `departments.length > 0`.
    */
    departmentId: z.string().optional(),
    /*
      Optional here for the same reason as departmentId, and enforced the same
      way: the real rule lives in `projects.length > 0` below, because the
      schema cannot see whether there is anything to choose from. A Manager
      whose projects are all already managed has an empty list and must not be
      blocked by a field nobody can answer.
    */
    projectId: z.string().optional(),
  })
  .refine(v => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type SignUpForm = z.infer<typeof signUpSchema>

interface EligibilityResult {
  status:
    | 'first_admin'          // empty system — this account becomes the administrator
    | 'invited'              // HR already holds a record; its role applies
    | 'open'                 // no record — one is created at 'employee'
    | 'already_registered'
    | 'name_mismatch'        // address is on record under a different name
    | 'inactive'
    | 'domain_blocked'
  expected_role: UserRole | null
}

/** Copy for each entry point. `setupOnly` pages serve invited people only. */
const ENTRY: Record<Portal['id'], {
  kicker: string
  title: string
  subtitle: string
  setupOnly: boolean
  loginPath: string
}> = {
  employee: {
    // No kicker: the logo above the title already names the product.
    kicker: '',
    title: 'Create account',
    subtitle: 'You will sign in with this email address.',
    setupOnly: false,
    loginPath: ROUTES.LOGIN,
  },
  manager: {
    kicker: 'Manager',
    title: 'Set Up Manager Account',
    subtitle: 'Finish setting up the account HR created for you.',
    setupOnly: true,
    loginPath: ROUTES.MANAGER_LOGIN,
  },
  hr_admin: {
    kicker: 'HR',
    title: 'Set Up HR Account',
    subtitle: 'Finish setting up the account HR created for you.',
    setupOnly: true,
    loginPath: ROUTES.HR_LOGIN,
  },
}

/** The brand panel's walk-through, one entry per screen the person will see. */
const SIGNUP_STEPS = [
  { title: 'Register', text: 'Your name, work email address and a password.' },
  { title: 'Confirm your email', text: 'Enter the 6-digit code we send to your inbox.' },
  { title: 'Start recognizing', text: "Celebrate colleagues for living Touchcore's Core Values." },
]

export default function SignUpPage({ portal = 'employee' }: { portal?: Portal['id'] }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const entry = ENTRY[portal]

  const [formError, setFormError] = useState<React.ReactNode>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [firstAdmin, setFirstAdmin] = useState(false)

  // The role HR stored on this person's record, once the database confirms
  // there is one. Read from check_signup_eligibility(), never from the URL.
  const [invitedRole, setInvitedRole] = useState<UserRole | null>(null)

  // Eligibility has resolved and found no record for this address. On a setup
  // page that is the wrong door, and worth saying so.
  const [uninvited, setUninvited] = useState(false)

  // Details accepted; waiting on the emailed code.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  // An invitation link carries the address it was sent to.
  const invitedEmail = searchParams.get('email')?.trim().toLowerCase() ?? ''

  /*
    The department question.

    Asked on this form, but it cannot be SAVED from this form: there is no
    account, no session and no employee record until the emailed code is
    accepted. So the answer is held here and written in onVerified(), once
    claim_employee_account() has created the record to write it to.

    Read through signup_departments() rather than the table, because this page
    runs as anon — see migration 032.
  */
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [chosenDepartment, setChosenDepartment] = useState('')

  useEffect(() => {
    let cancelled = false

    referenceApi.listSignupDepartments()
      .then(list => { if (!cancelled) setDepartments(list) })
      .catch(() => {
        // Non-fatal by design. Registration is the important thing on this
        // page; if the list cannot be fetched the field simply does not
        // appear, and HR can set the department on the employee record.
        if (!cancelled) setDepartments([])
      })

    return () => { cancelled = true }
  }, [])

  /*
    The project question. Same lifecycle as the department above: asked here,
    held here, written in onVerified() once there is a record to write it to.

    WHAT IS OFFERED DEPENDS ON THE DOOR.

      employee / hr   active projects — the one they work on, a project_members row
      manager         active projects with NO Project Manager

    A Manager is offered only unmanaged projects because taking a project off
    its current manager is an administrative act. set_own_project() refuses it
    server-side too (038); this only avoids offering a choice that would be
    refused.
  */
  const forManager = portal === 'manager'

  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [chosenProject, setChosenProject] = useState('')

  /*
    Set when the account was created but the project was not stored as chosen.
    Replaces the whole form when present: the account exists, so re-submitting
    is not the answer, and the only useful next step is to sign in and ask HR.
  */
  const [projectNotice, setProjectNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    referenceApi.listSignupProjects(forManager)
      .then(list => { if (!cancelled) setProjects(list) })
      .catch(() => {
        // Non-fatal, for the same reason the department list is: registration
        // is what this page is for, and HR can assign the project afterwards.
        if (!cancelled) setProjects([])
      })

    return () => { cancelled = true }
  }, [forManager])

  const {
    register, handleSubmit, watch,
    formState: { errors, isSubmitting },
  } = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: invitedEmail },
  })

  const password = watch('password') ?? ''
  const emailValue = watch('email') ?? ''
  const nameValue = watch('fullName') ?? ''

  // Until a usable administrator exists, the next person to sign up becomes
  // one. Announced up front so the person setting the product up knows this is
  // the moment, rather than discovering afterwards that nobody can issue codes.
  useEffect(() => {
    let cancelled = false
    supabase.rpc('auth_setup_status').then(({ data }) => {
      if (cancelled || !data) return
      const status = data as { accepting_first_admin?: boolean }
      if (status.accepting_first_admin) setFirstAdmin(true)
    })
    return () => { cancelled = true }
  }, [])

  /*
    Has HR already set this person up, and as what?

    The answer comes from check_signup_eligibility(), which reads the employee
    record — never from the URL. An invitation link carries an address and
    nothing else, so a role in the query string would be a value to forge; there
    isn't one. The address alone is not enough either: the RPC returns 'invited'
    only once the name matches the record too, which is why this watches both
    fields rather than firing on the link alone.

    Advisory. Whatever it says, claim_employee_account() reaches its own
    conclusion against the same record, and for an invited address it ignores
    the requested role entirely.
  */
  useEffect(() => {
    const email = emailValue.trim().toLowerCase()
    const fullName = nameValue.trim()

    if (!email.includes('@') || fullName.length < 2) {
      setInvitedRole(null)
      setUninvited(false)
      return
    }

    let cancelled = false
    const t = setTimeout(() => {
      supabase
        .rpc('check_signup_eligibility', { p_email: email, p_full_name: fullName })
        .then(({ data }) => {
          if (cancelled || !data) return
          const result = data as unknown as EligibilityResult
          const invited = result.status === 'invited' ? result.expected_role : null
          setInvitedRole(invited)
          setUninvited(result.status === 'open')
        })
    }, 400)

    return () => { cancelled = true; clearTimeout(t) }
  }, [emailValue, nameValue])

  const onSubmit = async (values: SignUpForm) => {
    setFormError(null)
    setAccountExists(false)

    const email = values.email.trim().toLowerCase()
    const fullName = values.fullName.trim()

    // Required only when there is something to pick. Enforced here rather than
    // in the zod schema because the schema cannot see whether the workspace
    // has any departments yet.
    if (departments.length > 0 && !values.departmentId) {
      setFormError('Please choose your department.')
      return
    }

    // Same rule, same reason: required only when there is something to pick.
    if (projects.length > 0 && !values.projectId) {
      setFormError(forManager
        ? 'Please choose the project you will manage.'
        : 'Please choose your project.')
      return
    }

    // Both survive into step two, where there is finally a record to write to.
    setChosenDepartment(values.departmentId ?? '')
    setChosenProject(values.projectId ?? '')

    // Ask the database what it knows, so the form can explain itself instead of
    // surfacing a raw trigger error. Purely advisory.
    const { data: raw, error: rpcError } = await supabase.rpc('check_signup_eligibility', {
      p_email: email,
      p_full_name: fullName,
    })

    /*
      Setup pages are invitation-only, so stop here rather than create an auth
      account that has nowhere to go.

      This is the courteous half of the rule. The binding half is in
      claim_employee_account(), which is passed p_require_invited_role below
      and refuses on its own — so skipping this check by any means still ends
      in a refusal, never in an account.
    */
    if (entry.setupOnly) {
      const result = raw ? (raw as unknown as EligibilityResult) : null
      const invitedAs = result?.status === 'invited' ? result.expected_role : null

      if (invitedAs !== portal) {
        setFormError(
          `This page is for people invited as ${roleLabel(portal as UserRole)}. ` +
          (result?.status === 'invited'
            ? 'Your invitation is for a different role — use the link in your invitation email.'
            : 'We have no invitation for that address and full name. Check both ' +
              'match your invitation email exactly, or ask HR to invite you.'),
        )
        return
      }
    }

    if (rpcError) {
      console.warn(
        '[ValueSpot] check_signup_eligibility unavailable — migration 011 is probably ' +
        'not applied. Run `npm run doctor`.',
        rpcError.message,
      )
    } else if (raw) {
      const result = raw as unknown as EligibilityResult

      // Only four outcomes stop the form. 'open', 'invited' and 'first_admin'
      // all proceed — they differ only in which role the database will assign.
      if (result.status === 'already_registered') {
        setAccountExists(true)
        setFormError('An account already exists for this email address.')
        return
      }

      if (result.status === 'name_mismatch') {
        setFormError(
          'HR already holds a record for this email address under a different ' +
          'name. Enter your full name exactly as HR has it, or contact HR if ' +
          'the record needs correcting.',
        )
        return
      }

      if (result.status === 'inactive') {
        setFormError('This employee record is not active. Please contact HR.')
        return
      }

      if (result.status === 'domain_blocked') {
        setFormError(
          'Accounts can only be created with a company email address. Use your ' +
          'work address, or ask HR to invite you.',
        )
        return
      }
    }

    const { error } = await supabase.auth.signUp({
      email,
      password: values.password,
      options: {
        // Compared against the employee record when HR has already added this
        // person. It grants nothing on its own, and it is the ONLY thing the
        // browser contributes to the outcome — there is deliberately no role
        // field here for the database to have to distrust.
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}${ROUTES.LOGIN}`,
      },
    })

    if (error) {
      const raw = error.message.toLowerCase()
      const status = (error as { status?: number }).status

      if (status === 429 || raw.includes('rate limit') || raw.includes('only request this after')) {
        setFormError(
          'Too many sign-up attempts in a short time. Please wait a few minutes ' +
          'and try again.',
        )
        return
      }
      if (raw.includes('already registered') || raw.includes('already exists')) {
        setAccountExists(true)
        // Reaching here means the eligibility check found no employee record
        // yet Supabase Auth already holds this address. That is the normal
        // shape of an abandoned sign-up: the account was created, the emailed
        // code was never entered, so no employee record was ever made.
        //
        // Nothing is broken and nothing needs deleting — signing in finishes
        // the job, because the employee record is created once the code is
        // accepted. Saying only "an account already exists" sends people
        // looking for a way to remove it, which is the wrong direction.
        setFormError(
          'An account already exists for this email address. Please sign in ' +
          'instead — if you never finished the email verification, signing in ' +
          'will complete it.',
        )
        return
      }
      if (raw.includes('not active')) {
        setFormError('This employee record is not active. Please contact HR.')
        return
      }
      if (raw.includes('signups not allowed') || raw.includes('signup is disabled')) {
        setFormError('Account creation is disabled for this workspace. Please contact IT.')
        return
      }
      if (raw.includes('not been invited') || raw.includes('database error')) {
        setFormError(
          'Account creation is blocked by a setting on this workspace. Please ' +
          'contact IT.',
        )
        return
      }

      setFormError('We could not create your account. Please try again.')
      return
    }

    // The account exists and Supabase has issued a password session, but that
    // session cannot do anything until the emailed code is entered — the
    // database refuses to create the employee record for an unverified
    // session. So every signup goes through step two.
    setPendingEmail(email)
  }

  /**
   * Step two finished: the session is verified, so create or link the record.
   *
   * On a setup page the invited role is passed as a REQUIREMENT. It cannot
   * grant anything — the database still reads the role off the employee record
   * — it only tells the database to refuse rather than fall back to creating an
   * ordinary Employee account from a door meant for someone invited.
   */
  const onVerified = async () => {
    // Employee is the public door and carries no requirement; the other two
    // are invitation-only. Written as a narrowing so the two sets cannot drift.
    const requiredRole = portal === 'employee' ? null : portal

    const { data } = await supabase.rpc(
      'claim_employee_account',
      requiredRole ? { p_require_invited_role: requiredRole } : {},
    )
    const result = data as { status?: string } | null

    if (result?.status === 'invitation_required' || result?.status === 'invitation_role_mismatch') {
      await supabase.auth.signOut()
      setPendingEmail(null)
      setFormError(
        `We could not find an invitation for you as ${roleLabel(portal as UserRole)}. ` +
        'Use the link in your invitation email, or ask HR to invite you.',
      )
      return
    }

    /*
      The department they chose on the form.

      Deliberately AFTER the claim, and deliberately unable to fail the signup:
      the record has to exist before there is anything to write to, and a
      department that would not save must not cost someone the account they
      just created. set_own_department() writes only when the column is still
      null, so an invited person whose department HR already set keeps HR's
      value and this call is a no-op.

      Also before the signOut() below, which ends the session the write needs.
    */
    if (chosenDepartment) {
      try {
        await employeesApi.setOwnDepartment(chosenDepartment)
      } catch (err) {
        console.warn(
          '[ValueSpot] Could not save the department chosen at signup. ' +
          'HR can set it on the employee record.',
          err,
        )
      }
    }

    /*
      The project they chose. Same placement as the department — after the
      claim, before the signOut that ends the session this write needs.

      DELIBERATELY NOISIER THAN THE DEPARTMENT. A missing department costs a
      reporting dimension; a missing project means nobody's Team Recognition
      shows this person and, for a Manager, that the project has no approver.
      Failing quietly would leave an account that looks complete and is not.

      It still must not cost them the account, which already exists by now. So
      the failure is reported on the page rather than thrown: they are told
      what did not happen and who fixes it, and they keep the account.

      set_own_project() writes only into an empty slot, so an invited person
      whose project HR already set keeps HR's value and this is a no-op.
    */
    /*
      Held in a local as well as in state: the navigation decision below has to
      read it in this same tick, and a setState is not visible until the next
      render.
    */
    let notice: string | null = null

    if (chosenProject) {
      try {
        const outcome = await employeesApi.setOwnProject(chosenProject)

        // Not an error: HR had already assigned them. Worth saying, because
        // the person picked something else and should not be surprised later.
        if (outcome.status === 'already_assigned' && outcome.project) {
          notice =
            `Your account is ready. You were already assigned to ${outcome.project}, ` +
            'so that has been kept — ask HR if you need it changed.'
        }
      } catch (err) {
        notice = err instanceof ApiError
          ? `Your account was created, but your project was not saved. ${err.message}`
          : 'Your account was created, but your project could not be saved. ' +
            'Ask HR to assign it.'
      }
    }

    /*
      Stop and say so rather than navigating past it. The account exists and is
      usable either way — the notice offers the way on — but a project that did
      not save has to be READ by the person who chose it, because HR is the
      only one who can put it right and nobody else will notice it is missing.
    */
    if (notice) {
      setProjectNotice(notice)
      if (entry.setupOnly) await supabase.auth.signOut()
      return
    }

    // A setup page is a one-time hand-off: the account now exists at the role
    // HR assigned, and they sign in through the ordinary door from here on.
    if (entry.setupOnly) {
      await supabase.auth.signOut()
      navigate(entry.loginPath, { replace: true, state: { accountReady: portal } })
      return
    }

    navigate('/', { replace: true })
  }

  /*
    The account exists; only the project did not land as chosen. Shown ahead of
    the verify step because by this point verification has already happened —
    going back to either screen would invite a second registration.
  */
  if (projectNotice) {
    return (
      <AuthShell
        headline={<>Your account<br />is ready.</>}
        intro="There is one thing to pass on to HR before you start."
      >
        <div className="au-head">
          <h2 className="au-title">Your account is ready</h2>
        </div>

        <FormAlert>{projectNotice}</FormAlert>

        <p className="au-subtitle" style={{ margin: '0 0 22px' }}>
          You can sign in now. HR and Super Admin can set or change your project
          at any time from the Employees screen, and everything else about your
          account is complete.
        </p>

        <Link to={entry.loginPath} className="au-btn">
          Go to sign in
        </Link>
      </AuthShell>
    )
  }

  if (pendingEmail) {
    return (
      <VerifyEmailStep
        email={pendingEmail}
        purpose="signup"
        onVerified={onVerified}
        onBack={() => setPendingEmail(null)}
      />
    )
  }

  // ── Form ──────────────────────────────────────────────────
  return (
    <AuthShell
      headline={<>Set up your<br />ValueSpot account.</>}
      intro="Register with your company email address, then confirm it with the code we send you."
      aside={
        <>
          <p className="vs-kicker" style={{ color: 'var(--color-accent-400)', marginBottom: 14 }}>
            How it works
          </p>
          <ol className="au-steps">
            {SIGNUP_STEPS.map((step, i) => (
              <li key={step.title} className="au-step">
                <span className="au-step-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="au-step-title">{step.title}</p>
                  <p className="au-step-text">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="au-aside-note">
            If HR has already added you, enter your full name exactly as it
            appears on your employee record so the two can be matched.
          </p>
        </>
      }
    >
      <div className="au-head">
        {entry.kicker && <p className="au-kicker">{entry.kicker}</p>}
        <h2 className="au-title">{firstAdmin ? 'Create account' : entry.title}</h2>
        <p className="au-subtitle">{entry.subtitle}</p>
      </div>

      {firstAdmin && (
        <div className="au-note au-note-accent">
          No administrator exists yet, so this account becomes the Super Admin
          and can set everyone else up. After this, you add people from the HR
          portal at the role they should hold.
        </div>
      )}

      <div>
        <form className="au-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {/*
            No role selector, on any of the three entry points. What the
            account becomes is settled before this page ever loads: either HR
            put a record there, or the database writes 'employee'.

            So there are only two things worth saying — what HR assigned, or
            that this is the wrong door.
          */}
          {invitedRole && (
            <div className="au-note">
              You&rsquo;ve been invited to Touchcore ValueSpot as a{' '}
              <strong>{roleLabel(invitedRole)}</strong>. Your account will be
              created with this role.
            </div>
          )}

          {/*
            Shown as soon as the database says there is no invitation, so the
            dead end arrives before a password is chosen rather than after.
            Submitting anyway is refused twice over — once in onSubmit, and
            again by claim_employee_account(), which is passed the required
            role and will not fall back to creating an Employee here.
          */}
          {entry.setupOnly && uninvited && (
            <div role="status" className="au-note au-note-accent">
              This setup link is for people HR has invited as{' '}
              {portal === 'hr_admin' ? 'HR' : 'a Manager'}, and we have no
              invitation for that address.{' '}
              <Link to={ROUTES.SIGNUP}>
                Create an Employee account instead
              </Link>
              , or ask HR to add you.
            </div>
          )}

          <div className="au-field">
            <FieldLabel htmlFor="fullName">Full Name</FieldLabel>
            <IconInput
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Priya Sharma"
              icon={<User size={16} strokeWidth={1.8} />}
              aria-invalid={errors.fullName ? 'true' : undefined}
              aria-describedby={errors.fullName ? 'fullName-error' : undefined}
              {...register('fullName')}
            />
            {errors.fullName && <FieldError id="fullName-error">{errors.fullName.message}</FieldError>}
          </div>

          <div className="au-field">
            <FieldLabel htmlFor="email">Email Address</FieldLabel>
            <IconInput
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@touchcoresystems.com"
              icon={<Mail size={16} strokeWidth={1.8} />}
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? 'email-error' : 'email-hint'}
              {...register('email')}
            />
            {errors.email
              ? <FieldError id="email-error">{errors.email.message}</FieldError>
              : <FieldHint id="email-hint">Your company email. You will sign in with it.</FieldHint>}
          </div>

          {/*
            Hidden entirely when the workspace has no departments yet, rather
            than shown empty and unanswerable. The person creating the first
            account in a new workspace is the one who goes on to create the
            departments, so there is genuinely nothing to ask them.
          */}
          {departments.length > 0 && (
            <div className="au-field">
              <FieldLabel htmlFor="departmentId">Department</FieldLabel>
              <select
                id="departmentId"
                className="vs-input w-full au-input"
                aria-describedby="department-hint"
                {...register('departmentId')}
              >
                <option value="">Select your department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <FieldHint id="department-hint">
                Shown on your profile and used to report recognition by team
              </FieldHint>
            </div>
          )}

          {/*
            Hidden when there is nothing to offer, like the department above.
            For a Manager that is the ordinary case on a well-tended workspace,
            where every project already has a manager — HR assigns them, and
            the form does not pretend otherwise.
          */}
          {projects.length > 0 && (
            <div className="au-field">
              <FieldLabel htmlFor="projectId">
                Project
                <span aria-hidden="true" style={{ color: 'var(--au-danger)', marginLeft: 3 }}>*</span>
              </FieldLabel>
              <select
                id="projectId"
                className="vs-input w-full au-input"
                aria-describedby="project-hint"
                required
                {...register('projectId')}
              >
                <option value="">
                  {forManager ? 'Select the project you manage' : 'Select your project'}
                </option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <FieldHint id="project-hint">
                {forManager
                  ? 'You will approve the recognitions filed against this project. HR can change it later.'
                  : 'The project you currently work on. HR can change it later.'}
              </FieldHint>
            </div>
          )}

          <PasswordField
            id="password"
            label="Password"
            autoComplete="new-password"
            error={errors.password?.message}
            hint="At least 8 characters, including a letter and a number"
            registration={register('password')}
          />
          <PasswordStrength password={password} />

          <PasswordField
            id="confirmPassword"
            label="Confirm password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            registration={register('confirmPassword')}
          />

          {formError && (
            <FormAlert>
              {formError}
              {accountExists && (
                <>
                  {' '}
                  <Link to={entry.loginPath}>Go to sign in</Link>
                </>
              )}
            </FormAlert>
          )}

          <button
            type="submit"
            className="au-btn"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>

      <div className="au-links">
        <p>
          Already have an account?{' '}
          <Link to={entry.loginPath} className="au-link">Sign in</Link>
        </p>
      </div>

      <p className="au-foot">Touchcore ValueSpot &middot; Employee Recognition Platform</p>
    </AuthShell>
  )
}
