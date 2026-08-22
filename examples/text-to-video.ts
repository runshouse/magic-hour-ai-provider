/**
 * Smoke test against the real API.
 *
 *   export MAGIC_HOUR_API_KEY=mhk_live_...
 *   npx tsx examples/text-to-video.ts
 *
 * Uses wan-2.2 at 480p, which the free tier can run: 5s x 24 credits/sec =
 * 120 credits, comfortably inside the 400 you get on signup.
 */
import { writeFile } from 'node:fs/promises';
import { experimental_generateVideo as generateVideo } from 'ai';
import { estimateCredits, magicHour } from '../src';

const MODEL = 'wan-2.2';
const DURATION = 5;

async function main() {
  console.log(
    `Generating ${DURATION}s on ${MODEL} — about ${estimateCredits(MODEL, DURATION)} credits.`,
  );

  const { video, warnings, providerMetadata } = await generateVideo({
    model: magicHour.video(MODEL),
    prompt:
      'a paper boat crossing a rain puddle at night, neon reflections, slow push-in',
    duration: DURATION,
    resolution: '854x480',
    aspectRatio: '16:9',
    poll: { intervalMs: 3000 },
  });

  for (const warning of warnings) {
    console.warn('warning:', warning);
  }

  await writeFile('out.mp4', video.uint8Array);
  console.log('Wrote out.mp4');
  console.log(providerMetadata.magicHour);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
