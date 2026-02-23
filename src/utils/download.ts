import { state } from '@/services/state';
import { getVideoTitle } from '@/content/selectors';
import { showToast } from '@/services/notifications';
import { URL_REVOKE_DELAY_MS } from '@/utils/constants';

export function downloadTranscript(): void {
    const { transcript } = state;
    if (!transcript.length) {
        showToast('Transcript not loaded yet.', 'error');
        return;
    }
    const title = getVideoTitle();
    const text = transcript.map((t) => `[${t.time}] ${t.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
}
