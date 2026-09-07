# Magic Hour provider for the AI SDK

Generate video with **Sora 2, Veo 3.1, Kling 3.0, Seedance, MiniMax H3, WAN 2.2 and LTX 2.3** from the [AI SDK](https://ai-sdk.dev), through one API key. Also covers Magic Hour's hosted image models.

```bash
npm i magic-hour-ai-provider ai
```

```ts
import { experimental_generateVideo as generateVideo } from "ai";
import { magicHour } from "magic-hour-ai-provider";

const { video } = await generateVideo({
  model: magicHour.video("veo3.1"),
  prompt: "a lighthouse in a storm, slow drone push-in",
  duration: 8,
  resolution: "1280x720",
});

await writeFile("out.mp4", video.uint8Array);
```

## API key

Free at [magichour.ai/developer](https://magichour.ai/developer) — no credit card, 400 credits on signup plus 100/day.

```bash
export MAGIC_HOUR_API_KEY="mhk_live_..."
```

The default `magicHour` instance reads that variable. To pass a key explicitly, or point at a proxy:

```ts
import { createMagicHour } from "magic-hour-ai-provider";

const magicHour = createMagicHour({
  apiKey: process.env.MY_KEY,
  baseURL: "https://proxy.internal/mh", // optional
  headers: { "x-team": "growth" }, // optional
  fetch: myInstrumentedFetch, // optional
});
```

## Video

### Text to video

```ts
const { video, warnings } = await generateVideo({
  model: magicHour.video("kling-3.0"),
  prompt: "a paper boat crossing a puddle at night, neon reflections",
  duration: 5,
  aspectRatio: "9:16",
  resolution: "1920x1080",
});
```

### Image to video

Pass an image and Magic Hour animates from it. The provider routes to the image-to-video endpoint automatically.

```ts
const { video } = await generateVideo({
  model: magicHour.video("wan-2.2"),
  prompt: {
    image: await readFile("frame.png"),
    text: "pan slowly to the left",
  },
  duration: 5,
});
```

A public HTTPS URL is passed straight through. Raw bytes are uploaded to Magic Hour first, which costs one extra round-trip.

### Native audio

`minimax-h3`, `veo3.1-audio` and `sora-2` generate a soundtrack alongside the picture:

```ts
await generateVideo({
  model: magicHour.video("veo3.1-audio"),
  prompt: "a market at dawn, vendors calling out",
  generateAudio: true,
});
```

## Models

Every model takes a different set of clip lengths, and several cap out below the resolution your plan allows. Ask for something a model can't do and the provider **snaps to the nearest legal value and returns a warning**, rather than letting the API come back with an opaque 422.

**Free plan**

| Model        | Credits/sec | Durations | Notes                       |
| ------------ | ----------- | --------- | --------------------------- |
| `wan-2.2`    | 24          | 3–15s     | physics & camera motion     |
| `ltx-2.3`    | 24          | 1–30s     | fastest, good for iterating |
| `minimax-h3` | 24          | 1–30s     | native audio, max 1080p     |

**Paid plans**

| Model               | Credits/sec | Durations           | Notes                        |
| ------------------- | ----------- | ------------------- | ---------------------------- |
| `seedance-1.5`      | 30          | 4–12s               | smooth, precise motion       |
| `kling-2.6`         | 36          | 5 or 10s            | action & motion blur         |
| `kling-3.0`         | 48          | 3–15s               | best cinematic, up to 4k     |
| `veo3.1-lite`       | 48          | 4–56s               | Veo quality, cheaper         |
| `seedance-2.0-mini` | 96          | 4–15s               | max 720p                     |
| `veo3.1`            | 96          | 4–56s               | highest realism              |
| `veo3.1-audio`      | 96          | 4–56s               | Veo + native audio           |
| `sora-2`            | 120         | 4/8/12/24/36/48/60s | max 720p                     |
| `seedance-2.0`      | 144         | 4–15s               | reference-to-video, max 720p |
| `seedance-2.5`      | 288         | 4–30s               | best quality, max 720p       |

Model ids are not an allowlist — Magic Hour ships models faster than this package can. An unrecognised id is sent through unchanged, with a warning saying the limits weren't checked.

Estimate spend before committing to a run:

```ts
import { estimateCredits } from "magic-hour-ai-provider";

estimateCredits("sora-2", 8); // 960
```

## Resolution

The AI SDK expresses resolution as `{width}x{height}`; Magic Hour uses named tiers. The provider maps by height:

| You pass    | Magic Hour gets | Plan needed |
| ----------- | --------------- | ----------- |
| `854x480`   | `480p`          | Free        |
| `1280x720`  | `720p`          | Creator+    |
| `1920x1080` | `1080p`         | Pro+        |
| `3840x2160` | `4k`            | Business    |

To name the tier directly:

```ts
providerOptions: {
  magicHour: {
    resolution: "1080p";
  }
}
```

## Images

```ts
import { generateImage } from "ai";

const { image } = await generateImage({
  model: magicHour.image("nano-banana-pro"),
  prompt: "a red bicycle against a whitewashed wall",
  n: 4,
});
```

Available: `default`, `gpt-image-2`, `nano-banana-pro`, `seedream-5-pro`, `flux-2-klein`, `z-image-turbo`, `qwen-edit`.

Magic Hour takes an aspect ratio and a resolution tier rather than exact pixels, so `size` is read as an aspect ratio and you pick the tier separately:

```ts
providerOptions: {
  magicHour: {
    resolution: "2k";
  }
} // auto | 640px | 1k | 2k | 4k
```

## Provider options

Anything under `providerOptions.magicHour` that isn't listed below is forwarded to the API untouched, so a new Magic Hour field doesn't have to wait for a release of this package.

| Option       | Applies to   | What it does                                                             |
| ------------ | ------------ | ------------------------------------------------------------------------ |
| `resolution` | video, image | Names the tier directly, overriding `resolution` / `size`                |
| `name`       | video, image | Label shown in the Magic Hour dashboard                                  |
| `strict`     | video        | Skips duration and resolution snapping — send exactly what was asked for |

## Behaviour worth knowing

- **Polling is the SDK's job, not this package's.** The video model implements `doStart`/`doStatus`, so `generateVideo` owns the loop and you can tune it with `poll: { intervalMs }`. This provider currently uses polling and does not implement `handleWebhookOption`. Magic Hour also supports [project webhooks](https://docs.magichour.ai/integration/webhook/overview) for integrations that manage completion callbacks directly.
- **Failed renders are auto-refunded** by Magic Hour, so an error costs nothing. The error message says so.
- **One clip per call.** `n > 1` warns and returns one video; call `generateVideo` again for more.
- **`fps` and `seed` are ignored** with a warning — Magic Hour doesn't expose either for video.
- **Tier and credit errors are rewritten** into something actionable rather than a bare 403 or 402.

## Links

[Magic Hour docs](https://docs.magichour.ai) · [API reference](https://docs.magichour.ai/api-reference/overview) · [Pricing](https://magichour.ai/pricing) · [AI SDK](https://ai-sdk.dev)

## License

MIT
