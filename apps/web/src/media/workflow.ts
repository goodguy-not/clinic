export type MediaWorkflowStep = 'upload' | 'attach' | 'frame' | 'complete';

export function nextMediaWorkflowStep(state: {
  mediaId: string | null;
  attachmentId: string | null;
  framingSaved: boolean;
}): MediaWorkflowStep {
  if (state.mediaId === null) return 'upload';
  if (state.attachmentId === null) return 'attach';
  return state.framingSaved ? 'complete' : 'frame';
}
