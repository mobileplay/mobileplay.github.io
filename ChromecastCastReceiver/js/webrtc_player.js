export class WebRTCPlayer {
    constructor(videoId) {
        this.videoElement = document.getElementById(videoId);
        this.pc = null;
        this.ws = null;
        this.debug = true;
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' }
        ];

        this.onOpen = this.onOpen.bind(this);
        this.onMessage = this.onMessage.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onError = this.onError.bind(this);
    }

    log(msg) {
        if (this.debug) console.log(`[WebRTCPlayer] ${msg}`);
    }

    start(url) {
        this.log(`Starting WebRTC connection to ${url}`);
        this.stop();

        this.videoElement.style.display = 'block';

        // Connect to Signaling Server (WebSocket)
        this.ws = new WebSocket(url);
        this.ws.onopen = this.onOpen;
        this.ws.onmessage = this.onMessage;
        this.ws.onclose = this.onClose;
        this.ws.onerror = this.onError;
    }

    stop() {
        this.log('Stopping WebRTC player');
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
    }

    onOpen() {
        this.log('Signaling WebSocket connected');
    }

    onClose(event) {
        this.log(`Signaling WebSocket closed: ${event.code}`);
    }

    onError(error) {
        console.error('[WebRTCPlayer] WebSocket error', error);
    }

    async onMessage(event) {
        try {
            const msg = JSON.parse(event.data);
            this.log(`Received signaling message: ${msg.type}`);

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
        }
    }

    setupPeerConnection() {
        this.log('Creating RTCPeerConnection');
        this.pc = new RTCPeerConnection({
            iceServers: this.iceServers
        });

        this.pc.ontrack = (event) => {
            this.log(`Track received: ${event.track.kind}`);
            if (event.track.kind === 'video' || event.track.kind === 'audio') {
                // Attach stream to video element
                if (this.videoElement.srcObject !== event.streams[0]) {
                    this.videoElement.srcObject = event.streams[0];
                    this.log('Stream attached to video element');
                    // Ensure tracking auto-play policy
                    this.videoElement.play().catch(e => console.error('Auto-play failed', e));
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
            this.log(`Connection state: ${this.pc.connectionState}`);
        };
    }

    async handleOffer(sdpContainer) {
        this.log('Handling Offer');
        const offer = new RTCSessionDescription({
            type: 'offer',
            sdp: sdpContainer.sdp
        });

        await this.pc.setRemoteDescription(offer);

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.sendSignalingMessage({
            type: 'answer',
            sessionDescription: {
                sdp: answer.sdp
            }
        });
        this.log('Answer sent');
    }

    async handleCandidate(iceCandidateContainer) {
        if (!iceCandidateContainer) return;
        this.log('Handling ICE Candidate');
        const candidate = new RTCIceCandidate({
            candidate: iceCandidateContainer.sdp,
            sdpMLineIndex: iceCandidateContainer.sdpMLineIndex,
            sdpMid: iceCandidateContainer.sdpMid
        });
        await this.pc.addIceCandidate(candidate);
    }

    sendSignalingMessage(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
}
