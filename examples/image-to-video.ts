/**
 * Animate a local image.
 *
 *   export MAGIC_HOUR_API_KEY=mhk_live_...
 *   npx tsx examples/image-to-video.ts path/to/frame.png
 */
import { readFile, writeFile } from 'node:fs/promises';
import { experimental_generateVideo as generateVideo } from 'ai';
import { magicHour } from '../src';

async function main() {
  const path = process.argv[2];
  if (path == null) {
    console.error('Usage: tsx examples/image-to-video.ts <image>');
    process.exit(1);
  }

  const { video } = await generateVideo({
    model: magicHour.video('wan-2.2'),
    prompt: { image: await readFile(path), text: 'pan slowly to the left' },
    duration: 5,
    resolution: '854x480',
    poll: { intervalMs: 3000 },
  });

  await writeFile('out.mp4', video.uint8Array);
  console.log('Wrote out.mp4');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
