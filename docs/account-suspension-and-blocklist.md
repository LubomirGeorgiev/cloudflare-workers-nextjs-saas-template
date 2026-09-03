# Account suspension and the registration blocklist

Two staff features that are often confused. Keep them apart:

- **A ban stops an existing account.** `user.bannedAt` is set. The person loses every way to
  authenticate, and the teams they own lose their subscription.
- **A blocklist entry stops a new account.** A pattern in `banned_email` refuses account creation.
  It bans nobody.

This one rule decides every enforcement point below. Adding a pattern must never revoke access, and
banning must never block a domain.

---

## 1. Where things live

| Area | File |
| --- | --- |
| The shared ban test | `src/lib/account/ban.ts` (`isBanned`, `assertNotBanned`) |
| Ban and unban services | `src/lib/admin/user-ban.ts` |
| Staff cancellation | `src/lib/admin/team-billing-admin.ts` |
| Pattern parser and matcher inputs | `src/utils/email-pattern.ts` |
| The one blocklist read | `src/lib/auth/blocked-email-guard.ts` |
| Blocklist administration | `src/lib/admin/blocked-emails.ts` |
| One declaration of the ban decision | `banDecisionFields` in `src/schemas/admin-users.schema.ts` |
| Internal API | `src/api/admin/routes/users.ts`, `src/api/admin/routes/blocked-emails.ts`, `src/api/admin/routes/teams.ts` |
| Admin panel | `admin/_components/users/user-ban-section.tsx`, `admin/blocked-emails/` |

---

## 2. State on `user`, history in `user_ban_event`

`user.bannedAt` is the enforcement flag. Every chokepoint reads it off a row it already loads, so
it can never be a join.

`user_ban_event` is the record: one row per ban, one per unban. **Nothing in it is ever updated
after its facts are stamped, and nothing is ever deleted.** A ban → unban → ban cycle therefore
keeps every round, which is the shape abuse work deals with. Each row holds the internal reason, the
external reason, the actor, whether a notice was emailed, and how many subscriptions the ban
cancelled.

Reads are always bounded by `USER_BAN_EVENT_PAGE_SIZE`.

---

## 3. The ban order, and why

`banUser` runs eight steps. The order is the part that is wrong-by-default rather than
wrong-by-typo.

1. **Write `user.bannedAt` and append the `ban` event.** D1 has no transactions, so this is durable
   before anything else runs. No later failure may stop the steps after it. The write is guarded on
   `bannedAt IS NULL` and returns the row it changed, so the flip is what decides the transition:
   exactly one call of two concurrent ones writes the event and queues the notice.
2. **Revoke every API key.** All of them, not only the internal ones.
3. **Revoke every OAuth grant.**
4. **Revoke the pending invitations the banned user sent.** Otherwise their outstanding invites keep
   adding members to their team after the ban.
5. **Cancel the subscription of every team they own.** Never a team where they are only a member.
6. **Delete every KV session.** It deletes; it does not refresh. A refreshed session would still
   authenticate.
7. **Purge the principal caches.** This must come after steps 2 and 3. In the other order a snapshot
   rebuilt between the purge and the revocation outlives its own revocation until the TTL lapses.
8. **Queue the notice, if staff asked for one.** Last, and only ever queued, so it can never fail the
   ban and can never announce a ban that did not land.

Steps 2 through 5 each carry their own `.catch`. One store failing must not skip another, and must
not skip step 7.

Step 8 reports what the queue write did. A rejected write is `queue-failed`, not `queued`, and
stamps no `noticeQueuedAt`: an event row must never claim a notice that nothing will deliver.

Step 5 counts a team as cancelled when Stripe took it, and also when Stripe failed but the retry
job was queued. When the enqueue fails too, nothing will ever cancel that subscription, so it is
counted in `subscriptionCancellationFailedCount` instead and logged with the subscription id. That
count lives on the returned result only; there is no column for it.

**Re-banning repairs.** Steps 2 through 7 are idempotent, so they run on *every* `banUser` call,
including one against an account that is already banned. That repeat pass is the only retry a
failed cleanup step ever gets, because each step only logs its own failure. A repeat writes no
second event row and sends no second notice; it returns `alreadyBanned: true` with the counts the
repeat pass did.

Propagation: KV is eventually consistent. Revocation is immediate at the writing point of presence
and takes up to about six minutes everywhere else: the 300-second snapshot TTL
(`API_KEY_CACHE_TTL_SECONDS`, matched by `OAUTH_GRANT_CACHE_TTL_SECONDS`) plus the ~60 seconds KV
needs to propagate a delete to every location. Say so in the admin UI.

---

## 4. What a ban does NOT do

