// src/core/sentinel/VoiceStreamingClient.js
/**
 * Real-time Voice Streaming Client for SENTINEL
 * Handles WebSocket connection to backend, voice activity detection,
 * chunked audio streaming, and AI audio response playback
 */
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
    
    // Voice Activity Detection settings
    this.vadThreshold = 20; // Volume threshold for speech detection
    this.silenceThreshold = 5; // Volume threshold for silence
    this.silenceTimeout = 1500; // ms of silence before stopping stream
    this.silenceTimer = null;
    
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

      // Set up AudioContext for real-time processing
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.audioSettings.sampleRate
      });
      
      const source = this.audioContext.createMediaStreamSource(stream);
      
      // Set up Voice Activity Detection
      await this.setupVAD(source);
      
      // Set up MediaRecorder for chunked streaming
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 16000
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && this.isStreaming && this.isSessionActive) {
          this.sendAudioChunk(event.data);
        }
      };

      this.mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        if (this.onError) this.onError('Recording error');
      };

      // Start recording in small chunks (100ms intervals)
      this.mediaRecorder.start(100);
      
      console.log('🎵 Audio capture started');
      this.updateState('listening');
      
    } catch (error) {
      console.error('Error starting audio capture:', error);
      if (this.onError) this.onError('Could not access microphone');
      throw error;
    }
  }

  /**
   * Set up Voice Activity Detection using Web Audio API
   * @param {MediaStreamAudioSourceNode} audioSource - Audio source node
   */
  async setupVAD(audioSource) {
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    audioSource.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    this.vadProcessor = () => {
      if (!this.isSessionActive) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;
      
      // Speech detected
      if (volume > this.vadThreshold && !this.isStreaming) {
        this.startStreaming();
      }
      // Silence detected
      else if (volume < this.silenceThreshold && this.isStreaming) {
        this.scheduleStreamingStop();
      }
      // Continue speaking (reset silence timer)
      else if (volume > this.vadThreshold && this.isStreaming) {
        this.clearSilenceTimer();
      }
    };

    // Run VAD check every 50ms
    this.vadInterval = setInterval(this.vadProcessor, 50);
  }

  /**
   * Start streaming audio chunks
   */
  startStreaming() {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    this.clearSilenceTimer();
    this.updateState('streaming');
    console.log('🎤 Voice streaming started (speech detected)');
  }

  /**
   * Schedule streaming stop after silence timeout
   */
  scheduleStreamingStop() {
    if (this.silenceTimer) return; // Timer already set
    
    this.silenceTimer = setTimeout(() => {
      if (this.isStreaming) {
        this.stopStreaming();
      }
    }, this.silenceTimeout);
  }

  /**
   * Clear silence timer
   */
  clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Stop streaming audio chunks
   */
  stopStreaming() {
    if (!this.isStreaming) return;
    
    this.isStreaming = false;
    this.clearSilenceTimer();
    this.updateState('processing');
    console.log('🤐 Voice streaming stopped (silence detected)');
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
    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Stop VAD processing
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    // Clear silence timer
    this.clearSilenceTimer();

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }

    // Stop all tracks
    if (this.mediaRecorder && this.mediaRecorder.stream) {
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    this.isStreaming = false;
    console.log('🔇 Audio capture stopped');
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
   * Play AI audio response
   * @param {string} base64Audio - Base64 encoded audio
   * @param {string} mimeType - Audio MIME type
   */
  async playAudioResponse(base64Audio, mimeType = 'audio/wav') {
    try {
      this.updateState('speaking');
      
      // Convert base64 to audio blob
      const audioBlob = this.base64ToBlob(base64Audio, mimeType);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      // Set up audio event handlers
      audio.onended = () => {
        this.updateState('listening');
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        this.updateState('listening');
        URL.revokeObjectURL(audioUrl);
      };
      
      // Play audio response
      await audio.play();
      
      if (this.onAudioResponse) {
        this.onAudioResponse(audioBlob);
      }
      
    } catch (error) {
      console.error('Error playing audio response:', error);
      this.updateState('listening');
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
