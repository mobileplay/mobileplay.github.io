export class WebSocketPlayer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // Optimize for no transparency
        this.ws = null;
        this.audioContext = null;
        this.audioQueue = []; // Array of AudioBuffer
        this.isPlaying = false;
        this.nextStartTime = 0;
        this.initialBuffering = true;
        this.debug = true; // Set to true to see logs

        // Bind methods
        this.handleMessage = this.handleMessage.bind(this);
        this.onOpen = this.onOpen.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onError = this.onError.bind(this);
    }

    log(msg) {
        if (this.debug) {
            console.log(`[WebSocketPlayer] ${msg}`);
        }
    }

    start(url) {
        this.log(`Starting connection to ${url}`);
        this.stop(); // Ensure completely stopped before starting new
        this.isPlaying = true;

        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

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
        this.audioQueue = [];
        this.nextStartTime = 0;
        this.initialBuffering = true;
        
        // Clear canvas
        if (this.ctx && this.canvas) {
           this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    onOpen() {
        this.log('WebSocket connected');
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
        } else if (data instanceof ArrayBuffer) {
            this.handleBinaryMessage(data);
        }
    }

    handleTextMessage(text) {
        // Format: Rotation,Width,Height,PTS
        // Example: "270,1280,720,123.456"
        const parts = text.split(',');
        if (parts.length >= 3) {
            const rotation = parseFloat(parts[0]); // Not strictly used if image is pre-rotated, but good to know
            const width = parseFloat(parts[1]);
            const height = parseFloat(parts[2]);
            
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
                this.log(`Canvas resized to ${width}x${height}`);
            }
        }
    }

    handleBinaryMessage(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength === 0) return;

        const packetType = view.getUint8(0);

        if (packetType === 0x01) {
            // Video (MJPEG)
            // Skip 1 byte prefix
            const jpegData = new Blob([new Uint8Array(buffer, 1)], { type: 'image/jpeg' });
            createImageBitmap(jpegData).then(imageBitmap => {
                if (this.canvas && this.ctx) {
                   this.ctx.drawImage(imageBitmap, 0, 0, this.canvas.width, this.canvas.height);
                }
                imageBitmap.close(); // Important to release memory
            }).catch(err => {
                console.error('Error creating ImageBitmap:', err);
            });

        } else if (packetType === 0x02) {
            // Audio (PCM Float32)
            this.processAudioPacket(view, buffer);
        }
    }

    processAudioPacket(view, buffer) {
        if (!this.audioContext) return;
        
        // Header structure after 1 byte prefix:
        // PTS (8 bytes) - Big Endian
        // Total Length (4 bytes) - Little Endian
        // Sample Rate (4 bytes) - Little Endian
        // Channels (1 byte)

        const headerSize = 1 + 8 + 4 + 4 + 1; // 18 bytes
        if (buffer.byteLength < headerSize) return;

        // Ensure bigEndianPts matches Swift's bigEndian encoding
        // const ptsMs = view.getBigUint64(1, false); // Big Endian
        
        // const totalLen = view.getUint32(9, true); // Little Endian
        const sampleRate = view.getUint32(13, true); // Little Endian
        const channels = view.getUint8(17);

        const pcmDataOffset = headerSize;
        const pcmDataLength = buffer.byteLength - pcmDataOffset;
        
        if (pcmDataLength <= 0) return;

        // Create AudioBuffer
        const frameCount = pcmDataLength / 4; // Float32 is 4 bytes
        const audioBuffer = this.audioContext.createBuffer(channels, frameCount / channels, sampleRate);
        
        const floatData = new Float32Array(buffer, pcmDataOffset, frameCount);
        
        // De-interleave if necessary (CTScreenCast sends planar, so might need check)
        // Swift code: rawData.append(UnsafeBufferPointer(start: finalChannelData[i]...))
        // This implies PLANAR data (all Ch1, then all Ch2...)
        
        const channelLength = frameCount / channels;
        for (let channel = 0; channel < channels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            // Copy appropriate section
            const startIdx = channel * channelLength;
            // Float32Array.set is faster
            channelData.set(floatData.subarray(startIdx, startIdx + channelLength));
        }

        this.scheduleAudioUrl(audioBuffer);
    }

    scheduleAudioUrl(audioBuffer) {
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        const currentTime = this.audioContext.currentTime;

        // Initial buffering or reset
        if (this.initialBuffering || this.nextStartTime < currentTime) {
            // Start slightly in the future to allow scheduling
            this.nextStartTime = currentTime + 0.05; // 50ms buffer
            this.initialBuffering = false;
        }

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
    }
}
