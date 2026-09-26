import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { recognitionsApi, employeesApi, ApiError } from '@/lib/api'
import { contentIdempotencyKey, classifyRecognitionSource } from '@/lib/utils'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { Step1Employee } from '@/components/recognition/steps/Step1Employee'
import { Step2Project } from '@/components/recognition/steps/Step2Project'
import { Step2CoreValue } from '@/components/recognition/steps/Step2CoreValue'
import { Step3Behaviour } from '@/components/recognition/steps/Step3Behaviour'
import { Step4Scenario } from '@/components/recognition/steps/Step4Scenario'
import { Step5Story } from '@/components/recognition/steps/Step5Story'
import { Step6Preview } from '@/components/recognition/steps/Step6Preview'
import type { Employee, CoreValue, Behaviour, Scenario } from '@/types'
import { cn } from '@/lib/utils'

export interface WizardData {
  nominee: Employee | null
  coreValue: CoreValue | null
  behaviour: Behaviour | null
  scenario: Scenario | null
  whatHappened: string
  whatImpact: string
  projectId: string | null
  projectName: string | null
  /** The chosen project's manager — who will approve. Display/classification only. */
  projectManagerId: string | null
}

const STEP_LABELS = [
  'Who',
  'Project',
  'Core Value',
  'Behaviour',
  'Scenario',
  'Story',
  'Preview',
]

/*
  The approver-selection comment that stood here described a management-chain
  walk. That walk is gone: since migrations 029/030 the approver is the manager
  of the PROJECT the recognizer selects, derived by the database on insert.
*/

const EMPTY_WIZARD: WizardData = {
  nominee: null,
  coreValue: null,
  behaviour: null,
  scenario: null,
  whatHappened: '',
  whatImpact: '',
  projectId: null,
  projectName: null,
  projectManagerId: null,
}