These are decisions, not omissions.

- It does not delete the account. Ban is reversible; erasure is a separate feature.
- It does not delete or rename the team, and it does not evict members.
- It does not deactivate the banned user's memberships. Deactivating is not cleanly reversible, so
  an unban could not tell which memberships it had turned off.
- It does not promote anyone to owner, and it does not transfer ownership. A silent privilege grant
  is worse than a frozen team.
- It does not refund anything. Cancelling is not refunding.
- It does not touch `role`. Two guards keep a banned account from ever being an admin account:
  `banUser` refuses to ban an admin, and `setUserRole` refuses to promote a banned account.
  Demotion of a banned account stays allowed. A self-ban is refused too.
- It does not add the user's email to the blocklist by itself. The ban form offers that as a
  separate checkbox, which creates an ordinary `banned_email` row.

---

## 5. Enforcement chokepoints

A ban is only real where it is checked. Every point fails closed.

| Point | File | Behavior |
| --- | --- | --- |
| Cookie session | `src/utils/auth.ts` | A snapshot carrying `bannedAt` is deleted and resolves to null, on the stored snapshot and on the one a version refresh rebuilds |
| Session write | `createSessionUnlessBanned` in `src/utils/auth.ts` | Re-reads D1 after the write, deletes the session, and refuses before the cookie is set |
| Password sign-in | `sign-in-auth.ts` | After the password verifies, then again in the session write |
| Passkey sign-in | `passkey-settings.actions.ts` | After the assertion verifies, then again in the session write |
| Google SSO | `google-callback.action.ts` | Both existing-account branches, then again in the session write |
| API keys | `src/utils/kv-api-key.ts` | Snapshot check plus the D1 rebuild path |
| OAuth grants | `src/utils/kv-oauth-grant.ts` | The same two checks |
| Admin surfaces | `src/lib/admin/admin-principal.ts` | `isLiveAdmin` reads the ban from the same row as the role |
| Role promotion | `setUserRole` in `src/lib/admin/users.ts` | Refuses to promote an account with `bannedAt` set |
| Password reset | `forgot-password`, `reset-password` | No link is sent; the consume step refuses |
| Email verification | `verify-email`, `send-verification` | Refused |

**Order matters for enumeration.** Check the ban *after* the credential verifies, never before. Then
the refusal tells a caller nothing they did not already prove they knew. `forgot-password` is the
exception: it returns the same neutral response either way, so the ban never leaks there.

**Known race, stated rather than hidden.** Every sign-in chokepoint writes its session through
`createSessionUnlessBanned`: it writes the session, re-reads `user.bannedAt` from D1, and on a ban
deletes the session and refuses before any cookie is set. A ban that lands after that re-read is
deleted by step 6 instead. What is left is the gap between the two: KV list is eventually
consistent, so step 6 can miss the key of a session written moments before it listed, and that one
session authenticates until it expires. Closing it fully needs a live D1 read on every cookie
request; that price is not worth paying.

**Deliberately not checked:** `src/proxy.ts` and `worker-entrypoint.ts`. Neither has a database
context, and the session cookie is opaque to both.

---

## 6. Billing

Banning an owner cancels the subscription of every team they own, immediately. Ownership transfer is
not offered.

The cancel parameters live in `REVENUE_PRESERVING_CANCEL_PARAMS`
(`src/constants/subscription-lifecycle.ts`). Both Stripe defaults are wrong for this path, so both
are stated:

- `invoice_now: true` raises a final invoice covering pending proration items and any un-invoiced
  metered usage. With both flags false Stripe **deletes** pending prorations — money already owed.
- `prorate: false` keeps the default deliberately. Setting it true would credit the customer for
  unused time, which is a pricing policy change, not a bug fix.

**The rule for a fork that adds metered billing:** the ban and cancel paths must bill unbilled usage
and must never credit unused time. Never reach for `clear_usage` on these paths.

The race and orphan cleanups (`convergeOnWinningCheckout`, `discardLosingTrial`,
`cancelOrphanIfPresent`) deliberately pass **no** flags: they cancel an `incomplete` subscription
the customer never used, and invoicing one would bill them for something that never existed.
`settleRecordedSubscription` reads `invoiceOnCancel` from the per-status policy instead.

Consequences the ban form must state in plain words:

- Members of a cancelled team lose paid entitlements at once, even though the period was paid for.
  They are not evicted.
- Cancelling stops automatic collection of every **open invoice of that Stripe customer**, not only
  the subscription's. The debt is not written off; nothing chases it automatically. Finance
  re-enables `auto_advance` per invoice in the Stripe dashboard.
- The Stripe customer, its invoice history, and its saved cards all stay, so an unbanned team can
  subscribe again without a new customer.
