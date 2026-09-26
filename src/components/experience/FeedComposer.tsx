import { Plus } from 'lucide-react'
import { Avatar } from './Avatar'

interface FeedComposerProps {
  name: string
  avatarUrl?: string | null
  onStart: () => void
}

/**
 * The head of the feed: the way in.
 *
 * The reference this follows opens with a composer — a field you type into.
 * That is not honest here. A recognition is not a status update: it needs a
 * colleague, a Core Value, a behaviour, a scenario, an account of what
 * happened and its impact, and it goes to an approver. A caret and a Post
 * button would promise something the product does not do, and would throw
 * away whatever was typed into it.
 *
 * So the field is a BUTTON shaped like a field. It reads as the start of
 * something, because it is: it opens the flow that can actually record one.
 * There is one action here and it works.
 */
export function FeedComposer({ name, avatarUrl, onStart }: FeedComposerProps) {
  return (
    <section className="vsx-panel" style={{ padding: 16 }} aria-labelledby="vsx-composer">
      <h2 id="vsx-composer" className="sr-only">Recognize a colleague</h2>

      <div className="flex items-center" style={{ gap: 12 }}>
        <Avatar name={name || '?'} avatarUrl={avatarUrl} size="md" />

        <button type="button" className="vsx-composer-field" onClick={onStart}>
          Share what a colleague did well&hellip;
        </button>

        {/*
          The label drops below 1180px so the field keeps a usable width on a
          phone. The accessible name does not depend on it — the button is
          labelled either way, so it never becomes an unexplained "+".
        */}
        <button
          type="button"
          className="vsx-btn vsx-btn-primary"
          style={{ height: 48, flexShrink: 0 }}
          onClick={onStart}
          aria-label="Recognize someone"
        >
          <Plus size={17} aria-hidden="true" strokeWidth={2.4} />
          <span className="vsx-wide" aria-hidden="true">Recognize someone</span>
        </button>
      </div>
    </section>
  )
}
