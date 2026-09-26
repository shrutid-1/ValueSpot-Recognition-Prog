import { Link } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { RoleHoldersCard } from '@/components/hr/RoleHoldersCard'
import { SignupDomainsCard } from '@/components/hr/SignupDomainsCard'
import { SecurityActivityCard } from '@/components/hr/SecurityActivityCard'

/**
 * The Super Admin area of the HR portal.
 *
 * Not a separate portal, dashboard or login — the same HR section, with one
 * extra page an HR Admin cannot reach. What lives here is everything that
 * decides *who can administer the system*, as opposed to how HR runs day to
 * day. Ordinary HR configuration stays in Settings.
 *
 * The route is gated at requiredRole={['super_admin']}, but that is only
 * navigation. Each card's actions call database functions that re-check the
 * caller's role, so typing the URL, editing the bundle, or calling the API by
 * hand all reach the same refusal.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2
        className="vs-kicker"
        style={{ marginBottom: 4, color: 'var(--color-neutral-600)' }}
      >
        {title}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginBottom: 12, lineHeight: 1.6 }}>
        {description}
      </p>
      {children}
    </section>
  )
}

export default function AdministrationPage() {
  return (
    <div
      className="animate-fade-in"
      style={{ maxWidth: 900, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}
    >
      <PageHeader
        title="Administration"
        subtitle="Control who can administer ValueSpot. Only Super Admins can see this page."
      />

      <Section
        title="Administrators"
        description="People with complete control of the system, including the ability to appoint and remove other administrators."
      >
        <RoleHoldersCard
          role="super_admin"
          title="Super Admins"
          intro="Super Admins can do everything HR can do, plus manage administrators and sign-up policy. Everyone here signs in normally through the HR portal."
          addLabel="Add Super Admin"
          demoteTo="hr_admin"
          protectLast
        />
      </Section>

      <Section
        title="Access & roles"
        description="Who runs HR. This page promotes people who already have an account; someone new is invited from Employees, at the role they should hold."
      >
        {/*
          Pointer, not a second invitation flow. A Super Admin already has the
          same Employees page an HR Admin does — same route guard, same RLS,
          same trigger, same invitation dialog — but nothing here said so, and
          the cards below only list people who have already registered.
        */}
        <p
          style={{
            fontSize: 13, lineHeight: 1.6, color: 'var(--color-neutral-600)',
            marginBottom: 12, padding: '10px 12px',
            border: '1px solid var(--color-divider)',
            background: 'var(--color-surface-2, var(--color-bg))',
          }}
        >
          Inviting someone who has no account yet?{' '}
          <Link
            to={ROUTES.EMPLOYEES}
            style={{ color: 'var(--color-accent-700)', fontWeight: 600, textDecoration: 'none' }}
          >
            Employees &rarr; Add employee
          </Link>
          {' '}— choose Employee, Manager or HR and send them the invitation link.
          Super Admin is granted here instead, to someone who has already signed in.
        </p>

        <RoleHoldersCard
          role="hr_admin"
          title="HR Admins"
          intro="HR Admins run everything in HR — employees, recognitions, reports and HR settings — and can promote people to Manager. They cannot manage administrators or change who may sign up."
          addLabel="Add HR Admin"
          demoteTo="employee"
        />
      </Section>

      <Section
        title="System configuration"
        description="Settings that affect the whole system rather than one team. Everyday HR configuration stays in Settings."
      >
        <SignupDomainsCard />
      </Section>

      <Section
        title="Security activity"
        description="A permanent record of every change to administrative access."
      >
        <SecurityActivityCard />
      </Section>
    </div>
  )
}
