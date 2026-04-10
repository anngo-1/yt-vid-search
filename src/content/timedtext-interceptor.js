/* global window, document, URL, CustomEvent, XMLHttpRequest */

(() => {
    const eventName = document.currentScript?.dataset?.eventName || 'ask-transcript:timedtext';
    const hookKey = '__askTranscriptTimedTextHooked__';

    if (window[hookKey]) return;
    window[hookKey] = true;

    const shouldCapture = (rawUrl) => {
        if (!rawUrl) return false;
        if (
            !rawUrl.includes('get_panel') &&
            !rawUrl.includes('get_transcript') &&
            !rawUrl.includes('timedtext')
        )
            return false;
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.pathname.includes('/youtubei/v1/get_panel')) return true;
            if (url.pathname.includes('/youtubei/v1/get_transcript')) return true;
            if (url.pathname.includes('/api/timedtext')) return true;
            return false;
        } catch {
            return false;
        }
    };

    const emit = (url, body) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: { url, body } }));
    };

    const originalFetch = window.fetch;
    window.fetch = function (...args) {
        const request = args[0];
        const requestUrl = typeof request === 'string' ? request : request?.url;

        if (!shouldCapture(requestUrl)) {
            return originalFetch.apply(this, args);
        }

        return originalFetch.apply(this, args).then(function (response) {
            response
                .clone()
                .text()
                .then(function (body) { emit(requestUrl, body); })
                .catch(function () {});
            return response;
        });
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        try {
            this.__askTimedTextUrl = typeof url === 'string' ? url : String(url);
        } catch {
            this.__askTimedTextUrl = '';
        }
        return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const url = this.__askTimedTextUrl;
        if (shouldCapture(url)) {
            const capturedUrl = url;
            this.addEventListener('load', function () {
                try {
                    emit(capturedUrl, this.responseText || '');
                } catch {
                    // no-op
                }
            });
        }
        return originalSend.apply(this, args);
    };
})();
