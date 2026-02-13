export class WebSocketPlayer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        this.ws = null;
        this.audioContext = null;
        this.isPlaying = false;

        this.videoWidth = 0;
        this.videoHeight = 0;
        this.videoDecodeInFlight = false;
        this.pendingVideoBuffer = null;
        this.frameDropCounter = 0;

        this.nextStartTime = 0;
        this.initialBuffering = true;
        this.audioAnchorPtsMs = null;
        this.audioAnchorCtxTime = 0;

        this.debug = true;

        this.MAX_AUDIO_LATENCY = 0.25;
        this.AUDIO_BUFFER_TARGET = 0.03;
        this.MAX_STALE_AUDIO_MS = 800;
        this.MAX_FUTURE_AUDIO_SEC = 0.2;

        this.handleMessage = this.handleMessage.bind(this);
        this.onOpen = this.onOpen.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onError = this.onError.bind(this);
        this.handleResize = this.handleResize.bind(this);

        this.handleResize();
        window.addEventListener('resize', this.handleResize);
    }

    log(msg) {
        if (this.debug) {
            console.log(`[WebSocketPlayer] ${msg}`);
        }
    }

    async ensureAudioContextRunning() {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (error) {
                this.log(`AudioContext resume failed: ${error?.message || error}`);
            }
        }
    }

    start(url) {
        this.log(`Starting connection to ${url}`);
        this.stop();
        this.isPlaying = true;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive',
                sampleRate: 48000
            });
        } catch {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        this.ensureAudioContextRunning();

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = this.onOpen;
        this.ws.onmessage = this.handleMessage;
        this.ws.onclose = this.onClose;
        this.ws.onerror = this.onError;
    }

    stop() {
        this.log('Stopping player');
        this.isPlaying = false;

        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
        }

        if (this.audioContext) {
            this.audioContext.close().then(() => {
                this.audioContext = null;
            });
        }

        this.nextStartTime = 0;
        this.initialBuffering = true;
        this.audioAnchorPtsMs = null;
        this.audioAnchorCtxTime = 0;

        this.videoWidth = 0;
        this.videoHeight = 0;
        this.videoDecodeInFlight = false;
        this.pendingVideoBuffer = null;
        this.frameDropCounter = 0;

        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    sendControlMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        try {
            this.ws.send(message);
            return true;
        } catch {
            return false;
        }
    }

    onOpen() {
        this.log('WebSocket connected');
        this.ensureAudioContextRunning();
    }

    onClose(event) {
        this.log(`WebSocket closed: ${event.code} ${event.reason}`);
    }

    onError(error) {
        console.error('[WebSocketPlayer] WebSocket error:', error);
    }

    handleMessage(event) {
        if (!this.isPlaying) return;

        const data = event.data;
        if (typeof data === 'string') {
            this.handleTextMessage(data);
            return;
        }

        if (data instanceof ArrayBuffer) {
            this.handleBinaryMessage(data);
        }
    }

    handleTextMessage(text) {
        const parts = text.split(',');
        if (parts.length >= 3) {
            const width = parseFloat(parts[1]);
            const height = parseFloat(parts[2]);
            this.videoWidth = Number.isFinite(width) && width > 0 ? width : this.videoWidth;
            this.videoHeight = Number.isFinite(height) && height > 0 ? height : this.videoHeight;
        }
    }

    handleBinaryMessage(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength === 0) return;

        const packetType = view.getUint8(0);

        if (packetType === 0x01) {
            this.enqueueVideoFrame(buffer);
        } else if (packetType === 0x02) {
            this.processAudioPacket(view, buffer);
        }
    }

    enqueueVideoFrame(buffer) {
        if (!this.videoDecodeInFlight) {
            this.decodeVideoFrame(buffer);
            return;
        }

        this.pendingVideoBuffer = buffer.slice(0);
        this.frameDropCounter++;
        if (this.frameDropCounter % 60 === 0) {
            this.log(`Dropped ${this.frameDropCounter} stale video frames to keep latency low`);
        }
    }

    decodeVideoFrame(buffer) {
        this.videoDecodeInFlight = true;

        const jpegData = new Blob([new Uint8Array(buffer, 1)], { type: 'image/jpeg' });
        createImageBitmap(jpegData)
            .then(imageBitmap => {
                if (this.canvas && this.ctx) {
                    this.drawImageContain(imageBitmap);
                }
                imageBitmap.close();
            })
            .catch(err => {
                console.error('[WebSocketPlayer] Error creating ImageBitmap:', err);
            })
            .finally(() => {
                this.videoDecodeInFlight = false;
                if (this.pendingVideoBuffer) {
                    const nextBuffer = this.pendingVideoBuffer;
                    this.pendingVideoBuffer = null;
                    this.decodeVideoFrame(nextBuffer);
                }
            });
    }

    processAudioPacket(view, buffer) {
        if (!this.audioContext || this.audioContext.state === 'closed') return;

        const headerSize = 1 + 8 + 4 + 4 + 1;
        if (buffer.byteLength < headerSize) return;

        const ptsMs = this.readUint64BE(view, 1);
        const sampleRate = view.getUint32(13, true);
        const channels = view.getUint8(17);

        if (!sampleRate || !channels) return;

        const pcmDataOffset = headerSize;
        const pcmDataLength = buffer.byteLength - pcmDataOffset;
        if (pcmDataLength <= 0) return;

        const frameCount = pcmDataLength / 4;
        if (frameCount <= 0 || frameCount % channels !== 0) return;

        const audioBuffer = this.audioContext.createBuffer(channels, frameCount / channels, sampleRate);
        const floatData = new Float32Array(buffer, pcmDataOffset, frameCount);

        const channelLength = frameCount / channels;
        for (let channel = 0; channel < channels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            const startIdx = channel * channelLength;
            channelData.set(floatData.subarray(startIdx, startIdx + channelLength));
        }

        this.scheduleAudioBuffer(audioBuffer, ptsMs);
    }

    readUint64BE(view, offset) {
        try {
            if (typeof view.getBigUint64 === 'function') {
                const big = view.getBigUint64(offset, false);
                return Number(big);
            }
        } catch {
            // Fallback below
        }

        const high = view.getUint32(offset, false);
        const low = view.getUint32(offset + 4, false);
        return high * 4294967296 + low;
    }

    scheduleAudioBuffer(audioBuffer, ptsMs) {
        if (!this.audioContext) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const currentTime = this.audioContext.currentTime;
        let targetStart = null;

        if (Number.isFinite(ptsMs)) {
            if (this.audioAnchorPtsMs == null) {
                this.audioAnchorPtsMs = ptsMs;
                this.audioAnchorCtxTime = currentTime + this.AUDIO_BUFFER_TARGET;
            }

            targetStart = this.audioAnchorCtxTime + ((ptsMs - this.audioAnchorPtsMs) / 1000);

            const staleMs = (currentTime - targetStart) * 1000;
            if (staleMs > this.MAX_STALE_AUDIO_MS) {
                this.log(`Dropping stale audio packet (${Math.round(staleMs)}ms late)`);
                return;
            }

            if (targetStart < currentTime + 0.005) {
                targetStart = currentTime + 0.005;
            }

            if (targetStart > currentTime + this.MAX_AUDIO_LATENCY) {
                this.log(`Audio drift high (${(targetStart - currentTime).toFixed(3)}s), resync`);
                this.audioAnchorCtxTime = currentTime + this.AUDIO_BUFFER_TARGET;
                this.audioAnchorPtsMs = ptsMs;
                targetStart = this.audioAnchorCtxTime;
            }

            if (targetStart > currentTime + this.MAX_FUTURE_AUDIO_SEC) {
                targetStart = currentTime + this.AUDIO_BUFFER_TARGET;
            }
        }

        if (targetStart == null) {
            if (this.initialBuffering || this.nextStartTime < currentTime) {
                this.nextStartTime = currentTime + this.AUDIO_BUFFER_TARGET;
                this.initialBuffering = false;
            } else if (this.nextStartTime > currentTime + this.MAX_AUDIO_LATENCY) {
                this.nextStartTime = currentTime + this.AUDIO_BUFFER_TARGET;
            }
            targetStart = this.nextStartTime;
        }

        source.start(targetStart);
        this.nextStartTime = targetStart + audioBuffer.duration;
    }

    handleResize() {
        if (!this.canvas || !this.ctx) return;
        const width = this.canvas.clientWidth || window.innerWidth || 1280;
        const height = this.canvas.clientHeight || window.innerHeight || 720;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.ctx.imageSmoothingEnabled = false;
        }
    }

    drawImageContain(imageBitmap) {
        this.handleResize();

        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const sourceWidth = this.videoWidth > 0 ? this.videoWidth : imageBitmap.width;
        const sourceHeight = this.videoHeight > 0 ? this.videoHeight : imageBitmap.height;

        if (canvasWidth <= 0 || canvasHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
            return;
        }

        const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        const x = (canvasWidth - drawWidth) * 0.5;
        const y = (canvasHeight - drawHeight) * 0.5;

        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        this.ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height, x, y, drawWidth, drawHeight);
    }
}
