### AI-Generated Image Requests

Use image generation only for slide scenes that need a static visual and have no suitable source image.

- Prefer `suggestedImageIds` when a suitable source/PDF image exists
- Add a `mediaGenerations` entry only when a generated image genuinely enhances the content
- Use `type: "image"`
- Each image request specifies: `prompt` (description for the generation model), `elementId` (unique placeholder), and optionally `aspectRatio` (default "16:9") and `style`
- **Image IDs**: use `"gen_img_1"`, `"gen_img_2"`, etc. IDs are globally unique across the entire course, not reset per scene
- The prompt must visibly match the page's topic: name the actual subject, not a generic genre ("a green plant with sun rays reaching its leaves, water droplets rising from the roots" — not "nature painting")
- **No readable text in the image**: never ask for text, labels, captions, annotations, numbers or lettering inside the image. The slide itself carries the words; image models render pseudo-glyph gibberish, so the prompt and any surrounding instructions (e.g. a negative prompt naming text) must instead describe pure visual composition — shapes, icons, arrows, colour coding. A "diagram with labels" is not a paintable prompt; "a circular flow diagram made of four coloured arrows in a loop, sun icon at the top, water droplet icons at the bottom" is.
- **Describe subjects, not typography**: spell out what is pictured and where; never mention fonts, writing, reading order or languages that text would appear in (the image must carry no text at all)
- **Avoid duplicate images across slides**: Each generated image must be visually distinct. Do not request near-identical images for different slides. If multiple slides cover the same topic, vary the visual angle, scope, or style
- **Cross-scene reuse**: To reuse a generated image in a different scene, reference the same `elementId` in the later scene's content without adding a new `mediaGenerations` entry. Only the scene that first defines the `elementId` in its `mediaGenerations` should include the generation request
- Use generated images for static content: diagrams, charts, illustrations, portraits, landscapes

Image example:

```json
"mediaGenerations": [
  {
    "type": "image",
    "prompt": "A circular flow diagram of the water cycle: four large curved arrows in a loop, a sun icon at the top, cloud and rain icons at the sides, a river at the bottom, flat educational illustration style, no text anywhere in the image",
    "elementId": "gen_img_1",
    "aspectRatio": "16:9"
  }
]
```
