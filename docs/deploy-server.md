# Build server deployment

The build server runs on a VPS (in the author's deployment, a host shared with the author's other
services). Decisions are in `docs/decisions.md`, items 30, 31, 40, 41 and 173.

## Site settings

The repository holds no host names (decision 173). The addresses and hosts of one deployment are in
the site settings file `~/.config/fpgasim/site.env` (another path: `FPGASIM_SITE_ENV`); the format and
the keys are in `deploy/site.env.example`. The Makefile and the scripts in `deploy/` read it.
In the author's deployment: interface `https://fpga-sim.scriptorium.cc`, build server
`https://fpga-build.scriptorium.cc`, SSH host `fpga-build`. The commands below use these values;
for another deployment, replace them with your own.

## What lives where on the VPS

| Path | What it is |
|---|---|
| `/opt/fpgasim` | Copy of the repository (the `HEAD` state of the last deployment) |
| `/etc/fpgasim/keys.toml` | Keys: owner name → SHA-256 of the key. Written by `fpgasim-admin` |
| `/etc/fpgasim/config.toml` | The limits from spec section 8.5. The file may be absent: defaults apply |
| `/var/lib/fpgasim/cache` | Build cache |
| `/var/lib/fpgasim/jobs` | Job folders; removed after the job |
| `/var/lib/fpgasim/deploy` | The `releases` deployment log, `compose.env`, `site.env` (CORS origins and backup bucket, written by `make deploy-server` from the site settings), image build logs |
| `/var/lib/fpgasim/testbench` | Waveforms of testbench runs; kept for one hour |
| `/var/lib/fpgasim/bench` | Working folder of the stage 0 measurement (`make bench-vps`); the service does not need it |
| `/var/lib/fpgasim/accounts/accounts.db` | SQLite database: accounts, sessions, "in browser" projects (`docs/tz-accounts.md`, section 2.1). The folder is 700, the file is 600: the database holds password hashes |
| `/var/lib/fpgasim/backup` | Daily database copies `accounts-<YYYYMMDD>.db`, the last 14. The folder is 700 |

The Compose project is called `fpgasim`. It has one container, `fpgasim-api-1`. It listens only on
`127.0.0.1:8090`. Images: `fpgasim-tools:*`, `fpgasim-build:*`, `fpgasim-api:*`.

## Deployment

On the Mac, from the repository root, on the branch you want to deploy:

```
make deploy-server
```

The script `deploy/deploy.sh` sends the `HEAD` state to the VPS, builds the images there, restarts
the service and checks `/v1/health` first on the VPS, then at the external address. The first build
of the tools image takes about half an hour (Verilator from source). Later deployments take about
a minute.

Roll back to the previous deployment:

```
deploy/rollback.sh
```

Status:

```
ssh fpga-build 'cd /opt/fpgasim && deploy/remote.sh status'
```

## The accounts database and its copies

`deploy/remote.sh` creates the folders `/var/lib/fpgasim/accounts` and `/var/lib/fpgasim/backup`
during deployment. The service itself creates the database at startup. Decisions: items 118, 123,
124 and 128.

The service itself writes the daily copies on the VPS, without cron. A task inside the service
checks once an hour: if there is no copy for the current day (UTC), it writes
`accounts-<YYYYMMDD>.db` with SQLite tools and deletes copies older than the last fourteen. The
first check runs right when the service starts. A failed copy goes to the service log as a line
with `"op": "backup"` and does not stop the service.

### Copy in R2

Once a day, the cron job of the SSH user on the VPS sends the latest copy to Cloudflare R2
(decision 160):

```
50 3 * * * /opt/fpgasim/deploy/offsite-r2.sh >> /var/lib/fpgasim/deploy/offsite-r2.log 2>&1
```

The bucket is `FPGASIM_BACKUP_BUCKET` from the site settings (`make deploy-server` puts it into
`/var/lib/fpgasim/deploy/site.env`; in the author's deployment it is `hermes-backups`, shared with another
service of the host). The token is the rclone profile `[backups]` in `~/.config/rclone/rclone.conf`, `rclone` in `~/bin`.
The prefix is `fpgasim/`; the script deletes copies older than 30 days. It compares the object size
in the bucket and exits with code 1 if the object is missing, the size does not match, or the
latest copy on the VPS is not from today (UTC). Log:

```
ssh fpga-build 'tail -5 /var/lib/fpgasim/deploy/offsite-r2.log'
ssh fpga-build '~/bin/rclone lsf --format sp backups:hermes-backups/fpgasim/'
```

Restore from R2: fetch the copy to the VPS, then continue as with a daily copy (below):

```
ssh fpga-build '~/bin/rclone copyto backups:hermes-backups/fpgasim/accounts-<YYYYMMDD>.db /var/lib/fpgasim/backup/accounts-<YYYYMMDD>.db'
```

### Copy on the Mac

The fallback path is manual, on the Mac, from the repository root:

```
make backup-accounts
```

The script `deploy/backup-accounts.sh` fetches the latest copy over SSH into `.fpgasim/backup/`
(folder 700, file 600; not stored in Git) and checks that the result is a SQLite file. On the VPS it
only reads. The service writes the copy as `root` with mode 600, so a one-off container of the same
image reads the file (decision 159); the service may be stopped meanwhile. Checked from the VPS on
2026-11-20.

