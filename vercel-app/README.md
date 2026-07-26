# Barkoff on Vercel

This directory is a standalone Vercel frontend for Barkoff. It keeps the
working matchmaking, signaling, Elo, and TURN infrastructure on the existing
backend while presenting the entire game through your Vercel URL.

## Deploy from the Vercel dashboard

1. Import this Git repository as a new Vercel project.
2. Set **Root Directory** to `vercel-app`.
3. Leave the detected framework as **Next.js**.
4. Deploy. No environment variables are required.

## Deploy from the command line

From the repository root:

```bash
npx vercel --cwd vercel-app
npx vercel --cwd vercel-app --prod
```

The first command links the directory and creates a preview. The second creates
the production deployment and assigns the project's production `.vercel.app`
domain.

## Architecture

The browser calls `/api/arena` on the Vercel domain. `vercel.json` rewrites
that route to the existing production backend without changing the URL shown
to players. The Metered TURN key stays server-side on that backend and is not
included in this package.
