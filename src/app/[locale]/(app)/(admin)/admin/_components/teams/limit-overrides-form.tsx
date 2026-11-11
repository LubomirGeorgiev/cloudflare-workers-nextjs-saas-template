"use client"

import { valibotResolver } from "@hookform/resolvers/valibot"
import { useForm, useFormContext } from "react-hook-form"
import { useAction } from "next-safe-action/hooks"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import type { TeamLimitOverrides } from "@/constants/limit-overrides"
import type { TeamPlanLimits } from "@/constants/plans"
import {
  LIMIT_OVERRIDE_NUMBER_KEYS,
  limitOverrideFormBounds,
  limitOverridesToForm,
  setTeamLimitOverridesSchema,
  type SetTeamLimitOverridesInput,
} from "@/schemas/limit-overrides.schema"
import { setTeamLimitOverridesAction } from "../../_actions/team-limit-override-actions"
import { ReasonField, reasonFormCallbacks } from "./reason-field"

/**
 * One row for each plan limit: the plan value with add-ons, staff's override, and the value the
 * team gets. An empty override keeps the plan value. One save with one reason for the card.
 * While suspended, "Team gets" is the saved server value: a typed override does not apply yet.
 */
export function LimitOverridesForm({
  teamId,
  planLimits,
  overrides,
  appliedOverrides,
  limits,
  isSuspended,
  hideFromCustomer,
}: {
  teamId: string
  planLimits: TeamPlanLimits
  overrides: TeamLimitOverrides
  /** The stored overrides in effect now, from getTeamEntitlements. */
  appliedOverrides: TeamLimitOverrides
  /** What the team gets now, from getTeamEntitlements. */
  limits: TeamPlanLimits
  /** True: a paid plan with no paid access, so only `appliedOverrides` apply. */
  isSuspended: boolean
  hideFromCustomer: boolean
}) {
  const defaultValues: SetTeamLimitOverridesInput = {
    teamId,
    ...limitOverridesToForm(overrides),
    hideFromCustomer,
    reason: "",
  }
  const form = useForm<SetTeamLimitOverridesInput>({
    resolver: valibotResolver(setTeamLimitOverridesSchema),
    defaultValues,
  })
  // The plan values in the units of the form.
  const plan = limitOverridesToForm(planLimits)
  const suspended = isSuspended ? { effective: limitOverridesToForm(limits), overrides, appliedOverrides } : null

  const { execute, isExecuting } = useAction(
    setTeamLimitOverridesAction,
    reasonFormCallbacks({ form, successMessage: "Limit overrides saved.", errorMessage: "Could not save the limit overrides." }),
  )

  const clearAll = () => {
    for (const key of LIMIT_OVERRIDE_NUMBER_KEYS) {
      form.setValue(key, "", { shouldDirty: true, shouldValidate: true })
    }
    form.setValue("hideFromCustomer", false, { shouldDirty: true })
  }

  return (
    <Form {...form}>
      <form method="post" onSubmit={form.handleSubmit((submitted) => execute(submitted))} className="space-y-4">
        <div>
          <div className={`hidden border-b pb-2 text-xs font-medium text-muted-foreground md:grid ${COLUMNS_CLASS}`}>
            <span>Limit</span>
            <span>Plan with add-ons</span>
            <span>Override (empty = plan value)</span>
            <span>{suspended ? "Team gets now" : "Team gets"}</span>
          </div>

          {LIMIT_OVERRIDE_NUMBER_KEYS.map((key) => (
            <NumberLimitRow
              key={key}
              limitKey={key}
              planValue={plan[key]}
              suspendedValue={suspended?.effective[key]}
              suspendedNote={suspendedNote({ limitKey: key, suspended })}
            />
          ))}
        </div>

        <FormField
          control={form.control}
          name="hideFromCustomer"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(Boolean(checked))} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Hide from the customer</FormLabel>
                <FormDescription>
                  The customer billing page shows no &quot;Custom limits&quot; card, so nothing tells the
                  customer that staff set these limits. The limits still apply: the limit errors keep
                  the effective values. It is not saved with no override.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <ReasonField
          placeholder="Deal 1234: 25 seats, signed 2026-11-10"
          description="Written to the audit log with the change. Nothing changes until you save."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={isExecuting}>
            {isExecuting ? "Saving..." : "Save overrides"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isExecuting} onClick={clearAll}>
            Remove all overrides
          </Button>
        </div>
      </form>
    </Form>
  )
}

