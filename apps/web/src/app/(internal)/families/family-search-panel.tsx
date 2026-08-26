import { Alert, ChoiceOption, Field, FormActions, Panel, SubmitButton } from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { FamilyList } from './family-list';
import type { FamilySearchState } from './search-state';

/**
 * The whole search surface — the fields and the results — as one server-rendered
 * tree.
 *
 * Deliberately renders no `<form>` element of its own. The element belongs to
 * `FamilySearch`, the Client Component that owns `useActionState` and re-renders
 * this panel from whatever the action returned.
 *
 * Because that client component renders it, this module and `FamilyList` are
 * bundled for the browser, and `COPY` travels with them. That is UI text and
 * nothing else — no secret can follow it, because every module that holds one
 * declares `server-only` and would fail the build if it were reachable from
 * here.
 *
 * `defaultValue` rather than `value`: the inputs are uncontrolled, so the term
 * a receptionist typed survives the submission in both directions — the
 * JavaScript path never remounts them, and the JavaScript-disabled path gets a
 * fresh server render carrying `q` back.
 */
export function FamilySearchPanel({
  q,
  includeInactive,
  families,
  truncated,
  searched,
  errorMessage,
}: FamilySearchState) {
  return (
    <>
      <Panel>
        <Field id="q" label={COPY.familySearchLabel} help={COPY.familySearchHelp}>
          {({ id, className, describedBy }) => (
            <input
              id={id}
              name="q"
              type="search"
              maxLength={60}
              defaultValue={q}
              aria-describedby={describedBy}
              className={className}
            />
          )}
        </Field>

        <ChoiceOption
          id="includeInactive"
          name="includeInactive"
          value="true"
          type="checkbox"
          label={COPY.familySearchIncludeInactiveLabel}
          defaultChecked={includeInactive}
        />

        <FormActions>
          <SubmitButton>{COPY.familySearchButton}</SubmitButton>
        </FormActions>
      </Panel>

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <FamilyList families={families} truncated={truncated} searched={searched} />
    </>
  );
}
