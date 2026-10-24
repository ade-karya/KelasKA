'use client';

import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import type { VideoProviderId } from '@/lib/media/types';
import { MediaServicePanel } from './media-service-panel';
import { HuggingFaceHint, MediaModelsManager } from './media-service-extras';
import type { ServicePanelProps } from './server-settings';

/** A video generation service (see MediaServicePanel). */
export function VideoSettings(props: ServicePanelProps) {
  const { entry } = props;
  const registry = VIDEO_PROVIDERS[entry.registryId as VideoProviderId];
  const isHuggingFace = entry.registryId === 'huggingface-video';
  const isOpenRouter = entry.registryId === 'openrouter-video';
  // Provider extras edit the workspace's own provider: deployment services
  // are read-only, so their panels keep the hint only.
  const ownProvider = entry.provider?.source === 'workspace';
  return (
    <MediaServicePanel
      {...props}
      kind="video"
      defaultBaseUrl={registry?.defaultBaseUrl}
      catalogue={registry?.models ?? []}
      keyPlaceholder={entry.registryId === 'kling' ? 'accessKey:secretKey' : undefined}
      belowKey={
        (isHuggingFace || (isOpenRouter && ownProvider)) && (
          <div className="space-y-3">
            {isHuggingFace && <HuggingFaceHint kind="video" />}
            {isOpenRouter && ownProvider && <MediaModelsManager kind="video" {...props} />}
          </div>
        )
      }
    />
  );
}
