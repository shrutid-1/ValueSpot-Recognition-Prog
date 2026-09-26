import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string | null
  label: string
  /** A colour dot beside the label — used by the Core Value filter. */
  tone?: string
}

interface SelectPillProps {
  /** The word before the colon: "View", "Value". */
  label: string
  options: SelectOption[]
  value: string | null
  onChange: (value: string | null) => void
}

/**
 * A filter, as a pill with a chevron.
 *
 * The reference design's header carries three of these. Here they are real
 * controls over data that is already on the page: choosing one re-presents
 * the record and the matrix, and fetches nothing. That constraint is what
 * makes them instant and what keeps them honest — a filter that cannot
 * return rows the page does not have cannot promise data it does not have.
 *
 * Deliberately not a native <select>: it has to carry a colour dot per Core
 * Value, and a styled native select is the one control that never matches
 * the rest of a design system. The keyboard and screen-reader contract is
 * rebuilt properly — listbox semantics, Escape to dismiss, focus returned to
 * the trigger, outside-click to close.
 */
export function SelectPill({ label, options, value, onChange }: SelectPillProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selected = options.find(o => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return

    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="vsx-select"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selected?.label ?? ''}. Change filter.`}
      >
        <span className="vsx-select-label">{label}:</span>
        {selected?.tone && (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: selected.tone,
              flexShrink: 0,
            }}
          />
        )}
        <span>{selected?.label}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          strokeWidth={2}
          style={{
            color: 'var(--vsx-text-3)',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform var(--vsx-t) var(--vsx-ease)',
          }}
        />
      </button>

      {open && (
        <div className="vsx-select-menu vsx-sheet-in" role="listbox" aria-label={label}>
          {options.map(option => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value ?? '__all__'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="vsx-select-option"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                {option.tone ? (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 999,
                      background: option.tone,
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <span aria-hidden="true" style={{ width: 9, flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>{option.label}</span>
                {isSelected && <Check size={14} aria-hidden="true" strokeWidth={2.4} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
