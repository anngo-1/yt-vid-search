import { TOAST_DISPLAY_MS, TOAST_FADE_MS } from '@/utils/constants';

let toastTimeout: number | null = null;

export function showToast(message: string, type: 'error' | 'info' = 'error'): void {
    if (!document.body) return;

    let toast = document.getElementById('yt-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'yt-toast';
        toast.className = 'yt-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.toggle('yt-toast-error', type === 'error');
    toast.classList.toggle('yt-toast-info', type === 'info');

    requestAnimationFrame(() => toast?.classList.add('active'));

    if (toastTimeout) window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
        toast?.classList.remove('active');
        window.setTimeout(() => toast?.remove(), TOAST_FADE_MS);
    }, TOAST_DISPLAY_MS);
}
