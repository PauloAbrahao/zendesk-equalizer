# Zendesk Equalizer

Web tool to **sync configuration between Zendesk environments** (e.g. sandbox → staging → production).

Pick a source and a target environment, choose what to migrate (groups, ticket fields, ticket forms, triggers, automations), and review a GitHub-style diff of every item before applying. Items are matched by title/name, and IDs referenced across instances (fields, forms, groups) are remapped automatically. Nothing is ever deleted, and writes to production require typing the environment name to confirm.

Stack: Vue 3 + Vite frontend, Node.js + Express backend, TypeScript throughout, Zendesk REST API v2.

```
npm install
cp .env.example .env   # fill in credentials
npm run dev            # API :3001 + web :5173
npm test
```

Full documentation (in Portuguese): [PROJETO.md](PROJETO.md).
