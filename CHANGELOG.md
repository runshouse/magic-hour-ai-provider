# magic-hour-ai-provider

## 0.1.0

Initial release.

- `magicHour.video(modelId)` — a `VideoModelV4` for `experimental_generateVideo`, covering text-to-video and image-to-video across 13 models.
- `magicHour.image(modelId)` — an `ImageModelV4` for `generateImage`.
- Per-model duration and resolution snapping, with warnings instead of opaque 422s.
- Tier and credit errors rewritten into actionable messages.