export default function GiveRecognitionPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(EMPTY_WIZARD)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [assignedApproverName, setAssignedApproverName] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  const goNext = () => setStep(s => Math.min(s + 1, 7))
  const goBack = () => setStep(s => Math.max(s - 1, 1))

  // REQ-010-04: warn (never block) if this colleague was recently recognised
  // for the same Core Value. Checked on reaching the preview so the wizard is
  // not slowed down mid-flow.
  useEffect(() => {
    if (step !== 7 || !employee || !data.nominee || !data.coreValue) return

    let cancelled = false
    const nomineeId = data.nominee.id
    const coreValueId = data.coreValue.id

    void recognitionsApi
      .checkDuplicate({
        nominatorId: employee.id,
        nomineeId,
        coreValueId,
      })
      .then(result => {
        if (cancelled) return
        // Advisory: the API layer already reports an unavailable check as
        // "no duplicate", so nothing here can interrupt the wizard.
        setDuplicateWarning(result.isDuplicate ? result.message : null)
      })

    return () => { cancelled = true }
  }, [step, employee, data.nominee, data.coreValue])

  const update = (partial: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...partial }))
  }

  const handleSubmit = async () => {
    if (!employee || !data.nominee || !data.coreValue) return
    if (submitting) return   // guard against a second click landing mid-flight
    setSubmitting(true)
    setSubmitError(null)

    try {
      // Derived from the submission's content, so a double-click or a refresh
      // and re-submit collide on the same key instead of creating duplicates.
      const idempotencyKey = await contentIdempotencyKey([
        employee.id,
        data.nominee.id,
        data.coreValue.id,
        data.behaviour?.id ?? null,
        data.scenario?.id ?? null,
        data.whatHappened.trim(),
        data.whatImpact.trim(),
      ])

      // Pre-flight rate limit check. This exists to give a friendly message
      // before the user submits — it is NOT the enforcement point. The
      // enforce_nomination_rate_limits trigger (migration 007) is, and it
      // cannot be skipped by calling PostgREST directly.
      const rate = await recognitionsApi.checkRateLimit(employee.id)
      if (!rate.allowed) {
        setSubmitError(
          rate.message ??
          "You've reached your recognition limit. Please try again later."
        )
        setSubmitting(false)
        return
      }

      const nominee = data.nominee

      /*
        The approver is NOT decided here.

        This used to walk the nominee's management chain in the browser and
        submit the result as assigned_approver_id — which meant a modified
        client could name any approver it liked. Since migration 029 the
        database resolves it from the selected project's manager on INSERT and
        overwrites whatever arrives. We read the answer back afterwards, purely
        to name them in the confirmation.
      */
      if (!data.projectId) {
        setSubmitError(
          'This recognition needs a project before it can be submitted.'
        )
        setSubmitting(false)
        return
      }

      // Fetch department names for historical snapshots
      let nominatorDeptName: string | null = null
      let nomineeDeptName: string | null = null

      if (employee.department_id) {
        nominatorDeptName = await employeesApi.getDepartmentName(employee.department_id)
      }

      if (nominee.department_id) {
        nomineeDeptName = await employeesApi.getDepartmentName(nominee.department_id)
      }

      /*
        Classify the source. 'manager' now means "the recognizer manages the
        project this was filed against" — the nominee's line manager no longer
        exists as a relationship (migration 030), so it cannot be the test.
      */
      const source = classifyRecognitionSource(
        employee.role,
        nominee.role,
        employee.id,
        data.projectManagerId,
      )

      // Snapshots are written once and never updated, so a recognition still
      // reads correctly after a rename or a department change. The idempotency
      // key makes a double submit land as 'duplicate' rather than a second row.
      const result = await recognitionsApi.submit({
        nominatorId: employee.id,
        nomineeId: nominee.id,
        coreValueId: data.coreValue.id,
        behaviourId: data.behaviour?.id ?? null,
        scenarioId: data.scenario?.id ?? null,
        projectId: data.projectId,
        whatHappened: data.whatHappened,
        whatImpact: data.whatImpact,
        snapshot: {
          coreValueName: data.coreValue.name,
          behaviourName: data.behaviour?.name ?? null,
          scenarioName: data.scenario?.name ?? null,
          projectName: data.projectName,
          nominatorDept: nominatorDeptName,
          nomineeDept: nomineeDeptName,
          /*
            Historical only. The employee-level manager relationship is retired
            (030); this snapshot column still records what it was for rows that
            predate the change, and is left null for new ones.
          */
          nomineeManagerId: null,
        },
        recognitionSource: source,
        idempotencyKey,
      })

      // 'duplicate' means this exact submission already landed — show the
      // confirmation, not an error.
      void result

      /*
        Ask the database who it routed this to. Advisory: a null just means the
        confirmation says "your manager" instead of a name, and never blocks a
        submission that has already succeeded.
      */
      setAssignedApproverName(await recognitionsApi.getRoutedApprover(idempotencyKey))

      setSubmitted(true)
    } catch (err) {
      /*
        The database refused the submission, and said why in a sentence written
        for the person reading it — "Employees can only recognize other
        employees.", which limit was hit, or why the project cannot route.
        Those guards are the real enforcement points, so their wording is shown
        rather than replaced with the generic message below. Nothing reaching
        here created a recognition: the whole INSERT failed.
      */
      if (err instanceof ApiError && err.code === 'refused') {
        setSubmitError(err.message)
        return
      }
      setSubmitError(
        'Something went wrong while submitting the recognition. Your recognition has not been submitted. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    /*
      The confirmation used to sit in a rounded panel with a green disc behind
      a tick that `text-success` renders steel blue — so the one moment that
      should feel most like the product looked least like it. Blueprint frame,
      registration marks, accent tint. No celebration beyond the mark being
      drawn: this recognition is submitted, not yet approved, and overstating
      that would be its own kind of wrong.
    */
    return (
      <div className="animate-fade-in" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 40 }}>
        <div
          className="vs-card relative text-center"
          style={{ padding: 32, overflow: 'visible' }}
          role="status"
          aria-live="polite"
        >
          <i className="corner tl" /><i className="corner tr" />
          <i className="corner bl" /><i className="corner br" />

          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--color-accent-400)',
              background: 'var(--accent-emphasis)',
              color: 'var(--color-accent-800)',
            }}
          >
            <CheckCircle size={28} />
          </div>

          <p className="vs-kicker" style={{ marginBottom: 6 }}>Submitted</p>
          <h2
            className="font-condensed"
            style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}
          >
            Recognition submitted
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-neutral-700)',
              lineHeight: 1.55,
              maxWidth: 320,
              margin: '0 auto',
            }}
          >
            {assignedApproverName
              ? `Sent to ${assignedApproverName} for validation. You'll be notified once it's approved.`
              : 'Sent for validation. You’ll be notified once it’s approved.'}
          </p>

          <div className="flex flex-wrap gap-2 justify-center" style={{ marginTop: 24 }}>
            <button className="vs-btn" onClick={() => navigate(ROUTES.RECOGNITION_FEED)}>
              View Feed
            </button>
            <button
              className="vs-btn vs-btn-primary relative"
              onClick={() => {
                setSubmitted(false)
                setStep(1)
                setData(EMPTY_WIZARD)
                setAssignedApproverName(null)
              }}
            >
              <i className="corner tl" /><i className="corner tr" />
              <i className="corner bl" /><i className="corner br" />
              Recognize Someone Else
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Back + title */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Go back"
        >
          <ArrowLeft size={17} />
        </button>
        <PageHeader title="Give Recognition" className="mb-0 flex-1" />
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-1 mb-6" role="list" aria-label="Recognition wizard steps">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1
          const isActive = step === num
          const isDone = step > num
          return (
            <React.Fragment key={num}>
              <div
                className="flex flex-col items-center gap-1"
                role="listitem"
                aria-current={isActive ? 'step' : undefined}
              >
                <div className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200',
                  isDone && 'bg-blue-600 text-white shadow-sm',
                  isActive && 'bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm',
                  !isDone && !isActive && 'bg-surface-secondary text-text-muted border border-border',
                )}>
                  {isDone ? <CheckCircle size={13} aria-hidden="true" /> : num}
                </div>
                <span className={cn(
                  'text-[10px] hidden sm:block font-medium tracking-wide',
                  isActive ? 'text-blue-600' : 'text-text-disabled'
                )}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={cn('flex-1 h-px mt-[-14px] transition-colors duration-300', step > i + 1 ? 'bg-blue-600' : 'bg-border')}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step content */}
      <div className="bg-surface border border-border rounded-xl shadow-sm">
        {step === 1 && (
          <Step1Employee
            selected={data.nominee}
            onSelect={(emp) => { update({ nominee: emp }); goNext() }}
            currentUserId={employee?.id}
            /* Wording only — the candidate list is scoped in the database. */
            nominatorRole={employee?.role}
          />
        )}
        {step === 2 && (
          /*
            A mandatory, explicit choice. The project is NOT inferred from the
            nominee: the recognizer saw the work and knows which project it
            belonged to, and that is frequently not where the nominee is
            nominally assigned. The choice settles the approver, but only by
            deciding the project — the database re-derives the approver from it.
          */
          <Step2Project
            selectedId={data.projectId}
            onSelect={(project) => {
              update({
                projectId: project.project_id,
                projectName: project.project_name,
                projectManagerId: project.manager_id,
              })
              goNext()
            }}
          />
        )}
        {step === 3 && (
          <Step2CoreValue
            selected={data.coreValue}
            onSelect={(cv) => {
              update({ coreValue: cv, behaviour: null, scenario: null })
              goNext()
            }}
          />
        )}
        {step === 4 && (
          <Step3Behaviour
            coreValueId={data.coreValue?.id ?? ''}
            selected={data.behaviour}
            onSelect={(b) => { update({ behaviour: b, scenario: null }); goNext() }}
          />
        )}
        {step === 5 && (
          <Step4Scenario
            behaviourId={data.behaviour?.id ?? ''}
            coreValueId={data.coreValue?.id ?? ''}
            selected={data.scenario}
            onSelect={(s) => { update({ scenario: s }); goNext() }}
          />
        )}
        {step === 6 && (
          <Step5Story
            whatHappened={data.whatHappened}
            whatImpact={data.whatImpact}
            projectName={data.projectName}
            onUpdate={(fields) => update(fields)}
            onNext={goNext}
          />
        )}
        {step === 7 && (
          <Step6Preview
            data={data}
            submitting={submitting}
            error={submitError}
            duplicateWarning={duplicateWarning}
            onSubmit={handleSubmit}
          />
        )}

        {/* Navigation */}
        {step > 1 && step < 6 && (
          <div className="px-6 pb-6">
            <button
              onClick={goBack}
              className="text-sm text-text-muted hover:text-text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              ← Back
            </button>
          </div>
        )}
        {step === 7 && (
          <div className="px-6 pb-6">
            <button onClick={goBack} className="text-sm text-text-muted hover:text-text-primary underline underline-offset-2">
              ← Back to story
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
