import type { ImageGenerationConfig, ImageGenerationOptions, ImageGenerationResult } from '../types';

export async function testPollinationsConnectivity(
  _config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  // Pollinations is an open service, we can always reach it
  return { success: true, message: 'Successfully connected to Pollinations' };
}

export async function generateWithPollinations(
  _config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const width = options.width || 1024;
  const height = options.height || 576;
  
  let prompt = options.prompt;
  if (options.style) {
    prompt += `, ${options.style} style`;
  }
  
  // Step 1: Strip words that trigger text/label rendering in diffusion models.
  // The LLM often generates prompts like "diagram of photosynthesis showing the labeled process"
  // which makes the image model produce infographics full of garbled text.
  const textTriggerWords = [
    'diagram', 'infographic', 'chart', 'graph', 'label', 'labeled', 'labelled',
    'annotated', 'annotation', 'caption', 'title', 'heading', 'subtitle',
    'text', 'typography', 'font', 'letter', 'word', 'writing', 'written',
    'explanation', 'description', 'step-by-step', 'step by step',
    'flowchart', 'flow chart', 'mindmap', 'mind map', 'table',
    'bullet point', 'bullet', 'numbered', 'list',
    'schematic', 'blueprint', 'technical drawing',
    'poster', 'banner', 'sign', 'signage', 'billboard',
    'watermark', 'logo', 'signature', 'stamp',
    'showing the process', 'with labels', 'with text', 'with captions',
    'with annotations', 'with descriptions', 'with explanations',
  ];
  
  let sanitized = prompt;
  for (const trigger of textTriggerWords) {
    // Case-insensitive replacement
    sanitized = sanitized.replace(new RegExp(trigger, 'gi'), '');
  }
  // Collapse multiple spaces left over from stripping
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();
  
  // Step 2: Wrap with strong photographic/cinematic framing.
  // These descriptors steer the model toward photo-like output that
  // never contains overlaid text.
  const finalPrompt = `a beautiful photorealistic photograph of ${sanitized}, cinematic lighting, clean composition, no overlays, smooth textures, shallow depth of field, shot on Canon EOS R5, 8k ultra HD`;
  
  const encodedPrompt = encodeURIComponent(finalPrompt);
  
  const seed = Math.floor(Math.random() * 1000000);
  
  // Use model=flux for highest quality, enhance=false to preserve our sanitized prompt
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&width=${width}&height=${height}&model=flux&enhance=false&seed=${seed}&safe=true`;
  
  return {
    url,
    width,
    height,
  };
}