- `trialUsedAt` stays set, so a ban-then-unban cycle cannot farm a second free trial.

A Stripe failure never blocks the ban. It enqueues `billing.cancel-subscription`, which is
idempotent and treats `resource_missing` as done.

---

## 7. Unban

Unban restores access. **It restores nothing else.**

| Thing | After unban |
| --- | --- |
| Sign-in | Works again |
| API keys | Still revoked. Create new ones. |
| OAuth grants | Still revoked. Re-consent in each client. |
| Sent invitations | Still revoked. Re-invite. |
| Team memberships | Never touched, so intact |
| Stripe subscription | Gone. The owner subscribes again by hand. |
| Free trial | Not available |
| Stripe customer, invoice history, saved cards | Intact |

That table is what the unban screen and the unban email both have to carry. An unbanned customer who
returns to an unexpectedly free team with dead integrations is a support ticket one paragraph
prevents.

`unbanUser` reads the latest `ban` event's `cancelledSubscriptionCount` **before** it writes
anything, because the notice needs it to tell the truth about billing.

---

## 8. The two reasons

Ban and unban each take a required **internal reason**, an optional **external reason**, and one
**"email the user"** checkbox, checked by default.

There is deliberately no "include the reason in the email" flag. Two fields replace it, and the
guarantee is structural rather than procedural: **the notice payload has no field for the internal
reason.** It is not filtered out; it has nowhere to go. A reviewer confirms it by grepping
`internalReason` and finding nothing under `src/utils/email.tsx` or the payload union in
`src/lib/scheduler/jobs.ts`.

The field labels carry the whole distinction, so they are part of the design:
"Internal reason — staff only, never sent" and "Reason to send the user — this exact text appears in
the email."

Leaving the external reason blank is a legitimate, common choice. The notice still says the account
was suspended and points at support.

**The email is always English.** This is a documented exception to the rule that customer-facing
email goes through next-intl with a row in every locale catalog. The reason a staff member types is
free English text, and wrapping English staff prose in translated chrome produces a half-translated
email that staff cannot review. Pass the literal `BAN_EMAIL_LOCALE`, not `DEFAULT_LOCALE`: a fork can
change its default locale, and this copy stays English either way.

**One declaration, four doors.** `banDecisionFields` is spread by both forms, both server actions,
and both internal routes, so `sendEmail`'s default exists exactly once.
`src/schemas/admin-users.schema.test.ts` pins it for every door.

---

## 9. The blocklist pattern format

| Pattern typed by staff | `kind` | `value` | Matches |
| --- | --- | --- | --- |
| `spam@example.com` | `email` | `spam@example.com` | that one address |
| `*@example.com` | `domain` | `example.com` | any address at that domain |
| `*@*.example.com` | `domain-suffix` | `example.com` | that domain **and** every subdomain |

Anything else is refused: a bare domain, a partial local wildcard (`ad*@example.com`), and a lone
`*`. `domain-suffix` includes the apex, because staff mean "this company" when they type it.

Matching runs **one** D1 query. Every branch is an indexed equality lookup against
`banned_email_kind_value_unique`. The wildcard never becomes a table scan or a `LIKE` prefix search.
`MAX_EMAIL_DOMAIN_LABELS` bounds the candidate list, so a hostile address cannot decide how many
values the query binds.

There is no KV cache. Sign-up already carries `RATE_LIMITS.SIGN_UP`, so the query volume is trivial,
and a cache would need invalidating on every blocklist write.

---

## 10. Blocklist chokepoints

| Point | File | Behavior |
| --- | --- | --- |
| Password sign-up | `sign-up.actions.ts` | After the captcha, before the account lookup — refuse |
| Passkey sign-up | `passkey-sign-up.actions.ts` | Same position — refuse |
| Google SSO | `google-callback.action.ts` | **Only** on the create-new-user branch — refuse |
| Team invite send | `src/lib/teams/team-invite.ts` | Write nothing, send nothing, return `INVITE_SUCCESS` unchanged |
| Team invite accept | `src/lib/teams/team-invitation-accept.ts` | Refuse — for an entry added after the invite went out |

The Google **link-by-email** branch does not check the blocklist. That account already exists; the
lever for it is a ban.

The invite path must keep its non-revealing contract: every invite outcome returns one identical
success shape, so a caller cannot probe who has an account. A blocklist refusal must not break that.

The refusal copy is neutral. It never says "blocked" and never names the pattern that matched.

**Adding an entry never bans an existing account.** The create dialog shows how many accounts match
and links to the filtered users list; staff ban them one at a time. An unbounded write behind one
button click is not something staff should be able to trigger by accident.
