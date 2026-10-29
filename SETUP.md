# Setting up sending for signature

Signing a document yourself works with no setup. Sending documents to other people needs three free accounts: Supabase (logins, database, file storage and server code), Resend (email) and Vercel (hosting). Allow about 30 minutes.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick the **Sydney** region (closest to New Zealand) and save the database password somewhere safe.
2. In **Project Settings → General**, copy the **Project ID** (the "project ref").
3. Create an access token at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
4. In GitHub, open this repo's **Settings → Secrets and variables → Actions** and add:
   - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`
   - Variable (Variables tab): `SUPABASE_ENABLED` = `true`
5. Open **Actions → Deploy Supabase → Run workflow**. It creates the tables, security rules and file storage, and deploys the server functions. It runs again by itself whenever `supabase/` changes on `main`.

## 2. Resend (email)

1. Sign up at [resend.com](https://resend.com) and add a domain you own (for example `mail.yourname.nz`), then add the DNS records it shows. Until a domain is verified, Resend only delivers to your own address.
2. Create an API key.
3. In Supabase, open **Edge Functions → Secrets** and add:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = for example `MyPDF <sign@mail.yourname.nz>`
   - `APP_URL` = your Vercel address from step 3, for example `https://mypdf.vercel.app`
4. So sign-in codes come from your domain too (Supabase's built-in sender is heavily rate-limited), open **Authentication → Emails → SMTP Settings** in Supabase, turn on custom SMTP and enter host `smtp.resend.com`, port `465`, user `resend`, password = the Resend API key, and the same sender address.

## 3. Sign-in emails

In Supabase **Authentication → Emails → Templates**, set both **Magic Link** and **Confirm signup** to:

- Subject: `Your MyPDF sign-in code`
- Body: the contents of [`supabase/templates/sign-in.html`](supabase/templates/sign-in.html)

Then in **Authentication → URL Configuration**, set **Site URL** to your Vercel address.

## 4. Vercel (hosting)

1. At [vercel.com](https://vercel.com), sign in with GitHub, choose **Add New → Project** and import this repo.
2. Under **Environment Variables** add, from Supabase **Project Settings → API**:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the `anon` public key
3. Deploy. Every merge to `main` redeploys automatically.

## Running everything locally

Needs Docker.

```sh
npx supabase start            # prints the local API URL and anon key
cp .env.example .env.local    # fill in those two values
npx supabase functions serve  # in a second terminal
npm run dev
```

Emails are printed in the `functions serve` output instead of being sent, and sign-in codes appear in the local mail viewer at http://127.0.0.1:54324.
