export class WebRTCPlayer {
    constructor(videoId, options = {}) {
        this.videoElement = document.getElementById(videoId);
        this.pc = null;
        this.ws = null;
        this.debug = true;
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' }
        ];

        this.onState = typeof options.onState === 'function' ? options.onState : null;
        this.remoteDescriptionSet = false;
        this.pendingCandidates = [];

        this.onOpen = this.onOpen.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onError = this.onError.bind(this);
    }

    log(msg) {
        if (this.debug) console.log(`[WebRTCPlayer] ${msg}`);
    }

    emitState(state, payload = {}) {
        if (!this.onState) return;
        try {
            this.onState(state, payload);
        } catch (_) {
            // ignore callback errors
        }
    }

    normalizeSignalingURL(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;

        let decoded = trimmed;
        if (decoded.includes('%')) {
            try {
                decoded = decodeURIComponent(decoded);
            } catch (_) {
                decoded = trimmed;
            }
        }

        try {
            const parsed = new URL(decoded);
            const scheme = parsed.protocol.toLowerCase();
            if (scheme === 'ws:' || scheme === 'wss:') {
                const p = parsed.pathname.toLowerCase();
                if (!parsed.pathname || parsed.pathname === '/' || p === '/webrtc') {
                    parsed.pathname = '/webrtc_signal';
                }
                parsed.search = '';
                parsed.hash = '';
                return parsed.toString();
            }

            if (scheme === 'http:' || scheme === 'https:') {
                parsed.protocol = scheme === 'https:' ? 'wss:' : 'ws:';
                parsed.pathname = '/webrtc_signal';
                parsed.search = '';
                parsed.hash = '';
                return parsed.toString();
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    start(url) {
        const signalingURL = this.normalizeSignalingURL(url);
        if (!signalingURL) {
            this.log(`Invalid signaling URL: ${url}`);
            this.emitState('invalid_url', { input: url });
            return false;
        }

        this.log(`Starting WebRTC connection to ${signalingURL}`);
        this.emitState('connecting', { url: signalingURL });
        this.stop();

        this.remoteDescriptionSet = false;
        this.pendingCandidates = [];

        if (this.videoElement) {
            this.videoElement.style.display = 'block';
            this.videoElement.srcObject = null;
        }

        this.ws = new WebSocket(signalingURL);
        this.ws.onopen = this.onOpen;
        this.ws.onmessage = this.onMessage;
        this.ws.onclose = this.onClose;
        this.ws.onerror = this.onError;
        return true;
    }

    stop() {
        this.log('Stopping WebRTC player');
        this.remoteDescriptionSet = false;
        this.pendingCandidates = [];

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
            this.videoElement.style.display = 'none';
        }
        this.emitState('stopped');
    }

    onOpen() {
        this.log('Signaling WebSocket connected');
        this.emitState('ws_open');
    }

    onClose(event) {
        this.log(`Signaling WebSocket closed: ${event.code}`);
        this.emitState('ws_close', { code: event.code, reason: event.reason || '' });
    }

    onError(error) {
        console.error('[WebRTCPlayer] WebSocket error', error);
        this.emitState('ws_error', { message: String(error) });
    }

    async onMessage(event) {
        try {
            const msg = JSON.parse(event.data);
            this.log(`Received signaling message: ${msg.type}`);
            this.emitState('signal_message', { type: msg.type || 'unknown' });

            if (!this.pc) {
                this.setupPeerConnection();
            }

            if (msg.type === 'offer') {
                await this.handleOffer(msg.sessionDescription);
            } else if (msg.type === 'candidate') {
                await this.handleCandidate(msg.iceCandidate);
            }
        } catch (e) {
            console.error('[WebRTCPlayer] Error handling message', e);
            this.emitState('message_error', { message: String(e) });
        }
    }

    setupPeerConnection() {
        this.log('Creating RTCPeerConnection');
        this.emitState('pc_create');

        this.pc = new RTCPeerConnection({
            iceServers: this.iceServers
        });

        this.pc.ontrack = (event) => {
            this.log(`Track received: ${event.track.kind}`);
            this.emitState('track', { kind: event.track.kind });
            if ((event.track.kind === 'video' || event.track.kind === 'audio') && this.videoElement) {
                if (this.videoElement.srcObject !== event.streams[0]) {
                    this.videoElement.srcObject = event.streams[0];
                    this.log('Stream attached to video element');
                    this.videoElement.play()
                        .then(() => this.emitState('play_started'))
                        .catch((e) => {
                            console.error('[WebRTCPlayer] Auto-play failed', e);
                            this.emitState('play_error', { message: String(e) });
                        });
                }
            }
        };

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    type: 'candidate',
                    iceCandidate: {
                        sdp: event.candidate.candidate,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        sdpMid: event.candidate.sdpMid
                    }
                });
            }
        };

        this.pc.onconnectionstatechange = () => {
            const state = this.pc ? this.pc.connectionState : 'unknown';
            this.log(`Connection state: ${state}`);
            this.emitState('pc_state', { state });
        };
    }

    async handleOffer(sdpContainer) {
        if (!sdpContainer || !sdpContainer.sdp) {
            this.log('Invalid offer payload');
            this.emitState('offer_invalid');
            return;
        }

        this.log('Handling Offer');
        this.emitState('offer_received');

        const offer = new RTCSessionDescription({
            type: 'offer',
            sdp: sdpContainer.sdp
        });

        await this.pc.setRemoteDescription(offer);
        this.remoteDescriptionSet = true;
        this.flushPendingCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.sendSignalingMessage({
            type: 'answer',
            sessionDescription: {
                sdp: answer.sdp
            }
        });
        this.log('Answer sent');
        this.emitState('answer_sent');
    }

    async handleCandidate(iceCandidateContainer) {
        if (!iceCandidateContainer) return;

        const candidate = new RTCIceCandidate({
            candidate: iceCandidateContainer.sdp,
            sdpMLineIndex: iceCandidateContainer.sdpMLineIndex,
            sdpMid: iceCandidateContainer.sdpMid
        });

        if (!this.remoteDescriptionSet) {
            this.pendingCandidates.push(candidate);
            this.log(`Queued ICE Candidate (pending=${this.pendingCandidates.length})`);
            this.emitState('candidate_queued', { pending: this.pendingCandidates.length });
            return;
        }

        this.log('Handling ICE Candidate');
        await this.pc.addIceCandidate(candidate);
    }

    async flushPendingCandidates() {
        if (!this.pc || !this.remoteDescriptionSet || this.pendingCandidates.length === 0) return;
        this.log(`Flushing ${this.pendingCandidates.length} queued ICE candidate(s)`);

        const candidates = this.pendingCandidates.slice();
        this.pendingCandidates = [];
        for (const candidate of candidates) {
            try {
                await this.pc.addIceCandidate(candidate);
            } catch (e) {
                console.error('[WebRTCPlayer] Failed to add queued ICE candidate', e);
                this.emitState('candidate_error', { message: String(e) });
            }
        }
    }

    sendSignalingMessage(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        } else {
            this.log('Signaling socket not open, message dropped');
            this.emitState('ws_not_open');
        }
    }
}
