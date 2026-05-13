# Website Builder Agent

🚀 AI-powered SEO website builder using Claude APIs. Create beautiful, indexable websites with natural language.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Supabase project
- Anthropic API key
- Cloudflare R2 bucket
- GitHub account

### Setup

1. **Clone and install**

```bash
git clone https://github.com/Factulista/website-builder-agent.git
cd website-builder-agent
pnpm install
```

2. **Setup Supabase**

- Go to https://supabase.com and create a project (Region: EU)
- Copy your project URL and service key
- Go to SQL Editor and paste the contents of `apps/api/migrations/001_initial_schema.sql`
- Run the SQL to create tables

3. **Configure environment variables**

**Backend** (`apps/api/.env`):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
ANTHROPIC_API_KEY=sk-ant-xxxxx
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_BUCKET=website-builder-agent
R2_ACCESS_KEY_ID=your-key
R2_SECRET_ACCESS_KEY=your-secret
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

**Frontend** (`apps/web/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:3001
```

4. **Run locally**

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Next.js 15 + React 19 | Web UI, chat interface |
| **Backend** | Fastify + TypeScript | API, agent orchestration |
| **Database** | Supabase (PostgreSQL) | Projects, conversations, files metadata |
| **Storage** | Cloudflare R2 | Website files (HTML, CSS) |
| **AI** | Anthropic Claude | Content, HTML, SEO generation |
| **Preview** | Cloudflare Workers | Serve generated websites |

## Features (MVP v0.1)

**Implemented:**
- ✅ User authentication (Supabase Auth)
- ✅ Project creation & management
- ✅ Real-time chat with SSE streaming
- ✅ AI-powered page generation (Content + HTML + SEO agents)
- ✅ Live preview in split pane
- ✅ SEO scoring (0-100)
- ✅ File explorer
- ✅ Semantic HTML5 with Pico CSS

**Coming Soon (v0.2+):**
- 🔄 Custom domain setup
- 🔄 Production deployment
- 🔄 Design customization (colors, fonts)
- 🔄 Image optimization
- 🔄 Advanced analytics
- 🔄 Multi-page site support

## Project Structure

```
website-builder-agent/
├── apps/
│   ├── web/              # Next.js frontend
│   │   ├── app/         # App router pages
│   │   ├── components/  # React components
│   │   └── ...
│   └── api/              # Fastify backend
│       ├── src/
│       │   ├── server.ts          # Entry point
│       │   ├── routes/            # API routes
│       │   ├── agents/            # Claude agents
│       │   ├── services/          # Supabase, Storage, Claude
│       │   ├── types/             # TypeScript types
│       │   └── migrations/        # Database schemas
│       └── ...
├── packages/
│   └── shared/           # Shared types & utils
└── turbo.json            # Monorepo config
```

## Development

```bash
# Start all services
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Format code
pnpm lint
```

## Deployment

### Frontend (Vercel)

```bash
pnpm build
vercel deploy
```

### Backend (Railway)

1. Push to GitHub
2. Connect Railway to your GitHub repo
3. Set environment variables
4. Deploy automatically

### Database (Supabase)

Migrations run automatically on Supabase SQL Editor.

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/auth/signup` | User registration |
| `POST` | `/auth/login` | User login |
| `POST` | `/projects` | Create project |
| `GET` | `/projects/:id` | Get project |
| `POST` | `/projects/:id/conversations` | Create conversation |
| `POST` | `/conversations/:id/messages` | Send message (async) |
| `GET` | `/runs/:id/stream` | SSE event stream |

## Contributing

1. Create a feature branch
2. Make your changes
3. Submit a pull request

## License

MIT

## Support

For issues, questions, or feedback: https://github.com/Factulista/website-builder-agent/issues
