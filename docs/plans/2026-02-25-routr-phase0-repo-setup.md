# Phase 0: Repo Setup & Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip saphe-reverse to backend-only, create routr repo with git subtree, move web POC, set up project structure.

**Architecture:** Two repos — saphe-reverse (backend standalone) and routr (monorepo with app, web, backend subtree). Routr uses git subtree to embed saphe-reverse.

**Tech Stack:** Git, Docker, Bun

---

### Task 1: Strip saphe-reverse — remove frontend

**Files:**
- Delete: `frontend/` directory
- Modify: `package.json` (remove frontend dev script)

**Step 1: Remove frontend directory**

```bash
cd /Users/milo/milodev/gits/saphe-reverse
rm -rf frontend/
```

**Step 2: Update package.json scripts**

Replace the `dev` script that starts both frontend and backend with backend-only:

```json
{
  "scripts": {
    "start": "bun run backend/server.ts",
    "dev": "bun --watch run backend/server.ts"
  }
}
```

**Step 3: Verify backend still starts**

Run: `bun run dev`
Expected: Server starts on port 3456, logs `Saphe POI Explorer: http://localhost:3456`
Kill the server after verifying.

**Step 4: Commit**

```bash
git add -A
git commit -m "Strip frontend, backend-only repo"
```

---

### Task 2: Create Dockerfile for saphe-reverse

**Files:**
- Create: `Dockerfile`

**Step 1: Write the Dockerfile**

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/ ./backend/
COPY proto/ ./proto/
COPY index.ts ./

EXPOSE 3456
CMD ["bun", "run", "backend/server.ts"]
```

**Step 2: Create .dockerignore**

```
node_modules
.tokens.json
.accounts.jsonl
decompiled/
apk/
docs/
.git
```

**Step 3: Verify Docker build succeeds**

Run: `docker build -t saphe-reverse .`
Expected: Build completes successfully

**Step 4: Verify Docker container starts**

Run: `docker run --rm -p 3456:3456 saphe-reverse &`
Then: `curl -s http://localhost:3456/api/auth/status | jq .`
Expected: `{"authenticated": false, "username": null, ...}`
Kill: `docker stop $(docker ps -q --filter ancestor=saphe-reverse)`

**Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "Add Dockerfile for saphe-reverse backend"
```

---

### Task 3: Push saphe-reverse to remote

**Step 1: Push all changes**

```bash
git push origin main
```

Expected: Push succeeds to `git@github.com:tomilodk/saphe-reverse.git`

---

### Task 4: Create routr repo and structure

**Step 1: Create routr directory**

```bash
cd /Users/milo/milodev/gits
mkdir routr
cd routr
git init
```

**Step 2: Create directory structure**

```bash
mkdir -p app backend web docs/plans
```

**Step 3: Create root package.json**

```json
{
  "name": "routr",
  "private": true,
  "scripts": {
    "dev:backend": "docker compose -f backend/docker-compose.yml up --build",
    "dev:app": "cd app && npx expo start"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules
.env
.env.local
*.tsbuildinfo
.DS_Store
.accounts.jsonl
.tokens.json

# OSRM data (large pre-processed files)
backend/osrm-data/

# Expo
app/.expo/
app/dist/

# Web build
web/dist/
```

**Step 5: Commit scaffold**

```bash
git add -A
git commit -m "Initial routr repo scaffold"
```

---

### Task 5: Add saphe-reverse as git subtree

**Step 1: Add remote and subtree**

```bash
cd /Users/milo/milodev/gits/routr
git remote add saphe-origin git@github.com:tomilodk/saphe-reverse.git
git subtree add --prefix=backend/saphe-reverse saphe-origin main --squash
```

Expected: Creates `backend/saphe-reverse/` with all saphe-reverse files, single squash commit.

**Step 2: Verify subtree contents**

```bash
ls backend/saphe-reverse/backend/
```

Expected: `accounts.ts  auth.ts  grpc-client.ts  probe.ts  server.ts`

```bash
ls backend/saphe-reverse/Dockerfile
```

Expected: File exists

---

### Task 6: Move web POC from saphe-reverse

**Step 1: Copy frontend files**

The frontend was already deleted from saphe-reverse in Task 1, but we need the files. We can get them from git history, or since we know the structure, we copy from the pre-deletion state.

```bash
cd /Users/milo/milodev/gits/routr
# Get the frontend from the commit before we deleted it
cd /Users/milo/milodev/gits/saphe-reverse
git show HEAD~2:frontend/package.json > /dev/null 2>&1 || echo "Need to check correct commit"
```

Alternative (simpler): the frontend folder may still exist in the git history. Use git archive:

```bash
cd /Users/milo/milodev/gits/saphe-reverse
git archive HEAD~2 frontend/ | tar -x -C /Users/milo/milodev/gits/routr/
mv /Users/milo/milodev/gits/routr/frontend/* /Users/milo/milodev/gits/routr/web/
rm -rf /Users/milo/milodev/gits/routr/frontend
```

If HEAD~2 doesn't have frontend, check: `git log --oneline --all` and find the last commit with frontend/.

**Step 2: Verify web POC files**

```bash
ls /Users/milo/milodev/gits/routr/web/src/
```

Expected: `api.ts  App.tsx  components/  index.css  main.tsx  poi-colors.ts  vite-env.d.ts`

**Step 3: Commit**

```bash
cd /Users/milo/milodev/gits/routr
git add web/
git commit -m "Add web POC (moved from saphe-reverse frontend, untouched)"
```

---

### Task 7: Create backend/docker-compose.yml scaffold

**Files:**
- Create: `backend/docker-compose.yml`

**Step 1: Write docker-compose with saphe service only (other services added in later phases)**

```yaml
services:
  saphe:
    build: ./saphe-reverse
    ports:
      - "3456:3456"
    volumes:
      - ./data/.accounts.jsonl:/app/.accounts.jsonl
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3456/api/auth/status"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  # osrm: added in Phase 1
  # curves-engine: added in Phase 2
```

**Step 2: Create data directory for persistent volumes**

```bash
mkdir -p backend/data
touch backend/data/.gitkeep
echo "*.jsonl" > backend/data/.gitignore
```

**Step 3: Verify docker compose builds**

```bash
cd /Users/milo/milodev/gits/routr
docker compose -f backend/docker-compose.yml build
```

Expected: saphe service builds successfully

**Step 4: Verify docker compose starts**

```bash
docker compose -f backend/docker-compose.yml up -d
sleep 3
curl -s http://localhost:3456/api/auth/status | jq .
docker compose -f backend/docker-compose.yml down
```

Expected: JSON response with `authenticated: false`

**Step 5: Commit**

```bash
git add backend/docker-compose.yml backend/data/
git commit -m "Add docker-compose scaffold with saphe service"
```

---

### Task 8: Create CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

**Step 1: Write CLAUDE.md**

```markdown
# Routr

Navigation app with rally-style curvature annotations + live Saphe POI radar.

## Repo Structure

- `app/` — React Native + Expo mobile app
- `web/` — Saphe POI web dashboard (POC, untouched)
- `backend/` — All backend services
  - `backend/docker-compose.yml` — Orchestrates all services
  - `backend/saphe-reverse/` — **Git subtree** of github.com/tomilodk/saphe-reverse
  - `backend/curves-engine/` — Routing + curvature calculation service
  - `backend/osrm-data/` — Pre-processed OSRM map data (gitignored, large)

## Git Subtree: saphe-reverse

`backend/saphe-reverse/` is a git subtree. When making changes there:

```bash
# Push saphe-reverse changes back to its own repo
git subtree push --prefix=backend/saphe-reverse saphe-origin main

# Pull latest from saphe-reverse into routr
git subtree pull --prefix=backend/saphe-reverse saphe-origin main --squash
```

Remote `saphe-origin` points to `git@github.com:tomilodk/saphe-reverse.git`.

**IMPORTANT:** After any commit that modifies files in `backend/saphe-reverse/`, also push the subtree.

## Running

```bash
# Start all backend services
docker compose -f backend/docker-compose.yml up --build

# Start the mobile app (separate terminal)
cd app && npx expo start
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| saphe | 3456 | Saphe gRPC proxy, POI data, accounts |
| osrm | 5000 | OSRM routing engine (pre-processed Denmark) |
| curves-engine | 3457 | Route curvature calculation + OSRM wrapper |

## Design Docs

- `docs/plans/2026-02-25-routr-design.md` — Full design document
- `docs/plans/2026-02-25-routr-master-plan.md` — Implementation plan
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Add CLAUDE.md with repo structure and subtree docs"
```

---

### Task 9: Set up remote and push

**Step 1: Add remote and push**

```bash
cd /Users/milo/milodev/gits/routr
git remote add origin git@github.com:tomilodk/routr.git
git branch -M main
git push -u origin main
```

Expected: Push succeeds

---

### Task 10: Verify Phase 0 complete

**Step 1: Verify saphe-reverse repo**

```bash
cd /Users/milo/milodev/gits/saphe-reverse
ls frontend/ 2>/dev/null && echo "FAIL: frontend still exists" || echo "OK: frontend removed"
docker build -t saphe-reverse . && echo "OK: Docker builds" || echo "FAIL: Docker build"
```

**Step 2: Verify routr repo**

```bash
cd /Users/milo/milodev/gits/routr
ls backend/saphe-reverse/backend/server.ts && echo "OK: subtree present"
ls web/src/App.tsx && echo "OK: web POC present"
ls backend/docker-compose.yml && echo "OK: docker-compose present"
ls CLAUDE.md && echo "OK: CLAUDE.md present"
docker compose -f backend/docker-compose.yml build && echo "OK: compose builds"
```

Expected: All checks print OK
