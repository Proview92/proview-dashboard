# Proview dashboard

https://dashboard.proviewcrm.co.uk: one sign-in (a "Proview account") for Proview Bookings, Employee, Signage and WiFi.

- Accounts live in the licence hub Supabase project (`bpssjfrinjlrnkzhytfr`, own storage key `pv-account`).
- Opening an app calls the hub's `sso-assert` function, which returns a 2-minute, single-use, Ed25519-signed hand-off for that app. The app checks it with the public key (`sso-login` function, or `/customer/sso` in WiFi) and signs the person in, if they are an owner/manager there.
- Apps send people here with `?app=<bookings|employee|signage|wifi>&return=<url>`.

Single static page; pushing to `main` redeploys through GitHub Pages.