/** One number limit: its label, the plan value, the override input, and the value the team gets. */
function NumberLimitRow({
  limitKey,
  planValue,
  suspendedValue,
  suspendedNote: note,
}: {
  limitKey: NumberKey
  planValue: string
  /** Set while suspended: the saved value that the team gets now. */
  suspendedValue?: string
  suspendedNote: string | null
}) {
  const form = useFormContext<SetTeamLimitOverridesInput>()
  const { min, max } = limitOverrideFormBounds(limitKey)
  const { label, hint } = NUMBER_LABELS[limitKey]
  const clear = () => form.setValue(limitKey, "", { shouldDirty: true, shouldValidate: true })

  return (
    <FormField
      control={form.control}
      name={limitKey}
      render={({ field }) => (
        <FormItem className={ROW_CLASS}>
          <div className="md:pt-2">
            <FormLabel>{label}</FormLabel>
            {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          <p className="text-sm tabular-nums md:pt-2">
            <span className={CELL_LABEL_CLASS}>Plan with add-ons: </span>
            {formatCount(planValue)}
          </p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FormControl>
                <Input inputMode="numeric" autoComplete="off" placeholder="Plan value" className="max-w-40" {...field} />
              </FormControl>
              {field.value === "" ? null : (
                <Button type="button" variant="ghost" size="sm" onClick={clear}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCount(String(min))} to {formatCount(String(max))}
            </p>
            {note ? <p className="text-xs text-amber-700 dark:text-amber-400">{note}</p> : null}
            <FormMessage />
          </div>
          <p className="text-sm font-medium tabular-nums md:pt-2">
            <span className={CELL_LABEL_CLASS}>Team gets: </span>
            {formatCount(suspendedValue ?? String(effectiveNumber({ limitKey, typed: field.value, plan: planValue })))}
          </p>
        </FormItem>
      )}
    />
  )
}

/** The value the team gets in the unit of the form: a typed override within its bounds, or the plan value. */
function effectiveNumber({ limitKey, typed, plan }: { limitKey: NumberKey; typed: string | undefined; plan: string }): number {
  const { min, max } = limitOverrideFormBounds(limitKey)
  const isOverride = typed !== undefined && /^\d+$/.test(typed) && Number(typed) >= min && Number(typed) <= max

  return Number(isOverride ? typed : plan)
}

/** While suspended: whether the stored override of one key applies now. Null with no stored override. */
function suspendedNote({
  limitKey,
  suspended,
}: {
  limitKey: keyof TeamPlanLimits
  suspended: { overrides: TeamLimitOverrides; appliedOverrides: TeamLimitOverrides } | null
}): string | null {
  if (!suspended || suspended.overrides[limitKey] === undefined) {
    return null
  }

  return suspended.appliedOverrides[limitKey] === undefined
    ? "Suspended: the Free value applies."
    : "Applies now: it is below the Free value."
}

function formatCount(value: string): string {
  return Number(value).toLocaleString("en-US")
}

const NUMBER_LABELS: Record<NumberKey, { label: string; hint?: string }> = {
  seats: { label: "Seats", hint: "Members and pending invitations." },
  projects: { label: "Projects" },
}

// One column set for the header and the rows, so they line up.
const COLUMNS_CLASS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] md:gap-4"
const ROW_CLASS = `grid gap-2 border-b py-3 last:border-b-0 md:items-start ${COLUMNS_CLASS}`
const CELL_LABEL_CLASS = "text-xs text-muted-foreground md:hidden"

type NumberKey = (typeof LIMIT_OVERRIDE_NUMBER_KEYS)[number]
