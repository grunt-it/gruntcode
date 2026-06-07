/** Scenario definitions for the eval runner. */

export interface ScenarioDef {
  id: string
  projectName: string
  templateDir: string
  /** Branch to checkout on the template */
  templateBranch: string
  /** The task prompt given to the model */
  prompt: string
  /** Files that MUST exist in the output */
  requiredFiles: string[]
  /** Directories that MUST exist */
  requiredDirs: string[]
  /** File glob patterns where conventions should be checked */
  conventionFiles: string[]
  /** Conventions to grep for (pattern -> description) */
  conventions: Record<string, string>
  /** Anti-conventions to detect (grep patterns that should NOT match) */
  antiConventions: Record<string, string>
  /** Brand files that must exist */
  brandFiles: string[]
  /** Whether to attempt `bun run build` */
  checkBuild: boolean
  /** Whether to run PageSpeed (website only) */
  checkPagespeed: boolean
}

export const scenarios: Record<string, ScenarioDef> = {
  website: {
    id: "website",
    projectName: "Vrtnar.si",
    templateDir: "website-template",
    templateBranch: "main",
    prompt: `Write files for a SvelteKit site "Vrtnar.si". Do NOT read or explore the project. Write every file in the FIRST tool call.

Files to write NOW (all at once using the write tool):
1. src/routes/+page.svelte — Home page with: hero section ("Vrtnar.si — strokovno urejanje vrtov"), features grid (3 cards: košnja trave, obrezovanje drevja, urejanje vrtov), CTA button "Pridobite ponudbo", scroll-reveal animation on sections
2. src/routes/storitve/+page.svelte — Services with pricing table
3. src/routes/o-nas/+page.svelte — About page
4. src/routes/kontakt/+page.svelte — Contact form with Valibot validation
5. src/routes/impressum/+page.svelte and src/routes/pravilnik-zasebnosti/+page.svelte
6. static/logo.svg — a simple SVG leaf icon
7. static/favicon.svg — same leaf icon
8. src/app.css — set CSS variables with green HSL values: --primary (142 76% 36%), --secondary (142 60% 65%), etc.

Stack: Tailwind v4, Paraglide i18n (messages/sl.json + messages/en.json), adapters-cloudflare, Umami proxy at api/script.js and api/send. Use $state runes, no stores.`,
    requiredFiles: [
      "src/routes/+page.svelte",
      "src/routes/+layout.svelte",
      "src/routes/+layout.ts",
      "src/routes/+layout.server.ts",
      "src/routes/Header.svelte",
      "src/routes/Footer.svelte",
      "src/routes/robots.txt/+server.ts",
      "src/app.html",
      "src/app.css",
      "src/hooks.server.ts",
      "package.json",
      "svelte.config.js",
      "vite.config.ts",
      "wrangler.jsonc",
      "messages/en.json",
      "messages/sl.json",
      "static/favicon.svg",
      "static/logo.svg",
    ],
    requiredDirs: [
      "src/routes/api/script.js",
      "src/routes/api/send",
    ],
    conventionFiles: ["src/**/*.{svelte,ts}"],
    conventions: {
      "\\$state": "uses Svelte 5 runes ($state)",
      "\\$derived": "uses $derived rune",
      "\\$effect": "uses $effect rune",
      "paraglide": "uses Paraglide i18n",
      "mode-watcher": "uses mode-watcher dark mode",
      "@unpic/svelte": "uses @unpic/svelte images",
      "modeWatcher": "uses mode-watcher import",
      "superValidate": "uses Superforms validation",
      "valibot": "uses Valibot validation",
      "adapter-cloudflare": "uses Cloudflare adapter",
      "bits-ui": "uses bits-ui components",
    },
    antiConventions: {
      "\\bstore\\b": "should not use Svelte stores",
      "writable\\(": "should not use writable stores",
      "\\$store": "should not use $store syntax",
    },
    brandFiles: [
      "static/logo.svg",
      "static/favicon.svg",
      "static/favicon.ico",
      "site.webmanifest",
    ],
    checkBuild: true,
    checkPagespeed: true,
  },

  vetapp: {
    id: "vetapp",
    projectName: "VetApp",
    templateDir: "app-template",
    templateBranch: "main",
    prompt: `Create a SvelteKit application "VetApp" — veterinary practice management.

Entities (model → service → remote → controller):
- Patient: id, name, species (dog/cat/other), breed, birthDate, ownerName, ownerEmail, ownerPhone
- Appointment: id, patientId, date, time, duration, reason, status (scheduled/completed/cancelled), notes
- MedicalRecord: id, patientId, date, diagnosis, treatment, medications, followUpDate

Auth: better-auth email/password. Roles: admin (vet), member (receptionist), user (pet owner).

Routes:
- / landing, /login, /signup
- /patients CRUD
- /appointments calendar view, create, reschedule, cancel
- /appointments/book public booking form
- /medical-records/:patientId history
- /admin dashboard
- /api/* Hono REST API

Stack:
- Effect.gen (v3) with run/runSafe wrappers
- Kysely snake_case migrations, camelCase runtime
- Entity pattern: .model.ts (Valibot), .service.ts (Effect), .remote.ts (Remote Function), .controller.ts
- Hono at /api with typed router, field-level errors
- Superforms + Valibot, saveForm pattern
- shadcn-svelte UI, Paraglide sl/en
- Svelte 5 runes — no stores
- Inferred types — no explicit annotations
- No code comments
- Run migrations: bun run db:migrate
- Build must pass: bun run build

Brand: Generate a vet-related brand mark, extract colors to shadcn CSS vars, logo in static/, favicon, sidebar and login page.`,
    requiredFiles: [
      "src/app.html",
      "src/app.css",
      "src/hooks.server.ts",
      "src/worker.ts",
      "package.json",
      "svelte.config.js",
      "vite.config.ts",
      "src/lib/api/router.ts",
    ],
    requiredDirs: [
      "src/lib/entities",
      "src/routes/(auth)/login",
      "src/routes/(auth)/signup",
    ],
    conventionFiles: ["src/**/*.{svelte,ts}", "!src/**/*.d.ts"],
    conventions: {
      "Effect\\.gen": "uses Effect.gen for server logic",
      "run\\(": "uses run wrapper",
      "runSafe": "uses runSafe wrapper",
      "Hono": "uses Hono API framework",
      "Kysely": "uses Kysely database",
      "better-auth": "uses better-auth",
      "superValidate": "uses Superforms",
      "valibot": "uses Valibot validation",
      "\\$state": "uses Svelte 5 runes",
      "adapter-cloudflare": "uses CF adapter",
    },
    antiConventions: {
      "\\bstore\\b": "should not use Svelte stores",
      "writable\\(": "should not use writable stores",
    },
    brandFiles: [
      "static/logo.svg",
      "static/favicon.svg",
      "site.webmanifest",
    ],
    checkBuild: true,
    checkPagespeed: false,
  },

  malikuhar: {
    id: "malikuhar",
    projectName: "MaliKuhar",
    templateDir: "app-template",
    templateBranch: "coolify-coolster",
    prompt: `Create a SvelteKit app "MaliKuhar" — restaurant management for Slovenian family-run gostilne.

Entities:
- MenuItem: name(sl), name(en), category (juhe/glavne-jedi/sladice/pijace), price, description, dailySpecial, available
- Order: tableNumber, items, status (pending/preparing/served/paid), total, createdAt
- Reservation: customerName, phone, date, time, partySize, status (confirmed/cancelled/completed), notes
- DailyMenu: date, soupId, mainCourseIds[], dessertId, price

Routes:
- / menu with daily specials, category browsing
- /orders active orders, status transitions
- /orders/new waiter entry by table
- /reservations calendar, new booking
- /admin menu CRUD, daily menu, reservations
- /api/* Hono API

Deployment: dockerimage via coolster, CF Tunnel, direct Postgres, no Hyperdrive, no wrangler.jsonc.

Stack: Effect.gen, runes, Valibot, shadcn, Hono, Paraglide, inferred types, no comments.

Brand: Chef hat / cooking mark, warm orange shadcn vars, static/logo, favicon, sidebar + login. Build must pass.`,
    requiredFiles: [
      "src/app.html",
      "src/app.css",
      "src/hooks.server.ts",
      "package.json",
      "svelte.config.js",
      "vite.config.ts",
      "coolster.jsonc",
      "src/lib/api/router.ts",
    ],
    requiredDirs: [
      "src/routes/api",
    ],
    conventionFiles: ["src/**/*.{svelte,ts}", "!src/**/*.d.ts"],
    conventions: {
      "Effect\\.gen": "uses Effect.gen for server logic",
      "Hono": "uses Hono API framework",
      "\\$state": "uses Svelte 5 runes",
      "valibot": "uses Valibot validation",
      "superValidate": "uses Superforms",
      "dockerimage": "uses dockerimage deployment mode",
      "coolster": "uses Coolster deployment",
    },
    antiConventions: {
      "wrangler\\.jsonc": "should not use wrangler.jsonc in dockerimage mode",
    },
    brandFiles: [
      "static/logo.svg",
      "static/favicon.svg",
      "site.webmanifest",
    ],
    checkBuild: true,
    checkPagespeed: false,
  },

  kolesar: {
    id: "kolesar",
    projectName: "Kolesar",
    templateDir: "app-template",
    templateBranch: "workers",
    prompt: `Create a SvelteKit app "Kolesar" — bike repair shop tracker.

Entities:
- Customer: name, email, phone, bikes [{brand, model, year, color, frameNumber}]
- RepairJob: customerId, bikeIndex, issue, status (received/in-progress/done/collected), technician, costEstimate, costActual, notes, createdAt, completedAt
- Part: name, stockQuantity, minStockAlert, supplier, unitPrice

Routes:
- / dashboard — jobs by status, low stock alerts
- /customers list, add/edit, job history
- /repairs list with filters, create, update status, mark collected
- /parts inventory, stock alerts
- /api/* Hono API

Persistence: D1 (no Postgres, no Hyperdrive, no coolster.jsonc).
Auth: basic (simple, no complex roles).

Stack: Effect.gen, runes, Valibot, shadcn, Hono, Paraglide, inferred types, no comments.

Brand: Chainring / wrench mark, blue shadcn vars, static/logo, favicon. Build must pass.`,
    requiredFiles: [
      "src/app.html",
      "src/app.css",
      "src/hooks.server.ts",
      "package.json",
      "svelte.config.js",
      "vite.config.ts",
      "wrangler.jsonc",
      "src/lib/api/router.ts",
    ],
    requiredDirs: [
      "src/routes/api",
    ],
    conventionFiles: ["src/**/*.{svelte,ts}", "!src/**/*.d.ts"],
    conventions: {
      "Effect\\.gen": "uses Effect.gen for server logic",
      "Hono": "uses Hono API framework",
      "\\$state": "uses Svelte 5 runes",
      "valibot": "uses Valibot validation",
      "D1": "uses D1 database",
    },
    antiConventions: {
      "coolster": "should not use coolster in D1 mode",
      "Hyperdrive": "should not use Hyperdrive in D1 mode",
    },
    brandFiles: [
      "static/logo.svg",
      "static/favicon.svg",
      "site.webmanifest",
    ],
    checkBuild: true,
    checkPagespeed: false,
  },
}
