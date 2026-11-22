# Deploying the interface static files

The static files live in a Cloudflare Pages project (spec section 10.1); in the author's deployment
it is `fpga-sim`, at `https://fpga-sim.scriptorium.cc`. Decisions are in `docs/decisions.md`, items 101,
102 and 173.

## Site settings

The repository holds no host names (decision 173). The addresses and hosts of one deployment are in
the site settings file `~/.config/fpgasim/site.env` (another path: `FPGASIM_SITE_ENV`); the format and
the keys are in `deploy/site.env.example`. The Makefile and the scripts in `deploy/` read it.
In the author's deployment: interface `https://fpga-sim.scriptorium.cc`, build server
`https://fpga-build.scriptorium.cc`, SSH host `fpga-build`. The commands below use these values;
for another deployment, replace them with your own.

## Deployment

On the Mac, from the repository root, on the branch you want to deploy:

```
make deploy-web
```

The script `deploy/deploy-web.sh` builds the interface with the build server address
`FPGASIM_BUILD_URL` from the site settings (it also goes into the `connect-src` of `_headers`), creates the Pages project on the first run and deploys
`web/dist` to the project's production branch `main`. It needs a `wrangler login` session (Pages
permissions). The deployment label, time and commit, shows in the project's deployment list in the
Cloudflare panel.

Rollback: Cloudflare panel → Workers & Pages → `fpga-sim` → Deployments → the earlier deployment →
Rollback to this deployment.

## What the author does once

1. Binds the domain: Workers & Pages → `fpga-sim` → Custom domains → `fpga-sim.scriptorium.cc`.
   The panel creates the DNS record itself. The build server accepts page requests only from
   `FPGASIM_WEB_URL` of the site settings (CORS, spec section 8.6; `make deploy-server` passes it to the
   service): builds do not work on `fpga-sim.pages.dev`.
2. Creates their own administrator account, the `e2e` account and a key for the acceptance tests
   (see below).

## Headers

The file `web/public/_headers` sets the content security policy. When the build server address
changes, edit both `VITE_BUILD_URL` and the `connect-src` line in this file: the deployment script
compares them and stops on a mismatch.

## Users

People sign in with a login and password (`docs/tz-accounts.md`). The administrator creates
accounts on the "Users" page. It opens from the account menu at the top right of the projects
screen. There the administrator also disables and deletes accounts and issues a new password. The
password is shown once; a lost password is replaced with a new one.

The author creates the first administrator account once on the VPS:

```
ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin user add <login> --name <name> --admin'
```

The command prints the password once. Other utility commands: `user passwd <login>` (new password),
`user disable <login>`, `user enable <login>`, `user list`.

Keys stay for scripts: `make e2e-prod` and measurements. The link
`https://fpga-sim.scriptorium.cc/#key=<key>` also works: the page remembers the key, removes it
from the address and works without an account. Issuing and disabling keys: `docs/deploy-server.md`,
section "Keys".

## Acceptance tests

They need a key and the `e2e` account. The acceptance test key is stored in the macOS keychain,
service `fpgasim-e2e-prod`: the server stores only the SHA-256 of the key, so you cannot get the key
a second time. If the entry is missing or the server answers 401, the author issues a new key
straight into the keychain (the key is not printed to the screen):

```
security add-generic-password -U -a "$USER" -s fpgasim-e2e-prod -w "$(ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin key add <name>')"
```

Besides the key, the tests need the `e2e` account on the production server. Its password is stored
in the macOS keychain, service `fpgasim-e2e-prod-user`, next to the key's service
`fpgasim-e2e-prod`. If the entry is missing, the author creates the account and puts the password
straight into the keychain:

```
security add-generic-password -U -a "$USER" -s fpgasim-e2e-prod-user -w "$(ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin user add e2e')"
```

If the account exists but the password is lost, run `user passwd e2e` instead of `user add e2e`.

Run (the account tests are in `e2e/prod/accounts.spec.ts`; without the account variables they are
skipped, and only the key tests run):

```
FPGASIM_KEY="$(security find-generic-password -s fpgasim-e2e-prod -w)" \
FPGASIM_USER_LOGIN=e2e \
FPGASIM_USER_PASSWORD="$(security find-generic-password -s fpgasim-e2e-prod-user -w)" \
make e2e-prod
```

The account test signs in as `e2e` in two browser contexts, creates a project, checks it in the
second context, edits it and deletes it. It first moves projects left over from an interrupted run
to the trash.

The tests in `e2e/prod/` run in Chromium against the production URLs: static headers, build,
testbench, four simultaneous sessions, all lessons 2–10 with their `expect.json`. The measurement of
build time and speed per lesson is written to `.fpgasim/prod-lessons.json`. One test:
`make e2e-prod E2E_ARGS="-g blink3"`.
