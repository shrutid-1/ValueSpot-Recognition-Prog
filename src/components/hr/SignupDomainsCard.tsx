import { useEffect, useState } from 'react'
import { X, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useSignupDomains, useSetSignupDomains } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/shared/SkeletonLoader'

/**
 * Controls which email domains may create their own account.
 *
 * This is the single switch that decides whether the public internet can
 * register. An empty list means anyone can, which is the right default for a
 * private deployment and the wrong one for a public URL — so the card says
 * which state it is in rather than leaving it to be inferred.
 *
 * Employees HR has already added are never affected: an explicit record is a
 * stronger signal than a domain match.
 */
export function SignupDomainsCard() {
  /*
    This card EDITS a list before saving it, so the server value and the value
    on screen are genuinely different things. The query owns the former; local
    state owns the latter.

    Seeding only while not dirty is what keeps that honest: a background
    refetch must never overwrite edits somebody is part-way through typing.
  */
  const query = useSignupDomains()
  const saveMutation = useSetSignupDomains()

  const [domains, setDomains] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Nothing is written until Save, so the buttons must reflect local edits.
  const [dirty, setDirty] = useState(false)

  const loading = query.isPending
  const saving = saveMutation.isPending

  const serverDomains = query.data
  useEffect(() => {
    if (serverDomains && !dirty) setDomains(serverDomains)
  }, [serverDomains, dirty])

  const loadError = query.error
    ? errorMessage(query.error, 'Could not load the domain list.')
    : null

  const addDraft = () => {
    // Accept what people actually paste: "@touchcoresystems.com", "touchcoresystems.com",
    // "https://touchcoresystems.com". The database normalises again on save.
    const value = draft.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '')
    if (!value) return
    if (domains.includes(value)) {
      setDraft('')
      return
    }
    setDomains(prev => [...prev, value])
    setDraft('')
    setDirty(true)
    setSaved(false)
  }

  const remove = (domain: string) => {
    setDomains(prev => prev.filter(d => d !== domain))
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setError(null)

    // The mutation maps every refusal the function returns, including
    // invalid_domain, which names the offending entry.
    try {
      await saveMutation.mutateAsync(domains)
    } catch (err) {
      setError(errorMessage(err, 'Could not save. Please try again.'))
      return
    }

    // Clearing dirty lets the refetched server value take over again.
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const unrestricted = domains.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can register</CardTitle>
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginTop: 6 }}>
          Restricts self-registration to these email domains. Employees HR has
          already added are unaffected.
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {/* State of the world, stated plainly. */}
            <div
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                padding: 12, marginBottom: 16,
                border: `1px solid ${unrestricted ? 'var(--color-accent-400)' : 'var(--color-divider)'}`,
                background: unrestricted
                  ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))'
                  : 'transparent',
                fontSize: 13, lineHeight: 1.55,
              }}
            >
              {unrestricted
                ? <ShieldAlert size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-accent-800)' }} />
                : <ShieldCheck size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-accent-700)' }} />}
              <span style={{ color: unrestricted ? 'var(--color-accent-800)' : 'var(--color-neutral-600)' }}>
                {unrestricted
                  ? 'The list is empty, so any email address on the internet can create an Employee account. Add your company domain if this app is reachable publicly.'
                  : `Only addresses at ${domains.length === 1 ? 'this domain' : 'these domains'} can create an account on their own.`}
              </span>
            </div>

            {domains.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {domains.map(domain => (
                  <span
                    key={domain}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px 5px 10px',
                      border: '1px solid var(--color-divider)',
                      background: 'var(--color-surface)',
                      fontSize: 13,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {domain}
                    <button
                      type="button"
                      onClick={() => remove(domain)}
                      aria-label={`Remove ${domain}`}
                      style={{
                        display: 'inline-flex', padding: 2, cursor: 'pointer',
                        background: 'none', border: 'none',
                        color: 'var(--color-neutral-600)',
                      }}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addDraft() }
                }}
                placeholder="touchcoresystems.com"
                aria-label="Domain to allow"
                style={{ flex: 1, minWidth: 200, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
              <Button variant="outline" onClick={addDraft} disabled={!draft.trim()}>
                Add
              </Button>
              <Button onClick={save} loading={saving} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            {(error ?? loadError) && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)', marginTop: 12 }}>
                {error ?? loadError}
              </p>
            )}
            {saved && (
              <p role="status" style={{ fontSize: 13, color: 'var(--color-accent-700)', marginTop: 12 }}>
                Saved. New registrations follow this list immediately.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
