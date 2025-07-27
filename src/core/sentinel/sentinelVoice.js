// sentinelVoice.js - Voice integration for SENTINEL API
import { VoiceService } from '../../services/audio/voiceService.js';
import { geminiService } from '../../services/ai/geminiService.js';
import mongoose from 'mongoose';

// Initialize voice service (without bot parameter for browser usage)
const voiceService = new VoiceService();

// Schema for SENTINEL users with wallet-based identity
const SentinelUserSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  searches: [{
    id: String,
    query: String,
    timestamp: Date,
    summary: String,
    type: String
  }],
  preferences: {
    voiceEnabled: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      default: 'dark'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save middleware to update the 'updatedAt' field
SentinelUserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create the model if it doesn't exist
let SentinelUser;
try {
  SentinelUser = mongoose.model('SentinelUser');
} catch (error) {
  SentinelUser = mongoose.model('SentinelUser', SentinelUserSchema);
}

/**
 * SENTINEL Voice Handler - Manages voice input/output and user identification
 */
class SentinelVoiceHandler {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.audioQueue = [];
    this.isPlaying = false;
    this.currentUser = null;
  }

  /**
   * Initialize the audio context and setup
   */
  initAudio() {
    try {
      // Create audio context
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      console.log('✅ Audio context initialized');
    } catch (error) {
      console.error('❌ Failed to initialize audio context:', error.message);
      throw new Error('Browser does not support Web Audio API');
    }
  }

  /**
   * Connect to user's microphone
   * @returns {Promise<boolean>} Success status
   */
  async connectMicrophone() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices API not supported in this browser');
      }

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Setup the media recorder
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        // Process recorded audio
        if (this.audioChunks.length) {
          await this.processAudio();
        }
      };

      return true;
    } catch (error) {
      console.error('❌ Microphone access error:', error.message);
      return false;
    }
  }

  /**
   * Start recording audio from the microphone
   */
  startRecording() {
    if (this.mediaRecorder && !this.isRecording) {
      this.audioChunks = [];
      this.mediaRecorder.start();
      this.isRecording = true;
      console.log('🎤 Started recording');
    } else {
      console.warn('⚠️ Cannot start recording - recorder not initialized or already recording');
    }
  }

  /**
   * Stop recording audio from the microphone
   */
  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      console.log('🛑 Stopped recording');
    } else {
      console.warn('⚠️ Cannot stop recording - recorder not initialized or not recording');
    }
  }

  /**
   * Process recorded audio through Gemini
   */
  async processAudio() {
    try {
      // Combine audio chunks into a single blob
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
      
      // Convert blob to buffer for processing
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // UI updates for processing state
      this.updateMicAnimation('processing');
      
      // Process through Gemini service
      await geminiService.processAudioStream(
        arrayBuffer,
        (textChunk) => this.handleTextResponse(textChunk),
        (audioData, mimeType) => this.handleAudioResponse(audioData, mimeType)
      );
      
      // Reset animation state when complete
      this.updateMicAnimation('idle');
    } catch (error) {
      console.error('❌ Error processing audio:', error.message);
      this.updateMicAnimation('error');
      
      // Show error message
      if (window.showNotification) {
        window.showNotification('Failed to process voice input', 'error');
      }
    }
  }

  /**
   * Handle text response from Gemini
   * @param {string} textChunk - Text chunk from Gemini
   */
  handleTextResponse(textChunk) {
    // Get the response container
    const responseContainer = document.getElementById('sentinelResponse');
    
    if (responseContainer) {
      // Create or get a paragraph for the response
      let responsePara = document.getElementById('voice-response-text');
      if (!responsePara) {
        responsePara = document.createElement('p');
        responsePara.id = 'voice-response-text';
        responsePara.className = 'voice-response';
        responseContainer.appendChild(responsePara);
      }
      
      // Append the text chunk
      responsePara.textContent += textChunk;
    } else {
      console.warn('⚠️ Response container not found');
    }
  }

  /**
   * Handle audio response from Gemini
   * @param {string} audioData - Base64 encoded audio data
   * @param {string} mimeType - MIME type of the audio
   */
  handleAudioResponse(audioData, mimeType) {
    try {
      // Convert base64 to binary data
      const binaryData = atob(audioData);
      const bytes = new Uint8Array(binaryData.length);
      
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      
      // Create an audio blob
      const audioBlob = new Blob([bytes], { type: mimeType });
      
      // Add to audio queue for playback
      const audioUrl = URL.createObjectURL(audioBlob);
      this.audioQueue.push(audioUrl);
      
      // Start playing if not already playing
      if (!this.isPlaying) {
        this.playNextAudio();
      }
    } catch (error) {
      console.error('❌ Error handling audio response:', error.message);
    }
  }

  /**
   * Play the next audio in the queue
   */
  playNextAudio() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    
    this.isPlaying = true;
    const audioUrl = this.audioQueue.shift();
    
    const audio = new Audio();
    audio.src = audioUrl;
    
    audio.onended = () => {
      URL.revokeObjectURL(audio.src); // Clean up
      this.playNextAudio(); // Play next in queue
    };
    
    audio.onerror = (error) => {
      console.error('❌ Audio playback error:', error);
      URL.revokeObjectURL(audio.src);
      this.playNextAudio(); // Try next in queue
    };
    
    audio.play().catch(error => {
      console.error('❌ Failed to play audio:', error.message);
      this.playNextAudio(); // Try next in queue
    });
  }

  /**
   * Update the microphone animation state
   * @param {string} state - Animation state ('idle', 'listening', 'processing', 'speaking', 'error')
   */
  updateMicAnimation(state) {
    const micButton = document.getElementById('sentinelMicButton');
    if (!micButton) return;
    
    // Remove all state classes
    micButton.classList.remove('idle', 'listening', 'processing', 'speaking', 'error');
    
    // Add the new state class
    micButton.classList.add(state);
    
    // Update the icon based on state
    const micIcon = micButton.querySelector('i') || document.createElement('i');
    micIcon.className = 'fas';
    
    switch (state) {
      case 'listening':
        micIcon.classList.add('fa-microphone', 'pulse');
        break;
      case 'processing':
        micIcon.classList.add('fa-cog', 'fa-spin');
        break;
      case 'speaking':
        micIcon.classList.add('fa-volume-up', 'pulse');
        break;
      case 'error':
        micIcon.classList.add('fa-exclamation-circle');
        break;
      default: // idle
        micIcon.classList.add('fa-microphone');
        break;
    }
    
    if (!micButton.contains(micIcon)) {
      micButton.appendChild(micIcon);
    }
  }

  /**
   * Set current user by wallet address
   * @param {string} walletAddress - User's wallet address
   */
  async setCurrentUser(walletAddress) {
    if (!walletAddress) {
      console.warn('⚠️ No wallet address provided');
      return;
    }
    
    try {
      // Find or create user by wallet address
      let user = await SentinelUser.findOne({ walletAddress });
      
      if (!user) {
        user = new SentinelUser({
          walletAddress,
          searches: []
        });
        await user.save();
        console.log(`✅ Created new SENTINEL user for wallet: ${walletAddress}`);
      } else {
        console.log(`✅ Found existing SENTINEL user for wallet: ${walletAddress}`);
      }
      
      this.currentUser = user;
      return user;
    } catch (error) {
      console.error('❌ Error setting current user:', error.message);
      return null;
    }
  }

  /**
   * Get the current user
   * @returns {Object|null} Current user object or null
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Add a search to user's history
   * @param {string} searchId - Search ID
   * @param {string} query - Search query
   * @param {string} type - Search type
   * @param {string} summary - Search summary
   */
  async addSearchToUserHistory(searchId, query, type, summary) {
    if (!this.currentUser || !this.currentUser.walletAddress) {
      console.warn('⚠️ No user set for saving search');
      return;
    }
    
    try {
      // Add search to user's history
      this.currentUser.searches.push({
        id: searchId,
        query,
        timestamp: new Date(),
        summary: summary || '',
        type
      });
      
      // Limit to last 50 searches
      if (this.currentUser.searches.length > 50) {
        this.currentUser.searches = this.currentUser.searches.slice(-50);
      }
      
      // Save the updated user
      await this.currentUser.save();
      console.log(`✅ Added search to user history: ${searchId}`);
      return true;
    } catch (error) {
      console.error('❌ Error adding search to user history:', error.message);
      return false;
    }
  }

  /**
   * Get user's search history
   * @param {number} limit - Maximum number of searches to return
   * @returns {Array} Search history
   */
  async getUserSearchHistory(limit = 10) {
    if (!this.currentUser) {
      console.warn('⚠️ No user set for retrieving search history');
      return [];
    }
    
    try {
      // Get searches sorted by timestamp (newest first)
      const searches = [...this.currentUser.searches]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
        
      return searches;
    } catch (error) {
      console.error('❌ Error getting user search history:', error.message);
      return [];
    }
  }
}

export const sentinelVoice = new SentinelVoiceHandler();
