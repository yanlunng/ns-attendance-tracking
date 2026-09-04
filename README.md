# Daily Attendance

Web app that seeds a nominal roll from an uploaded Excel sheet, then lets
multiple logged-in people independently mark who is Present / Off / Leave
each day. A merged Summary view combines everyone's submissions and flags any
disagreements as conflicts, and the whole day's result can be exported back
to Excel.

## How it works

- **Roster (admin only)**: upload an `.xlsx`/`.xls` file with a header row.
  A `Name` column is required (or `Full Name` / `Personnel` / `Nominal Roll`).
  Optional `ID`/`Rank`/`Staff ID` and `Unit`/`Department` columns are mapped
  specially; any other columns are kept as extra data per person.
- **Mark Attendance**: every logged-in user gets their own independent form
  for a given date, defaulting everyone to Present. Each user's submission is
  stored separately — nobody overwrites anyone else's answer.
- **Summary**: merges all submissions for a date. If everyone agrees on a
  person's status it shows the agreed status; if submitters disagree it's
  flagged as a **Conflict** with each person's answer listed so it can be
  resolved by discussion.
- **Export**: downloads the day's merged summary (including conflict/details
  columns) as an Excel file.
- **Users (admin only)**: create additional accounts (`user` or `admin` role).
  Only admins can upload rosters and manage users.

## Local setup

```bash
cd attendance-app
npm install
cp .env.example .env   # edit ADMIN_USERNAME / ADMIN_PASSWORD / SESSION_SECRET
npm start
```

Visit `http://localhost:3000`. On first run, an admin account is created
automatically from `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env` (defaults to
`admin`/`admin` if unset — **change this before exposing the app to anyone**).
Log in as admin, upload the roster under **Roster**, then create accounts for
everyone else under **Users**.

Data is stored in `data/attendance.db` (SQLite). Back that file up; it's the
only durable state (`.gitignore` already excludes it from version control).

## Deploying to a small always-on server

Any host that can run a long-lived Node process or Docker container works —
a small VPS, or a container platform (Fly.io, Render, Railway, etc.).

### Option A: Docker

```bash
docker build -t attendance-app .
docker run -d \
  --name attendance-app \
  -p 3000:3000 \
  -e SESSION_SECRET=<long-random-string> \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=<strong-password> \
  -v attendance-data:/app/data \
  --restart unless-stopped \
  attendance-app
```

The `-v attendance-data:/app/data` volume keeps the SQLite database across
container restarts/upgrades — don't skip it.

Put a reverse proxy (nginx / Caddy / the platform's built-in one) in front
for HTTPS if this will be reachable outside a trusted LAN, since login
posts a plaintext password over the connection.

### Deploying to Google Cloud (Compute Engine)

Cloud Run doesn't fit this app as-is: Cloud Run instances have no persistent
local disk and can run multiple copies at once, and this app's data lives in
a single SQLite file. A small always-on Compute Engine VM avoids that problem
entirely — it's just the generic Docker setup above, running on a GCP VM with
a persistent disk.

`deploy/gcp-deploy.sh` automates the whole thing (enable APIs, push the image
to Artifact Registry, create the VM, open the firewall, run the container).
Run it from **Google Cloud Shell** (has `gcloud`/`docker` preinstalled) from
inside this directory:

```bash
export PROJECT_ID=<your-gcp-project-id>
export SESSION_SECRET=$(openssl rand -hex 32)
export ADMIN_PASSWORD=<a-strong-password>
./deploy/gcp-deploy.sh
```

It prints the VM's external IP when done. Re-running it is safe — steps that
already exist (repo, VM, firewall rule) just get skipped.

The `attendance-data` Docker volume lives on the VM's boot disk, so the
SQLite database survives container restarts. It does **not** survive
deleting the VM — if you ever recreate the instance, snapshot the disk first
(`gcloud compute disks snapshot`) or copy `data/attendance.db` off it.

For HTTPS, put this behind a GCP HTTPS Load Balancer (with a managed
certificate) pointed at the VM, or let the deploy script do it for you: get a
domain pointed at the VM's external IP (a free one from DuckDNS works fine —
no purchase needed) and pass it as `DOMAIN`:

```bash
export DOMAIN=your-subdomain.duckdns.org   # must already resolve to the VM's IP
./deploy/gcp-deploy.sh
```

This runs [Caddy](https://caddyserver.com/) as a reverse proxy in front of
the app, which automatically issues and renews a real Let's Encrypt
certificate — no manual cert management. Leave `DOMAIN` unset to keep
serving plain HTTP on the bare IP, as before. Don't expose port 80 with
plaintext logins beyond a trusted network until `DOMAIN` is set.

### Option B: plain VPS with a process manager

```bash
npm install --omit=dev
npm install -g pm2
pm2 start src/server.js --name attendance-app
pm2 save
pm2 startup   # follow the printed instructions to survive reboots
```

Set `PORT`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` as real
environment variables (or via a `.env` file) before starting.

## Notes / limitations

- Sessions are kept in memory, so restarting the process logs everyone out
  (they just log back in — no data is lost, since attendance is stored in
  SQLite, not in the session).
- There's no self-service password reset; an admin recreates a user's
  account (delete + re-add) if a password is forgotten.
- Roster upload's "Replace" mode deactivates the old roster (soft-delete) so
  historical attendance rows tied to it are preserved; "Append" adds to the
  existing active roster without touching it.
