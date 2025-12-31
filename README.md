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