### Restoring the database from a copy

You need a restore when the database is corrupted or something needed was deleted from it. Not
checked on the VPS.

1. Stop the service:

   ```
   ssh fpga-build 'cd /opt/fpgasim && docker compose --env-file /var/lib/fpgasim/deploy/compose.env -f deploy/compose.yaml down'
   ```

2. List the copies and restore the one you need. The command goes through `deploy/fpgasim-admin`:
   for `db …` it starts a one-off container instead of entering the running one:

   ```
   ssh fpga-build 'ls -l /var/lib/fpgasim/backup'
   ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin db restore /var/lib/fpgasim/backup/accounts-<YYYYMMDD>.db'
   ```

   The utility checks that the file is a database of this schema. If it is not, the utility
   refuses, and the database stays as it was. The old database is not deleted: it stays next to the
   new one as `/var/lib/fpgasim/accounts/accounts-before-restore-<YYYYMMDD-hhmmss>.db`. The author
   removes these files.

3. Start the service and check it:

   ```
   ssh fpga-build 'cd /opt/fpgasim && docker compose --env-file /var/lib/fpgasim/deploy/compose.env -f deploy/compose.yaml up -d --remove-orphans'
   curl https://fpga-build.scriptorium.cc/v1/health
   ```

What happens after the restore:

- The database gets a new generation (`docs/tz-accounts.md`, section 2.1).
- Sessions are deleted: all users sign in again.
- Browsers see the new generation and send their projects again (section 4.4, item 7, same
  document). The server accepts files that match the copy or are absent from it. Files that differ
  reach the user as a conflict: the user chooses a version.
- Account changes made after the copy (new accounts, passwords, disabled accounts) are lost.
  Projects that are not in the users' browsers return to the state of the copy.

Before the restore, put a copy from the Mac (`.fpgasim/backup/`) on the VPS in
`/var/lib/fpgasim/backup/`: the container sees only VPS folders.

## External address: nginx and certificate

The system nginx holds ports 80 and 443 on the VPS. In the author's deployment, the owner installed the vhost
`fpga-build.scriptorium.cc` and the certificate on 2026-11-18: a Cloudflare Origin certificate in
`/etc/ssl/cloudflare/fpga-build.scriptorium.cc.pem` (the key is next to it, `.key`), and the DNS
record in Proxied mode, like the host's two other sites. The vhost source is the example
`deploy/nginx-build.conf.example`: replace `build.example.org` with the build server host.

Check:

```
curl https://fpga-build.scriptorium.cc/v1/health
```

Expected response: `{"status":"ok"}`.

Deployment does not update the vhost on the VPS. If the file in the repository changed, the owner
installs it (root is required; on the VPS `sudo` asks for a password, so the command runs in a
separate terminal):

```
ssh -t fpga-build 'sed s/build.example.org/fpga-build.scriptorium.cc/g /opt/fpgasim/deploy/nginx-build.conf.example | sudo tee /etc/nginx/sites-available/fpga-build.scriptorium.cc > /dev/null && sudo nginx -t && sudo systemctl reload nginx'
```

This command was written on 2026-11-22 when the vhost file became an example (decision 173) and was
not run: the vhost on the VPS did not change.

`nginx -t` is required before reloading the configuration: on an error the `reload` does not run,
and the host's other sites keep working with the old configuration. The agent did not check this
command: it has no root access.

In Proxied mode, Cloudflare waits for a response for at most 100 s. A build request that waited in
the queue for the full 60 s may not fit; the client gets 524 and repeats the build. If this becomes
a problem, reduce `queue_seconds` in `/etc/fpgasim/config.toml` to 30.

The Origin certificate has an expiry date; check the date in the Cloudflare panel. It is not visible
from outside: the client receives the Cloudflare edge certificate.

## Keys

A key is what the interface and scripts send to the server in the header
`Authorization: Bearer <key>`. Without a key, only `/v1/health` responds. The key is printed once;
the server stores only its SHA-256. You cannot recover a key, only issue a new one with a different
name. `key list` shows which keys are issued and enabled.

```
ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin key add taras'
```

Disable a key and view the list:

```
ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin key disable taras'
ssh fpga-build '/opt/fpgasim/deploy/fpgasim-admin key list'
```

These commands do not need root: the utility runs inside the service container. Scripts need keys:
acceptance tests and measurements. People sign in with a login and password: the administrator
creates accounts on the "Users" page (`docs/deploy-web.md`, section "Users").

The key `judges` gives hackathon judges access without an account (decision 171). It was issued on
2026-11-22 and is stored in the macOS keychain, service `fpgasim-judges`. Link for the submission
form: `https://fpga-sim.scriptorium.cc/?lang=en#key=<key>`. After the judging ends (Cognizant:
2027-01-18), disable the key: `key disable judges`.

## Checking a build on the VPS

The key is passed through an environment variable. It stays out of the shell history if the command
starts with a space:

```
 FPGASIM_KEY=<key> node tools/headless/run.mjs --server https://fpga-build.scriptorium.cc examples/blink3
```

The command builds `blink3` on the server in two visibility modes, loads the core into Node and
compares the result with `examples/blink3/expect.json`. The result line shows the build time on the
server.
