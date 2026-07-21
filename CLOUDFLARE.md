# Cloudflare deployment from GitHub

This repository is ready for Cloudflare Workers Builds. The one-time setup below connects the Worker to GitHub; after that, every successful push to `main` creates a production deployment. Pull-request branches can create preview versions without replacing production.

## 1. Import the repository

1. In the Cloudflare dashboard, open **Workers & Pages**, choose **Create application**, then import an existing Git repository.
2. Authorise GitHub if prompted and select `danielb56/Marions`.
3. Use `marions` as the Worker name and `main` as the production branch.
4. Leave the root directory blank (the application is at the repository root).
5. Configure these commands:

   - Build command: `pnpm exec opennextjs-cloudflare build`
   - Deploy command: `pnpm exec opennextjs-cloudflare deploy`
   - Preview deploy command: `pnpm exec opennextjs-cloudflare upload`

The repository pins Node 22+ and pnpm 11.9.0 in `package.json`.

## 2. Add build variables

In the Git build configuration, add these variables. Next.js needs them while compiling browser bundles:

- `NEXT_PUBLIC_APP_URL` — the final HTTPS URL, such as `https://work.example.com`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not put server credentials in variables prefixed with `NEXT_PUBLIC_`.

## 3. Add Worker variables and secrets

The first deployment can complete without credentials so that Cloudflare can create the Worker. Do not use the application with real data until the required values below are configured and a new deployment has completed.

Under the Worker's **Settings -> Variables and Secrets**, add these required plain-text variables. The three values must also be present in the build configuration because server-side requests read them at runtime while Next.js embeds their browser-visible copies at build time.

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Add these required encrypted secrets:

- `SUPABASE_SECRET_KEY`
- `CRON_SECRET` — generate at least 32 random characters

Photo uploads require these additional plain-text variables:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`

Add these photo-upload values as encrypted secrets:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Outbound notifications require these additional plain-text variables:

- `RESEND_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_FROM`

Add these notification-provider values as encrypted secrets:

- `RESEND_API_KEY`
- `TWILIO_AUTH_TOKEN`

Resend and Twilio values may be omitted until outbound email or SMS is enabled. R2 credentials may be omitted until photo uploads are enabled. `SUPABASE_SECRET_KEY` and `CRON_SECRET` must never be exposed to browser code or committed to Git.

After saving the required values, trigger a new deployment. Because the `NEXT_PUBLIC_` values are compiled into the browser bundle, changing only the runtime settings is not sufficient.

The Wrangler configuration uses `keep_vars: true`, so Git deployments preserve values managed in the Cloudflare dashboard. Wrangler never stores secret values in this repository.

## 4. Configure the external services

- Apply every file in `supabase/migrations` to the production Supabase project. Disable public sign-up and add the production `/auth/callback` URL to the Auth redirect allowlist.
- Create the private R2 bucket named by `R2_BUCKET`, restrict the S3 credentials to it, and apply `infrastructure/r2-cors.json` with the production origin.
- Verify the Resend sending domain and Twilio sender before enabling those channels.
- Point the custom domain at the Worker, then update `NEXT_PUBLIC_APP_URL` in both build and runtime settings and redeploy.

## 5. Create the first manager

Run this locally with `.env.local` pointed at the production Supabase project:

```bash
read -s "MANAGER_PASSWORD?Manager password: "; echo
MANAGER_PASSWORD="$MANAGER_PASSWORD" pnpm seed:manager --email manager@example.com --name 'Manager Name' --tenant 'Company Name'
unset MANAGER_PASSWORD
```

There is no public sign-up. The first manager is guided through TOTP MFA enrolment on first sign-in.

## Local Cloudflare preview

Copy `.env.example` to `.env.local` for the regular Next.js development server. For the Cloudflare runtime preview, also copy the same values to an ignored `.dev.vars` file, then run:

```bash
pnpm preview:cloudflare
```

The production Worker receives a Cloudflare Cron Trigger every five minutes. Its scheduled handler calls the OpenNext request handler directly and supplies `CRON_SECRET`; the secret is not placed in the URL or sent through a public network request.
