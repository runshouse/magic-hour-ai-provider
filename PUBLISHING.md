# How to ship this

Four steps. About an hour total, most of it waiting on the PR.

## 1. Test it against your real key (5 min)

```bash
npm install
export MAGIC_HOUR_API_KEY="your_key"
npx tsx examples/text-to-video.ts
```

That runs wan-2.2 at 480p for 5 seconds — 120 credits, inside the free tier's
400. You should get `out.mp4`.

If it fails, the error message says what the API actually rejected. Fix it here
before publishing, not after.

## 2. Push to GitHub (5 min)

Repo's already committed locally. Create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/RhythmP28/magic-hour-ai-provider.git
git branch -M main
git push -u origin main
```

**Better idea:** put this under Magic Hour's GitHub org instead of your personal
account. Vercel links to the repo from their docs, so it should look like the
company owns it. Ask whoever runs the org.

## 3. Publish to npm (10 min)

The name `magic-hour-ai-provider` is free right now. Check it's still free:

```bash
npm view magic-hour-ai-provider
```

"404 Not Found" means yes.

```bash
npm login
npm publish
```

If Magic Hour has an npm org, publish as `@magichour/ai-sdk-provider` instead —
change `name` in `package.json` first, and the install line in `README.md` and
`docs/55-magic-hour.mdx`.

## 4. PR the docs page into vercel/ai (30 min)

This is the step that gets you listed at
ai-sdk.dev/providers/community-providers.

```bash
gh repo fork vercel/ai --clone
cd ai
cp /path/to/magic-hour-ai-provider/docs/55-magic-hour.mdx \
   content/providers/05-community-providers/55-magic-hour.mdx
```

Check the number first — if a `55-*.mdx` already exists, rename to the next
free number.

They require **signed commits**, so set that up before committing or the PR
can't be merged:

```bash
git checkout -b docs/magic-hour-provider
git add content/providers/05-community-providers/55-magic-hour.mdx
git commit -S -m "docs: add Magic Hour community provider"
git push -u origin docs/magic-hour-provider
gh pr create --repo vercel/ai \
  --title "docs: add Magic Hour community provider" \
  --body "Adds documentation for magic-hour-ai-provider, a community provider for Magic Hour's video and image generation API.

Implements the VideoModelV4 spec using the async doStart/doStatus flow, covering text-to-video and image-to-video across 13 models (Sora 2, Veo 3.1, Kling 3.0, Seedance, MiniMax H3, WAN 2.2, LTX 2.3), plus ImageModelV4 for Magic Hour's hosted image models.

- npm: https://www.npmjs.com/package/magic-hour-ai-provider
- source: https://github.com/RhythmP28/magic-hour-ai-provider"
```

No changeset needed — docs-only PRs are exempt.

## After it merges

Magic Hour shows up on the community providers page. Two follow-ups worth
doing:

1. Link to the AI SDK page from `docs.magichour.ai`. Bi-directional links are
   what make integration listings rank.
2. Post it. "Magic Hour now works with the Vercel AI SDK" is a real launch —
   the AI SDK Discord, the Next.js subreddit, and Magic Hour's own changelog.

## Keeping it current

The model table lives in `src/magic-hour-models.ts`. When Magic Hour ships a
model, add a row there and to the tables in `README.md` and
`docs/55-magic-hour.mdx`, then `npm version patch && npm publish`.

Unknown model IDs already pass through with a warning, so the package doesn't
break when it falls behind — it just stops correcting durations for the new
model.
