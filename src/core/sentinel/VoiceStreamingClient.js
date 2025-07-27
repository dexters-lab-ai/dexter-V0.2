// src/core/sentinel/VoiceStreamingClient.js
/**
 * Real-time Voice Streaming Client for SENTINEL
 * Handles WebSocket connection to backend, voice activity detection,
 * chunked audio streaming, and AI audio response playback
 */
import { VAD } from '@ricky0123/vad-web';

export class VoiceStreamingClient {
  constructor() {
    this.ws = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.vadProcessor = null;
    this.isConnected = false;
    this.isStreaming = false;
    this.isSessionActive = false;
    this.walletAddress = null;
    
    // VAD
    this.vad = null;
    this.vadRunning = false;
    this.heartbeatInterval = null;
    
    // Audio settings
    this.audioSettings = {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    
    // Event callbacks
    this.onStateChange = null;
    this.onTranscription = null;
    this.onError = null;
    this.onAudioResponse = null;
  }

  /**
   * Connect to the voice streaming server
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<void>}
   */
  async connect(walletAddress) {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      this.walletAddress = walletAddress;
      const wsUrl = `ws://${window.location.host}/voice-stream?wallet=${encodeURIComponent(walletAddress)}`;
      
      console.log(`🔗 Connecting to voice streaming server: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('✅ Connected to voice streaming server');
        this.updateState('connected');
        // Start heartbeat
        this.heartbeatInterval = setInterval(() => this.ping(), 25000);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleServerMessage(message);
        } catch (error) {
          console.error('Error parsing server message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.updateState('error');
        if (this.onError) this.onError('Connection error');
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log(`🔌 Voice streaming connection closed: ${event.code} - ${event.reason}`);
        this.isConnected = false;
        this.isSessionActive = false;
        this.updateState('disconnected');
        this.cleanup();
      };
    });
  }

  /**
   * Start a new voice session
   * @param {string} instructions - Custom instructions for the AI (optional)
   * @returns {Promise<void>}
   */
  async startVoiceSession(instructions = null) {
    if (!this.isConnected) {
      throw new Error('Not connected to voice server');
    }

    if (this.isSessionActive) {
      console.log('Voice session already active');
      return;
    }

    console.log('🎤 Starting voice session...');
    
    // Send session start message
    this.sendMessage({
      type: 'start_session',
      instructions: instructions || this.getDefaultInstructions(),
      timestamp: Date.now()
    });

    // Start audio capture
    await this.startAudioCapture();
    this.isSessionActive = true;
    this.updateState('session_active');
  }

  /**
   * End the current voice session
   */
  async endVoiceSession() {
    if (!this.isSessionActive) {
      return;
    }

    console.log('🔚 Ending voice session...');
    
    this.isSessionActive = false;
    this.stopAudioCapture();
    
    if (this.isConnected) {
      this.sendMessage({
        type: 'end_session',
        timestamp: Date.now()
      });
    }
    
    this.updateState('idle');
  }

  /**
   * Start audio capture with voice activity detection
   */
  async startAudioCapture() {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.audioSettings
      });

      // Set up VAD with the raw stream
      await this.setupVAD(stream);

      // Set up MediaRecorder
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.getSupportedMimeType()
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && this.isStreaming) {
          this.sendAudioChunk(event.data);
        }
      };

      this.mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        this.updateState('error');
        if (this.onError) this.onError('Audio capture error');
      };

      this.mediaRecorder.start(250); // Collect audio in 250ms chunks
      console.log('🎙️ Audio capture started');

    } catch (error) {
      console.error('Error starting audio capture:', error);
      this.updateState('error');
      if (this.onError) this.onError('Microphone access denied');
      throw error;
    }
  }

  /**
   * Sets up and starts the real-time VAD processing.
   * @param {MediaStream} stream The raw audio stream from the microphone.
   */
  async setupVAD(stream) {
    try {
      this.vad = await VAD.create({
        stream: stream,
        workletURL: '/vad.worklet.js', // Make sure this path is correct
        modelURL: '/silero_vad.onnx',
        onSpeechStart: () => {
          console.log('🎤 Speech detected, starting stream...');
          this.isStreaming = true;
          this.updateState('speaking_detected');
        },
        onSpeechEnd: () => {
          console.log('🤫 Silence detected, stopping stream...');
          this.isStreaming = false;
          this.updateState('listening');
        },
      });

      this.vad.start();
      console.log('✅ VAD started');

    } catch (error) {
      console.error('Failed to setup VAD:', error);
      this.updateState('error');
      if (this.onError) this.onError('VAD setup failed');
    }
  }

  /**
   * Send audio chunk to server
   * @param {Blob} audioBlob - Audio data blob
   */
  sendAudioChunk(audioBlob) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64Audio = reader.result.split(',')[1];
      this.sendMessage({
        type: 'audio_chunk',
        audio: base64Audio,
        mimeType: audioBlob.type,
        timestamp: Date.now()
      });
    };
    reader.readAsDataURL(audioBlob);
  }

  /**
   * Stop audio capture
   */
  stopAudioCapture() {
    //  stopAudioCapture() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      this.mediaRecorder = null;
    }

    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
      console.log('⏹️ VAD stopped');
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    console.log('⏹️ Audio capture stopped');
  }

  /**
   * Handle messages from the server
   * @param {Object} message - Server message
   */
  handleServerMessage(message) {
    console.log('📨 Server message:', message.type);
    
    switch (message.type) {
      case 'connected':
        console.log('✅ Server confirmed connection');
        break;

      case 'session_ready':
        console.log('✅ Voice session ready');
        this.updateState('ready');
        break;

      case 'session_started':
        console.log('✅ Voice session started');
        break;

      case 'thinking':
        this.updateState('thinking');
        break;

      case 'transcription':
        console.log('💬 Transcription:', message.text);
        if (this.onTranscription) {
          this.onTranscription(message.text);
        }
        break;

      case 'audio_response':
        console.log('🔊 Audio response received');
        this.playAudioResponse(message.audio, message.mimeType);
        break;

      case 'complete':
        this.updateState('listening');
        break;

      case 'session_ended':
        console.log('✅ Voice session ended');
        this.isSessionActive = false;
        this.updateState('idle');
        break;

      case 'session_timeout':
        console.log('⏰ Session timeout');
        if (this.onError) this.onError(message.message);
        this.endVoiceSession();
        break;

      case 'error':
        console.error('❌ Server error:', message.error);
        if (this.onError) this.onError(message.error);
        break;

      case 'pong':
        // Heartbeat response
        break;

      default:
        console.warn('Unknown server message type:', message.type);
    }
  }

  /**
   * Initializes the audio playback system using MediaSource Extensions.
   */
  setupAudioPlayback() {
    this.audioElement = new Audio();
    this.mediaSource = new MediaSource();
    this.audioElement.src = URL.createObjectURL(this.mediaSource);
    this.audioQueue = [];
    this.sourceBuffer = null;
    this.isAppending = false;

    this.mediaSource.addEventListener('sourceopen', () => {
      console.log('✅ MediaSource opened, creating source buffer.');
      // Use a common and robustly supported codec
      const mimeCodec = 'audio/mpeg'; 
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeCodec);
      this.sourceBuffer.addEventListener('updateend', () => {
        this.isAppending = false;
        this.processAudioQueue(); // Process next chunk
      });
      this.processAudioQueue(); // Process any chunks that arrived before setup
    });

    this.audioElement.onended = () => {
      this.updateState('listening');
    };

    this.audioElement.onerror = (e) => {
        console.error('Audio element error:', e);
        this.updateState('listening');
    };
  }

  /**
   * Queues a chunk of audio data for playback.
   * @param {string} base64Audio - Base64 encoded audio data chunk.
   */
  playAudioResponse(base64Audio) {
    if (!this.audioElement) {
        this.setupAudioPlayback();
    }

    // Decode base64 to ArrayBuffer
    const byteCharacters = atob(base64Audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    this.audioQueue.push(byteArray);
    this.processAudioQueue();
  }

  /**
   * Processes the queue of audio chunks, appending them to the SourceBuffer.
   */
  processAudioQueue() {
    if (this.isAppending || this.audioQueue.length === 0 || !this.sourceBuffer || this.sourceBuffer.updating) {
      return;
    }

    this.isAppending = true;
    const audioChunk = this.audioQueue.shift();
    
    try {
        this.sourceBuffer.appendBuffer(audioChunk);
        if (this.audioElement.paused) {
            this.audioElement.play().catch(e => console.error('Playback start failed:', e));
            this.updateState('speaking');
        }
    } catch (error) {
        console.error('Error appending buffer:', error);
        this.isAppending = false; // Reset flag on error
    }
  }

  /**
   * Send message to server
   * @param {Object} message - Message to send
   */
  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Update current state and notify listeners
   * @param {string} state - New state
   */
  updateState(state) {
    console.log(`🔄 Voice state: ${state}`);
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  /**
   * Get supported MIME type for MediaRecorder
   * @returns {string} Supported MIME type
   */
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm'; // Fallback
  }

  /**
   * Convert base64 string to Blob
   * @param {string} base64 - Base64 string
   * @param {string} mimeType - MIME type
   * @returns {Blob} Audio blob
   */
  base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }

  /**
   * Get default AI instructions
   * @returns {string} Default instructions
   */
  getDefaultInstructions() {
    return `You are SENTINEL, an AI-powered crypto intelligence assistant. 
    Analyze user voice queries and provide relevant token information, security analysis, 
    or social sentiment. Keep responses concise and actionable for voice interaction.
    Use the available tools to fetch real-time data when needed.`;
  }

  /**
   * Send heartbeat ping
   */
  ping() {
    this.sendMessage({ type: 'ping', timestamp: Date.now() });
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.isSessionActive) {
      this.endVoiceSession();
    }

    if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
    }
    
    if (this.ws) {
      this.ws.close();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stopAudioCapture();
    this.isConnected = false;
    this.isSessionActive = false;
    this.isStreaming = false;
    this.walletAddress = null;
  }

  /**
   * Check if client is ready for voice interaction
   * @returns {boolean} True if ready
   */
  isReady() {
    return this.isConnected && this.isSessionActive;
  }

  /**
   * Get current connection status
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      connected: this.isConnected,
      sessionActive: this.isSessionActive,
      streaming: this.isStreaming,
      walletAddress: this.walletAddress
    };
  }
}
