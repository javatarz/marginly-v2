# Supabase Auth: magic links, precreated users, sessions, mail limits

Research for [issue #6](https://github.com/javatarz/marginly-v2/issues/6), against
Supabase's own documentation and source repositories only. Every claim below
carries the URL it came from. Where Supabase's material does not answer a
question, that is said explicitly rather than filled in with a guess.

There is no existing research-notes convention in this repo, so this file sits at
`docs/research/supabase-auth.md`, alongside `docs/adr/` and `docs/agents/`.

## Summary

Marginly needs email magic-link sign-in, no signup flow, accounts precreated by a
seed script, and sessions that last a long time. All four are supported, but two
findings change the shape of the plan.

The first is that the built-in mailer is far more restrictive than a rate limit.
It sends **2 messages per hour project-wide**, and — more decisively — it
**refuses to deliver to any address that is not a member of the Supabase
organisation's team**, failing with `email_address_not_authorized`
([Custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)). A
Reviewer who is not on the Supabase team cannot receive a magic link at all. So
"custom SMTP is not required" holds only while every test account is a Supabase
org member; it does not hold for real Reviewers.

The second is that the cross-browser magic-link failure is avoidable. It is a
property of the PKCE `?code=` redirect, not of magic links as such. If the Magic
Link email template is changed to carry `{{ .TokenHash }}` to an
`/auth/confirm` route handler that calls `verifyOtp`, the verification is a plain
server-side `POST /verify` that issues a session directly, with no code verifier
involved
([`verifyPost` in supabase/auth](https://github.com/supabase/auth/blob/master/internal/api/verify.go)).
That is also the pattern Supabase documents for SSR.

Everything else is straightforward. Users are created with
`auth.admin.createUser({ email, email_confirm: true })` from a server-side script
holding the secret key; self-serve signup is turned off with **Allow new users to
sign up** plus `shouldCreateUser: false`. Sessions last indefinitely by default —
the access token expires after an hour and `@supabase/ssr` silently refreshes it
— and the settings that would *shorten* a session are the Pro-plan-only ones, so
the free-tier default is already the longest-lived option.

## 1. Magic links: how they are issued and verified

### Issuing the link

A magic link is requested with `signInWithOtp`, which despite the name sends a
magic link by default: "Though the method is labelled 'OTP', it sends a Magic
Link by default. The two methods differ only in the content of the confirmation
email sent to the user."
([Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link)).
Which of the two is sent is decided entirely by the email template: "If the
`{{ .ConfirmationURL }}` variable is specified in the email template, a magiclink
will be sent. If the `{{ .Token }}` variable is specified in the email template,
an OTP will be sent."
([`signInWithOtp` reference](https://supabase.com/docs/reference/javascript/auth-signinwithotp)).

The documented call, verbatim:

```js
async function signInWithEmail() {
  const { data, error } = await supabase.auth.signInWithOtp({
    email: 'valid.email@supabase.io',
    options: {
      // set this to false if you do not want the user to be automatically signed up
      shouldCreateUser: false,
      emailRedirectTo: 'https://example.com/welcome',
    },
  })
}
```

([Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link))

`shouldCreateUser` defaults to `true`; setting it to `false` means an unknown
email address does not silently become an account
([same page](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link)).
On the server this maps to the `create_user` field of `POST /auth/v1/otp`, and
when the flag is false and no such user exists the Auth server returns HTTP 422
with the message `Signups not allowed for otp` and the error code `otp_disabled`
([`otp.go` in supabase/auth](https://github.com/supabase/auth/blob/master/internal/api/otp.go)).
Note that the same code is also used for "Sign in with OTPs (magic link, email
OTP) is disabled"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)),
so it does not on its own tell you which of the two happened.

The response on success carries no session — the user has to go and read their
mail:

```json
{
  "data": {
    "user": null,
    "session": null
  },
  "error": null
}
```

([Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-email-otp))

`emailRedirectTo` must be an exact match against the project's Site URL or
additional redirect URLs; those "are the only URLs that are allowed as redirect
destinations after the user clicks a Magic Link"
([Enabling Magic Link](https://supabase.com/docs/guides/auth/auth-email-passwordless#enabling-magic-link),
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)). Locally
these are `auth.site_url` and `auth.additional_redirect_urls` in `config.toml`,
described as "A list of _exact_ URLs that auth providers are permitted to
redirect to post authentication"
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.additional_redirect_urls)).

### What is in the emailed URL

By default the Magic Link template uses `{{ .ConfirmationURL }}`, which expands
to a link back at the Auth server itself: "a signup confirmation URL would look
like: `https://project-ref.supabase.co/auth/v1/verify?token={{ .TokenHash }}&type=email&redirect_to=https://example.com/path`"
([Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)).

Clicking that hits `GET /auth/v1/verify`, which verifies the token and then
redirects. What it redirects *with* depends on the flow:

- **Implicit flow.** "User will be logged in and redirected to:
  `SITE_URL/#access_token=jwt-token-representing-the-user&token_type=bearer&expires_in=3600&refresh_token=a-refresh-token&type=invite`
  … Your app should detect the query params in the fragment and use them to set
  the session (supabase-js does this automatically)"
  ([supabase/auth README, `GET /verify`](https://github.com/supabase/auth/blob/master/README.md)).
  Because the tokens arrive in the URL *fragment*, the server never sees them —
  which is exactly why this flow does not work for server-side rendering
  ([Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)).
- **PKCE flow.** The user is redirected to `https://yourapp.com/...?code=<...>`,
  and "the `code` parameter is commonly known as the Auth Code and can be
  exchanged for an access token by calling `exchangeCodeForSession(code)`"
  ([PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)).

The Auth server decides between the two by looking at the token prefix: a token
beginning with the PKCE prefix takes the PKCE branch and is redirected with
`?code=`, otherwise it takes the implicit branch and is redirected with a token
fragment
([`verifyGet` in `verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go)).
The PKCE prefix is present because `signInWithOtp` sent a `code_challenge` when
the client was configured with `flowType: 'pkce'`
([`GoTrueClient.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueClient.ts)).

Note the default differs by package. Bare `@supabase/supabase-js` defaults to
`flowType: 'implicit'`
([auth-js `DEFAULT_OPTIONS`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueClient.ts)),
whereas `@supabase/ssr` hard-sets `flowType: "pkce"` in both its browser and
server clients
([`createBrowserClient.ts`](https://github.com/supabase/ssr/blob/main/src/createBrowserClient.ts),
[`createServerClient.ts`](https://github.com/supabase/ssr/blob/main/src/createServerClient.ts)).
A Next.js app built on `@supabase/ssr` is therefore on PKCE whether or not it
asks to be.

### The `token_hash` + `type` confirmation endpoint (the recommended pattern)

Rather than let the Auth server do the redirecting, Supabase documents editing
the Magic Link template so the link points at your own app, carrying the token
hash:

```html
<h2>Sign in to your account</h2>

<p>Use this link to sign in to your account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
```

At `/auth/confirm`, "exchange the hash for the session":

```js
const { error } = await supabase.auth.verifyOtp({
  token_hash: 'hash',
  type: 'email',
})
```

([Passwordless email logins, PKCE section](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link))

The reason this works server-side is spelled out in the email-templates guide:
"Since the `verifyOtp` method makes a `POST` request to Supabase Auth to verify
the user, the session will be returned in the response body, which can be read by
the server"
([Redirecting the user to a server-side endpoint](https://supabase.com/docs/guides/auth/auth-email-templates)).
The Auth server's `POST /verify` handler confirms this: it verifies the token
hash, then issues a refresh token and returns the session as JSON, with no PKCE
code and no code verifier anywhere in the path
([`verifyPost` in `verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go)).

Supabase's own Next.js example route handler:

```ts
import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next)
    }
  }

  // redirect the user to an error page with some instructions
  redirect('/error')
}
```

([`examples/auth/nextjs-full/app/auth/confirm/route.ts`](https://github.com/supabase/supabase/blob/master/examples/auth/nextjs-full/app/auth/confirm/route.ts))

A hardened variant in Supabase's UI library validates the `next` parameter and
passes the error through, which is worth copying:

```ts
const _next = searchParams.get('next')
const next = _next?.startsWith('/') ? _next : '/'
```

([`password-based-auth-nextjs/app/auth/confirm/route.ts`](https://github.com/supabase/supabase/blob/master/apps/ui-library/registry/default/blocks/password-based-auth-nextjs/app/auth/confirm/route.ts))

### `exchangeCodeForSession`, for completeness

If you stay on the `?code=` redirect instead, the route handler exchanges the
code: "Log in an existing user by exchanging an Auth Code issued during the PKCE
flow"
([`exchangeCodeForSession` reference](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession)).
The code is short-lived and single-use: "the code has a validity of 5 minutes and
can only be exchanged for an access token once. You will need to restart the
authentication flow from scratch if you wish to obtain a new access token"
([PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)).

### Expiry and resend interval

A magic link expires after **1 hour**, and a user may request one only once every
**60 seconds**: "By default, a user can only request a magic link once every 60
seconds and they expire after 1 hour"
([Enabling Magic Link](https://supabase.com/docs/guides/auth/auth-email-passwordless#enabling-magic-link);
the numbers are held in
[`packages/shared-data/config.ts`](https://github.com/supabase/supabase/blob/master/packages/shared-data/config.ts)
as `auth.rate_limits.magic_link.validity = 1 hour` and
`auth.rate_limits.magic_link.period = 60 seconds`).

Expiry is changed through **Authentication > Sign In / Providers > Auth Providers
> Email > Email OTP expiration**, and Supabase warns that "an expiry duration of
more than 86,400 seconds (one day) is strongly discouraged and can only be set
via the Management API". It also warns that the setting is not scoped to OTPs:
"The **Email OTP Expiration** setting also governs the validity of Magic Links
and other email links, including confirmation, password recovery, email change,
and invitation links"
([Enabling email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#enabling-email-otp)).

Locally the same knobs are `auth.email.otp_expiry` (default `3600`, "The expiry
time for an OTP code in seconds") and `auth.email.max_frequency` (default `1m`,
"The minimum amount of time that must pass between email requests")
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.email.otp_expiry)).

An expired link surfaces as `otp_expired`, "OTP code for this sign-in has
expired. Ask the user to sign in again"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

## 2. Creating users with no signup flow

### Turning signup off

There are two independent switches, and Marginly wants both.

Project-wide, the dashboard option is **Allow new users to sign up**: "Users will
be able to sign up. If this config is disabled, only existing users can sign in"
([General configuration](https://supabase.com/docs/guides/auth/general-configuration)).
Locally this is `auth.enable_signup` (default `true`, "Allow/disallow new user
signups to your project"), with `auth.email.enable_signup` as the email-specific
equivalent
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.enable_signup)).
The self-hosting environment variable is `DISABLE_SIGNUP`: "When signup is
disabled the only way to create new users is through invites. Defaults to
`false`, all signups enabled"
([supabase/auth README](https://github.com/supabase/auth/blob/master/README.md)).
Attempting to sign up anyway returns `signup_disabled`, "Sign ups (new account
creation) are disabled on the server"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

Per-call, `shouldCreateUser: false` on `signInWithOtp` stops a magic-link request
from creating the account as a side effect
([Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless#signing-in-with-magic-link)).
Both belong in the design: the project setting is the guarantee, the call option
is the explicit statement of intent at the one place the app can request mail.

### Creating the users

`auth.admin.createUser` is the direct route. "This function should only be called
on a server. Never expose your `service_role` key in the browser." Its documented
example for a user who should not have to confirm anything:

```javascript
const { data, error } = await supabase.auth.admin.createUser({
  email: 'user@email.com',
  email_confirm: true
})
```

`email_confirm` "confirms the user's email address if set to true"
([`createUser` reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser)).

That flag matters more than it looks. The users guide notes that "By default, a
user with an unverified email or phone number will not be able to sign in"
([Users](https://supabase.com/docs/guides/auth/users)), so a seeded account
created without `email_confirm: true` would be unable to use a magic link.

The client for a script is documented in the invite section of the users guide,
with `autoRefreshToken`, `persistSession` and `detectSessionInUrl` all disabled
because a script has no session of its own:

```js
import { createClient } from '@supabase/supabase-js'

// Use your project's secret key (sb_secret_...), and only ever on a trusted server.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
})
```

([Inviting users](https://supabase.com/docs/guides/auth/users#inviting-users))

Supabase repeats the key warning next to it: "The secret key (`sb_secret_...`,
which replaces the legacy `service_role` key) bypasses Row Level Security and
must only be used in a secure server environment. Never expose it in a browser or
any publicly accessible client"
([same page](https://supabase.com/docs/guides/auth/users#inviting-users)).

Putting those two documented pieces together gives the shape of the seed script.
Every line below is taken from the two reference pages just cited; only the loop
around them is ours:

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
})

for (const email of emails) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (error) console.error(email, error.code, error.message)
  else console.log(email, data.user.id)
}
```

Re-running it against an address that already exists returns `email_exists`,
"Email address already exists in the system"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)),
which is what makes the script safe to re-run.

`createUser` sends no email at all — nothing in its reference page describes one
([`createUser` reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser)).
That matters here, because it means seeding N accounts costs zero against the
mailer limits discussed in section 4.

### The two alternatives, and why they are worse for Marginly

**`inviteUserByEmail`** sends mail. "You can invite someone to create an account
by sending them an invitation email… When you invite an email that doesn't yet
belong to a user, a new unconfirmed user is created. Inviting an email that
already belongs to a confirmed user returns an error"
([Inviting users](https://supabase.com/docs/guides/auth/users#inviting-users)).
Its documented call:

```js
const { data, error } = await supabase.auth.admin.inviteUserByEmail('someone@example.com', {
  data: { name: 'Jane' }, // optional, stored in user_metadata
  redirectTo: 'https://example.com/welcome', // optional, where the invite link sends the user
})
```

Two reasons to skip it. It burns the mailer budget for every seeded account, and
it sends an email — which ADR-0001 has already ruled out of scope. Also worth
knowing if it is ever reconsidered: "Invitation links expire after the duration
configured in Email OTP Expiration, which defaults to 1 hour", and "The
`redirectTo` URL must be in your project's allowed redirect URLs configuration.
If it isn't, the `redirectTo` value is ignored and the invite link redirects to
your Site URL instead (no error is raised)"
([same page](https://supabase.com/docs/guides/auth/users#inviting-users)).

**`generateLink`** "generates email links and OTPs to be sent via a custom email
provider" for types `signup`, `invite`, `magiclink`, `recovery`,
`email_change_current` and `email_change_new`, returning `action_link`,
`email_otp`, `hashed_token`, `redirect_to` and `verification_type`. It "generates
the links and OTP codes but does not send the email itself"
([`generateLink` reference](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)).

```javascript
const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: 'email@example.com'
})
```

This is the documented escape hatch from the mailer entirely — an operator could
generate a magic link and hand it over out of band. It is not the sign-in flow
Marginly wants, but it is the one mechanism in Supabase's docs that lets a
non-team-member get in without custom SMTP. It is worth keeping in mind for the
constraint in section 4.

## 3. Session lifetime and refresh

### The default is already indefinite

"A session is created when a user signs in. By default, it lasts indefinitely and
a user can have an unlimited number of active sessions on as many devices."
Sessions terminate only when the user signs out, changes their password or
performs a security-sensitive action, times out through inactivity, reaches a
maximum lifetime, or signs in on another device — and the last three exist only
if configured
([User sessions](https://supabase.com/docs/guides/auth/sessions#what-is-a-session)).

So the answer to "how long can a session be made to last" is: forever, by leaving
the lifetime settings alone. Every setting in this area shortens sessions.

### Access token expiry

"Access tokens are designed to be short lived, usually between 5 minutes and 1
hour, while refresh tokens never expire but can only be used once. You can
exchange a refresh token only once to get a new access and refresh token pair.
This process is called **refreshing the session**"
([User sessions](https://supabase.com/docs/guides/auth/sessions#what-is-a-session)).

"Most applications should use the default expiration time of 1 hour… Setting a
value over 1 hour is generally discouraged for security reasons, but it may make
sense in certain situations." Values below 5 minutes are discouraged because they
increase load on the Auth server, run into clock skew across user devices, defeat
the client libraries' habit of refreshing ahead of time, and risk a token
expiring mid-request
([Recommended JWT expiration values](https://supabase.com/docs/guides/auth/sessions#what-are-recommended-values-for-access-token-jwt-expiration)).

There is a hard ceiling: `auth.jwt_expiry` "Defaults to 3600 (1 hour), maximum
604,800 seconds (one week)"
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.jwt_expiry)).
This is the ceiling on the *access token*, not on the session.

### Refresh token rotation and the reuse interval

"The general rule is that a refresh token can only be used once", with two
documented exceptions. First, "A refresh token can be used more than once within
a defined reuse interval. By default this is 10 seconds and we do not recommend
changing this value", granted specifically for "using server-side rendering where
the same refresh token needs to be reused on the server and soon after on the
client". Second, if the parent of the currently active refresh token is used, the
active token is returned instead — which covers clients that never received the
response to their previous refresh
([Refresh token reuse detection](https://supabase.com/docs/guides/auth/sessions#what-is-refresh-token-reuse-detection-and-what-does-it-protect-from)).

Outside those exceptions "the whole session is regarded as terminated and all
refresh tokens belonging to it are marked as revoked", surfacing as
`refresh_token_already_used`, "Refresh token has been revoked and falls outside
the refresh token reuse interval"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).
Rotation can be disabled — `auth.enable_refresh_token_rotation`, "If disabled,
the refresh token will never expire" (default `true`) — and the interval is
`auth.refresh_token_reuse_interval`, default `10` seconds
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.enable_refresh_token_rotation)).

The reuse interval is the reason a correctly wired SSR app does not fight itself.
An incorrectly wired one does: the SMTP guide warns that "If you are using a SSR
framework on the frontend and are seeing an increased number of user logins
without a clear cause, check your set up… Sometimes a misplaced `return` or
conditional can cause early session termination"
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). For Marginly
that failure mode costs magic-link emails, which are the scarcest resource in the
system.

### Time-boxing, inactivity timeout, single session — Pro plan only

"**This feature is only available on Pro Plans and up.**" The three options are
time-boxed sessions "which terminate after a fixed amount of time", an inactivity
timeout "which terminates sessions that haven't been refreshed within the timeout
duration", and a single session per user, which "only keeps the most recently
active session"
([Limiting session lifetime](https://supabase.com/docs/guides/auth/sessions#limiting-session-lifetime-and-number-of-allowed-sessions-per-user)).

Enforcement is lazy: "Sessions are not proactively destroyed when you change
these settings, but rather the check is enforced whenever a session is refreshed
next. This can confuse developers because the actual duration of a session is the
configured timeout plus the JWT expiration time"
([same section](https://supabase.com/docs/guides/auth/sessions#limiting-session-lifetime-and-number-of-allowed-sessions-per-user)).

None of these appear in the CLI config reference's auth section, consistent with
them being hosted-platform features
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth-config)).

### How supabase-js keeps a session alive

The client refreshes on its own. `auth.autoRefreshToken` — "Set to `true` if you
want to automatically refresh the token before expiring" — alongside
`persistSession` ("automatically save the user session into local storage") and
`detectSessionInUrl` ("automatically detect OAuth grants in the URL and sign in
the user")
([`createClient` reference](https://supabase.com/docs/reference/javascript/initializing)).
All three default to `true` in auth-js
([`DEFAULT_OPTIONS`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueClient.ts)).
The refresh loop ticks every 30 seconds and refreshes three ticks — 90 seconds —
before expiry
([auth-js `constants.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/constants.ts)).

`onAuthStateChange` reports the result. The documented events are
`INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `PASSWORD_RECOVERY`,
`TOKEN_REFRESHED` and `USER_UPDATED`, where `TOKEN_REFRESHED` fires "when the
authentication token is automatically refreshed"
([`onAuthStateChange` reference](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)):

```javascript
const { data } = supabase.auth.onAuthStateChange((event, session) => {
  console.log(event, session)
})
data.subscription.unsubscribe()
```

### Server-side refresh via `@supabase/ssr`

Next.js Server Components cannot write cookies, so the refresh has to happen in a
proxy (what Next.js used to call middleware). Its job is: "1. Refreshing the Auth
token by calling `supabase.auth.getClaims()`. 2. Passing the refreshed Auth token
to Server Components, so they don't attempt to refresh the same token themselves.
This is accomplished with `request.cookies.set`. 3. Passing the refreshed Auth
token to the browser, so it replaces the old token. This is accomplished with
`response.cookies.set`"
([Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)).

Supabase's own example, verbatim and including its warnings:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims()

  const user = data?.claims

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth')
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse
}
```

([`examples/auth/nextjs/lib/supabase/proxy.ts`](https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/proxy.ts);
the closing comment is truncated here — the original spells out the four rules
for constructing a different response object)

Wired up at the edge:

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

([`examples/auth/nextjs/proxy.ts`](https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/proxy.ts))

The server client, which the confirm route handler above imports:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
```

([`examples/auth/nextjs/lib/supabase/server.ts`](https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/server.ts))

Two guidance points from the same guide are worth carrying into the Marginly
design. On which method to trust: "Always use `supabase.auth.getClaims()` to
protect pages and user data. _Never_ trust `supabase.auth.getSession()` inside
server code such as Proxy. It isn't guaranteed to revalidate the Auth token. It's
safe to trust `getClaims()` because it validates the JWT signature against the
project's published public keys every time." And on the cookie itself, "The
cookie is named `sb-<project_ref>-auth-token` by default"
([Creating a Supabase client](https://supabase.com/docs/guides/auth/server-side/creating-a-client)).

## 4. The built-in mailer

### The recipient restriction, which matters more than the rate limit

Supabase's Custom SMTP guide is unambiguous: "**Send messages only to
pre-authorized addresses.** Unless you configure a custom SMTP server for your
project, Supabase Auth will refuse to deliver messages to addresses that are not
part of the project's team… For example, if your project's organization has these
member accounts `person-a@example.com`, `person-b@example.com` and
`person-c@example.com` then Supabase Auth will only send messages to these
addresses. All other addresses will fail with the error message _Email address
not authorized._"
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp))

The corresponding error code is `email_address_not_authorized`: "Email sending is
not allowed for this address as your project is using the default SMTP service.
Emails can only be sent to members in your Supabase organization. If you want to
send emails to others, set up a custom SMTP provider"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

This is the finding that has to be surfaced. The ticket says custom SMTP is not
required, and for a build-and-demo phase that is true — but only for addresses on
the Supabase organisation's team. Any Reviewer outside it cannot receive a magic
link on a hosted project.

### The rate limit

"**Significant rate-limits that can change over time.** To maintain the health and
reputation of the default SMTP sending service, the number of messages your
project can send is limited and can change without notice. Currently this value
is set to 2 messages per hour"
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). The value comes
from `auth.rate_limits.email.inbuilt_smtp_per_hour = 2` in
[`packages/shared-data/config.ts`](https://github.com/supabase/supabase/blob/master/packages/shared-data/config.ts),
and the rate-limits table records it as project-wide, not per user, and
"Customizable: Custom SMTP Only"
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits)).

There is a subtlety in how that table is written. The 2/hour figure sits on the
row for "Endpoints that trigger email sends — `/auth/v1/signup`,
`/auth/v1/recover`, `/auth/v1/user`". Magic links go through `/auth/v1/otp`,
whose own documented limits are "Defaults to 30 OTPs per hour" project-wide and
"Defaults to 60 seconds window before a new request is allowed to the same user",
both marked customizable
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits)). Supabase's
docs do not state anywhere which of the two governs a magic link sent through the
built-in mailer. The prose in the Custom SMTP guide reads as an unconditional cap
on the service ("the number of messages your project can send is limited …
currently 2 messages per hour"), and the safe planning assumption is 2 per hour;
but this is genuinely ambiguous in Supabase's own material and is listed as an
open question below.

Supabase is equally direct that this is not a production service: "No SLA
guarantee on message delivery or uptime for the default SMTP service. The default
SMTP service is provided as best-effort only and intended for the following
non-production use cases: Exploring and getting started with Supabase Auth;
Setting up and testing email templates with the members of the project's team;
Building toy projects, demos or any non-mission-critical application"
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).

### What breaching a limit looks like

"When rate limits are exceeded, a **429 Too Many Requests** error is returned",
and Supabase notes it "should handle this status code often, especially in
functions that authenticate a user"
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits),
[Error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

The codes to branch on are `over_email_send_rate_limit`, "Too many emails have
been sent to this email address. Ask the user to wait a while before trying
again", and `over_request_rate_limit`, "Too many requests have been sent by this
client (IP address). Ask the user to try again in a few minutes. Sometimes can
indicate a bug in your application that mistakenly sends out too many requests
(such as a badly written useEffect React hook)"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

Supabase is explicit about how to detect all of these: "Always use `error.code`
and `error.name` to identify errors, not string matching on error messages. Avoid
relying solely on HTTP status codes, as they may change unexpectedly." Errors
from the Auth API arrive as `AuthApiError`, which "always have a `code` property
that can be used to identify the error returned by the server", plus a `status`
property
([same page](https://supabase.com/docs/guides/auth/debugging/error-codes)).

### Which limits are configurable

From the rate-limits table
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits)):

| Limit | Default | Configurable |
| --- | --- | --- |
| Emails via built-in provider (`/signup`, `/recover`, `/user`) | 2 / hour, project-wide | Custom SMTP only |
| OTP / magic link sends (`/otp`) | 30 / hour, project-wide | Yes |
| Resend to the same user (`/otp`) | 1 per 60 s | Yes |
| Verification requests (`/verify`) | 360 / hour per IP, bursts to 30 | No |
| Token refresh (`/token`) | 1800 / hour per IP, bursts to 30 | No |

Configurable limits live at **Authentication > Rate Limits** in the dashboard, or
through the Management API with fields such as `rate_limit_email_sent`,
`rate_limit_otp`, `rate_limit_verify` and `rate_limit_token_refresh`
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits)). The IP-based
ones use a token bucket: "Each bucket has a maximum capacity of 30 requests. When
the bucket is full, brief bursts of up to 30 requests can be allowed in a short
period"
([same page](https://supabase.com/docs/guides/auth/rate-limits)).

Locally the defaults differ and are all editable: `auth.rate_limit.email_sent`
defaults to `2` per hour, `auth.rate_limit.token_verifications` to 30 "OTP / Magic
link verifications … in a 5 minute interval per IP address", and
`auth.rate_limit.sign_in_sign_ups` to 30 per 5 minutes per IP
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.rate_limit.email_sent)).

### Working within it

Three things follow from the documentation, without reaching for custom SMTP.

Seeding is free. `createUser` sends nothing
([`createUser` reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser)),
so precreating every account — which ADR-0001 already requires — costs zero mail.
The only mail Marginly sends is sign-in.

Long sessions are the lever. Supabase names this directly under mitigations:
"**Increase the duration of user sessions.** Having short lived user sessions can
be problematic for email sending, as it forces active users to sign-in
frequently, increasing the number of messages needed to be sent. Consider
increasing the maximum duration of user sessions"
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Since the
default session already lasts indefinitely (section 3), the work is not
configuration but correctness — a broken SSR proxy that terminates sessions early
turns directly into mail volume.

Local development bypasses the whole thing. The CLI runs its own SMTP with
`auth.email.smtp.host` defaulting to `inbucket`
([CLI config reference](https://supabase.com/docs/guides/local-development/cli/config#auth.email.smtp.host)),
so magic links during development are read from the local mail catcher and never
touch Supabase's service.

Custom SMTP remains the documented answer for anything beyond this — "We urge all
customers to set up custom SMTP server for all other use cases", after which "a
low rate-limit of 30 messages per hour is imposed" until raised
([Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)) — but it is out
of scope for this ticket and is noted here only so the boundary is on record.

## 5. Opening a magic link in a different browser

### Why it fails, and when it does not

The failure is a property of PKCE, not of magic links. Under the heading
**Limitations**: "Behind the scenes, the code exchange requires a code verifier.
Both the code in the URL and the code verifier are sent back to the Auth server
for a successful exchange. The code verifier is created and stored locally when
the Auth flow is first initiated. That means the code exchange must be initiated
on the same browser and device where the flow was started"
([PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)).

With `@supabase/ssr` the verifier lives in a cookie rather than `localStorage`,
which is what lets the server read it — but a cookie is still scoped to one
browser, so the constraint is unchanged
([`createBrowserClient.ts`](https://github.com/supabase/ssr/blob/main/src/createBrowserClient.ts)).

The important corollary: this applies to the `?code=` + `exchangeCodeForSession`
path. It does **not** apply to the `token_hash` + `verifyOtp` confirmation
endpoint from section 1. `verifyOtp` issues a `POST /verify` whose handler
verifies the token hash and returns a session, with no code verifier read from
anywhere
([`verifyPost` in `verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go);
[`verifyOtp` in `GoTrueClient.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueClient.ts)).
The token hash in the email is the only secret needed, so the link works in any
browser.

### The error shapes

If the exchange is attempted where the verifier is absent, auth-js throws before
it ever calls the server. The class exists for exactly this case — its own doc
comment reads "Error thrown when the PKCE code verifier is not found in storage.
This typically happens when the auth flow was initiated in a different browser,
device, or the storage was cleared" — and it carries
`name: 'AuthPKCECodeVerifierMissingError'`, `status: 400` and
`code: 'pkce_code_verifier_not_found'`
([auth-js `errors.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/errors.ts)).
There is a matching type guard, `isAuthPKCECodeVerifierMissingError`.

If a verifier is present but wrong, the server returns `bad_code_verifier`,
"Returned from the PKCE flow where the provided code verifier does not match the
expected one"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).

Two neighbouring codes will show up in the same place and are worth handling
identically, because a user cannot tell them apart either: `flow_state_expired`,
"PKCE flow state to which the API request relates has expired. Ask the user to
sign in again", and `flow_state_not_found`, "PKCE flow state to which the API
request relates no longer exists. Flow states expire after a while and are
progressively cleaned up, which can cause this error. Retried requests can cause
this error, as the previous request likely destroyed the flow state. Ask the user
to sign in again"
([same page](https://supabase.com/docs/guides/auth/debugging/error-codes)).

Failures that happen at the Auth server before the redirect reach the app as
query parameters rather than as thrown errors. On the PKCE branch the Auth server
sets `error_code` and `error_description` on the redirect URL's query string (and
mirrors them into the fragment); on the implicit branch they are in the fragment
only
([`prepErrorRedirectURL` in `verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go)).
A route handler should therefore check `searchParams` for `error_code` as well as
inspecting the error it gets back from the SDK.

### Detecting it in a route handler

Supabase's own error-handling guidance is to branch on `error.code` and
`error.name` rather than message text
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).
Its UI-library route handler already threads the error through to a single error
page:

```ts
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next)
    } else {
      // redirect the user to an error page with some instructions
      redirect(`/auth/error?error=${error?.message}`)
    }
```

([`password-based-auth-nextjs/app/auth/confirm/route.ts`](https://github.com/supabase/supabase/blob/master/apps/ui-library/registry/default/blocks/password-based-auth-nextjs/app/auth/confirm/route.ts))

For Marginly, same-browser-only is the accepted scope for now, and the
recommended handling is a **single generic error message** covering every one of
these cases — verifier missing, verifier mismatch, flow state expired or gone,
link expired, link already used. The user-facing instruction is identical in all
of them ("ask the user to sign in again", in Supabase's own words), the codes are
not something a Reviewer can act on differently, and distinguishing them leaks
information about account state. Log `error.code` server-side; show one message.

## Decisions this implies for issue #6

**Use the `token_hash` confirmation-endpoint pattern, not the default
`{{ .ConfirmationURL }}` link.** Edit the Magic Link email template to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and add an
`/auth/confirm` route handler calling `verifyOtp`. This is what Supabase
documents for SSR, it lets the server read the session, and — as a side effect —
it removes the cross-browser failure entirely, because no code verifier is
involved.

**Precreate accounts with `auth.admin.createUser({ email, email_confirm: true })`
from a Node script holding the secret key.** `email_confirm: true` is not
optional: without it a seeded user cannot sign in at all. The script sends no
email, so seeding is free against the mailer limits. Re-runs are safe —
duplicates come back as `email_exists`.

**Turn signup off in both places.** Disable **Allow new users to sign up** at the
project level (`auth.enable_signup = false` locally), and pass
`shouldCreateUser: false` on every `signInWithOtp` call. The first is the
guarantee; the second states the intent where the app requests mail.

**Leave session lifetime alone.** The default session is indefinite, the default
access token lasts an hour, and every setting in this area only shortens things —
and the ones that shorten are Pro-plan-only anyway. The work is making the
`@supabase/ssr` proxy correct, since a broken proxy terminates sessions early and
each early termination costs a magic-link email.

**Show one generic error on the confirm route.** Every failure mode — expired
link, reused link, wrong browser, missing or stale flow state — gets the same
message. Log `error.code` for diagnosis. Same-browser-only remains the accepted
scope.

**Flag the mailer recipient restriction as a real constraint, not a rate limit.**
On a hosted project the built-in mailer will not deliver to anyone outside the
Supabase organisation's team. Custom SMTP stays out of scope for this ticket, but
the plan should record that either every test Reviewer is added to the Supabase
org, or development stays local against the CLI's Inbucket, or an operator hands
out links generated with `auth.admin.generateLink`. This is worth its own issue.

## Open questions, and what Supabase's docs do not answer

**Which rate limit actually governs a magic link on the built-in mailer.** The
rate-limits table attaches the 2/hour built-in-mailer figure to `/auth/v1/signup`,
`/auth/v1/recover` and `/auth/v1/user`, while `/auth/v1/otp` — the endpoint magic
links use — has its own documented 30/hour. The Custom SMTP guide states the
2/hour cap as a property of the sending service without qualification. The two
pages are not reconciled anywhere in Supabase's material
([Rate limits](https://supabase.com/docs/guides/auth/rate-limits),
[Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Planning
assumption above: 2 per hour. Worth verifying empirically against a real project
before relying on anything higher.

**Whether raising `rate_limit_otp` does anything without custom SMTP.** The
table marks the `/otp` limits customizable and the built-in email limit "Custom
SMTP only". Whether raising the former has any effect while on the built-in
mailer is not stated.

**Any absolute ceiling on session length.** The docs say sessions last
indefinitely by default and describe only the settings that shorten them. No
maximum is documented, and no statement says an unconfigured session is ever
reaped. The one nearby figure is that expired sessions "are progressively deleted
from the database 24 hours after they expire"
([User sessions](https://supabase.com/docs/guides/auth/sessions#limiting-session-lifetime-and-number-of-allowed-sessions-per-user)),
which is about already-expired sessions, not live ones.

**Whether the `token_hash` pattern is officially blessed as cross-browser-safe.**
That it works follows from `verifyPost` in the Auth server source and from the
email-templates guide's explanation that `verifyOtp` returns the session in a POST
response body. Supabase never says in prose "this makes magic links work across
browsers". The conclusion is sound but is assembled from source and adjacent
documentation rather than stated outright — treat it as verified by reading the
implementation, not by a documented guarantee, and confirm it in a smoke test.

**Exact behaviour of `shouldCreateUser: false` for an unknown address.** The Auth
server returns 422 with code `otp_disabled` and message "Signups not allowed for
otp"
([`otp.go`](https://github.com/supabase/auth/blob/master/internal/api/otp.go)),
but the docs surface `otp_disabled` only as "Sign in with OTPs (magic link, email
OTP) is disabled. Check your server's configuration"
([Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes)),
which describes a different situation. The overload is not documented. This is
another argument for one generic error message.

**Whether the built-in mailer's team-member restriction applies to local
development.** The restriction is documented for hosted projects and framed
around the project's organisation team. The CLI defaults `auth.email.smtp.host`
to `inbucket`, which implies it does not apply locally, but no Supabase page
states this directly.
