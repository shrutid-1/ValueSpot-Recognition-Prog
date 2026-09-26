import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { FolderKanban } from 'lucide-react'

const schema = z.object({
  whatHappened: z.string()
    .min(20, 'Please describe what happened (at least 20 characters)')
    .max(1000, 'Please keep this under 1000 characters'),
  whatImpact: z.string()
    .min(20, 'Please describe the impact (at least 20 characters)')
    .max(1000, 'Please keep this under 1000 characters'),
})

type Form = z.infer<typeof schema>

interface Step5StoryProps {
  whatHappened: string
  whatImpact: string
  /** Settled in step 1 from the nominee's active project. Display only. */
  projectName: string | null
  onUpdate: (fields: { whatHappened?: string; whatImpact?: string }) => void
  onNext: () => void
}

export function Step5Story({ whatHappened, whatImpact, projectName, onUpdate, onNext }: Step5StoryProps) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      whatHappened,
      whatImpact,
    },
  })

  const happenedLen = watch('whatHappened')?.length ?? 0
  const impactLen   = watch('whatImpact')?.length ?? 0

  const onSubmit = (data: Form) => {
    onUpdate({
      whatHappened: data.whatHappened,
      whatImpact:   data.whatImpact,
    })
    onNext()
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Tell the recognition story</h2>
        <p className="text-sm text-text-muted mt-1">
          Specific examples make recognition meaningful. Describe what happened and why it mattered.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>

        {/* What happened */}
        <div className="space-y-1.5">
          <label htmlFor="whatHappened" className="text-sm font-medium text-text-primary">
            What happened?{' '}
            <span className="text-danger" aria-hidden="true">*</span>
          </label>
          <Textarea
            id="whatHappened"
            placeholder="Describe the specific action or behaviour you observed. For example: 'Amit stayed back on Thursday to help debug the API integration issue that was blocking the client launch…'"
            className="min-h-[120px]"
            error={errors.whatHappened?.message}
            {...register('whatHappened')}
          />
          <p className="text-xs text-text-disabled text-right tabular-nums" aria-live="polite">
            {happenedLen}/1000
          </p>
        </div>

        {/* Impact */}
        <div className="space-y-1.5">
          <label htmlFor="whatImpact" className="text-sm font-medium text-text-primary">
            What was the impact?{' '}
            <span className="text-danger" aria-hidden="true">*</span>
          </label>
          <Textarea
            id="whatImpact"
            placeholder="Describe the outcome or difference this made. For example: 'Because of this, we delivered on time and the client rated the integration experience as excellent…'"
            className="min-h-[100px]"
            error={errors.whatImpact?.message}
            {...register('whatImpact')}
          />
          <p className="text-xs text-text-disabled text-right tabular-nums" aria-live="polite">
            {impactLen}/1000
          </p>
        </div>

        {/*
          The project is shown, not chosen.

          It was a free dropdown of every project in the company. Since 029 the
          project decides who approves the recognition, so choosing it freely
          would mean choosing your own approver — and the database now refuses
          any project that is not the nominee's own. It is settled in step 1
          and displayed here so the writer can see what they are filing against.
        */}
        {projectName && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-text-primary">Project</p>
            <div
              className="flex items-center gap-2 px-3 h-10 rounded-lg"
              style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface-secondary)' }}
            >
              <FolderKanban size={14} className="text-text-muted shrink-0" aria-hidden="true" />
              <span className="text-sm text-text-primary truncate">{projectName}</span>
            </div>
          </div>
        )}

        <Button type="submit" className="w-full" size="lg">
          Preview Recognition
        </Button>
      </form>
    </div>
  )
}
