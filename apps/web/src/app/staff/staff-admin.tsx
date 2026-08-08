import type { StaffUser } from '@clinic/contracts';
import {
  Alert,
  Badge,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';

/**
 * Manager-only staff administration, as a pure presentational component.
 *
 * Every action is an ordinary form post to an explicit Route Handler, so the
 * surface works without JavaScript and every state change carries the CSRF pair
 * and passes the Origin check.
 *
 * Temporary passwords never appear here. Creating a user and resetting a
 * password return their one-time value in the body of the POST response, so it
 * never enters a URL, browser history, storage or any analytics.
 */
function ActionForm({
  action,
  csrfToken,
  fields,
  label,
  tone = 'secondary',
}: {
  action: string;
  csrfToken: string;
  fields: Record<string, string>;
  label: string;
  tone?: 'secondary' | 'danger';
}) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton tone={tone}>{label}</SubmitButton>
    </form>
  );
}

export function StaffAdmin({
  users,
  csrfToken,
  errorMessage,
  currentUserId,
}: {
  users: readonly StaffUser[];
  csrfToken: string;
  errorMessage: string | null;
  currentUserId: string;
}) {
  return (
    <PageShell>
      <PageHeader title={COPY.staffTitle} />

      {errorMessage === null ? null : <Alert>{errorMessage}</Alert>}

      <Panel title={COPY.staffCreateTitle}>
        <form method="post" action="/api/staff/create" className="flex flex-col gap-4">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="new-username" label={COPY.username} required>
              {(props) => (
                <input
                  {...props}
                  name="username"
                  type="text"
                  required
                  dir="ltr"
                  className={`${props.className} text-start`}
                />
              )}
            </Field>
            <Field id="new-display-name" label={COPY.displayName} required>
              {(props) => <input {...props} name="displayName" type="text" required />}
            </Field>
            <Field id="new-role" label={COPY.role} required>
              {(props) => (
                <select {...props} name="role" defaultValue="RECEPTIONIST">
                  <option value="RECEPTIONIST">{COPY.roleReceptionist}</option>
                  <option value="MANAGER">{COPY.roleManager}</option>
                </select>
              )}
            </Field>
          </div>
          <FormActions>
            <SubmitButton>{COPY.create}</SubmitButton>
          </FormActions>
        </form>
      </Panel>

      <RecordList>
        {users.map((user) => {
          const isSelf = user.id === currentUserId;
          const isActive = user.status === 'ACTIVE';

          return (
            <RecordItem
              key={user.id}
              title={user.displayName}
              badge={
                <>
                  <StatusBadge
                    active={isActive}
                    labels={[COPY.statusActive, COPY.statusDisabled]}
                  />
                  <Badge tone="info">
                    {user.role === 'MANAGER' ? COPY.roleManager : COPY.roleReceptionist}
                  </Badge>
                </>
              }
              details={
                <>
                  <span dir="ltr" className="text-start">
                    {user.username}
                  </span>
                  <span>
                    {COPY.lockedUntil}: <span dir="ltr">{user.lockedUntil ?? COPY.never}</span>
                  </span>
                </>
              }
              actions={
                <>
                  {/* Self-changes are refused by NestJS; hiding them here just
                      avoids offering an action that cannot succeed. */}
                  {isSelf ? null : (
                    <>
                      <ActionForm
                        action="/api/staff/role"
                        csrfToken={csrfToken}
                        fields={{
                          id: user.id,
                          role: user.role === 'MANAGER' ? 'RECEPTIONIST' : 'MANAGER',
                        }}
                        label={user.role === 'MANAGER' ? COPY.makeReceptionist : COPY.makeManager}
                      />
                      <ActionForm
                        action="/api/staff/status"
                        csrfToken={csrfToken}
                        fields={{
                          id: user.id,
                          status: isActive ? 'DISABLED' : 'ACTIVE',
                        }}
                        label={isActive ? COPY.disable : COPY.enable}
                        tone={isActive ? 'danger' : 'secondary'}
                      />
                    </>
                  )}
                  <ActionForm
                    action="/api/staff/password-reset"
                    csrfToken={csrfToken}
                    fields={{ id: user.id, username: user.username }}
                    label={COPY.resetPassword}
                  />
                  <ActionForm
                    action="/api/staff/unlock"
                    csrfToken={csrfToken}
                    fields={{ id: user.id }}
                    label={COPY.unlock}
                  />
                  <ActionForm
                    action="/api/staff/revoke-sessions"
                    csrfToken={csrfToken}
                    fields={{ id: user.id }}
                    label={COPY.revokeSessions}
                  />
                </>
              }
            />
          );
        })}
      </RecordList>
    </PageShell>
  );
}
