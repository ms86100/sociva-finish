import { getPublicOrigin } from '@/lib/sociva-share';
import { showFeedback } from '@/components/FeedbackPopupProvider';

/** Share become-seller invite (discovery empty + marketplace empty). */
export async function inviteBusinessToSociva(): Promise<void> {
  const inviteUrl = `${getPublicOrigin()}/#/become-seller`;
  const shareText = `Know a great local seller? Invite them to Sociva:\n${inviteUrl}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Invite a business to Sociva',
        text: shareText,
        url: inviteUrl,
      });
      return;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showFeedback({
      title: 'Invite link copied',
      description: 'Share it on WhatsApp so a local business can join Sociva',
      variant: 'success',
    });
  } catch {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  }
}
