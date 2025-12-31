# Schemaful Cloud

Managed headless CMS service built on [Schemaful](https://github.com/schemaful/schemaful).

## Repository Structure

```
schemaful-cloud/
├── apps/cloud/          # Cloud dashboard (Vike + React)
├── infrastructure/      # Terraform, K8s configs (future)
└── scripts/             # Deployment scripts (future)
```

## Related Repositories

| Repository | Purpose | License |
|------------|---------|---------|
| [schemaful](../schemaful) | OSS core (cms, trpc, ui) | Apache 2.0 |
| [schemaful-ee](../schemaful-ee) | EE modules (auth, billing, limits) | Proprietary |
| schemaful-cloud (this) | Cloud service deployment | Proprietary |

## Local Development

```bash
# Clone all three repos
git clone https://github.com/schemaful/schemaful ../schemaful
git clone https://github.com/schemaful/schemaful-ee ../schemaful-ee

# Install dependencies (will link all packages)
pnpm install

# Start cloud dev server
pnpm dev
```

## Environment Variables

See `apps/cloud/.env.example` for required configuration.

## Vercel Deployment

This repo requires access to sibling repositories during build.

### Setup

1. **Create a GitHub Personal Access Token** with `repo` scope at https://github.com/settings/tokens

2. **Add environment variables in Vercel** (Project Settings > Environment Variables):
   - `GITHUB_TOKEN` - Your GitHub PAT (for cloning private schemaful-ee repo)
   - `DATABASE_URL` - Neon PostgreSQL connection string
   - `AUTH_SECRET` - Generate with: `openssl rand -base64 32`
   - Plus any optional vars from `.env.example`

3. **Deploy** - Push to main branch or trigger via Vercel dashboard

### How it works

The `vercel.json` install command clones the sibling repos before running `pnpm install`:
- `schemaful` (public) - OSS core packages
- `schemaful-ee` (private) - Enterprise modules (requires GITHUB_TOKEN)

This allows pnpm workspace links (`../schemaful/*`, `../schemaful-ee/*`) to resolve correctly.
