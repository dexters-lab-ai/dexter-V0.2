import express from 'express';
import { renderSentinelPage, searchSentinel, getSearchStatus, saveSearchResult, getSavedResult, processVoiceInput, getUserSearchHistory } from '../core/sentinel/SentinelAPI.js';

const router = express.Router();

/**
 * Main route for the SENTINEL API page
 * Renders the UI for the SENTINEL search interface
 */
router.get('/', async (req, res) => {
  try {
    const htmlContent = await renderSentinelPage();
    res.status(200).send(htmlContent);
  } catch (error) {
    console.error('Error rendering SENTINEL page:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>SENTINEL API Error</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="background:#111;color:#f33;">
          <h1>SENTINEL Error</h1>
          <p>Failed to load SENTINEL API: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * Search endpoint that accepts:
 * - Text queries (natural language)
 * - Contract addresses (for tokens)
 * - URLs (for scraping)
 */
router.post('/search', async (req, res) => {
  try {
    const { query, type } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    const results = await searchSentinel(query, type);
    res.status(200).json(results);
  } catch (error) {
    console.error('Error in SENTINEL search:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint for raw data view
 */
router.get('/raw/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Fetch raw search results by ID from storage/cache
    const searchResults = await getSearchStatus(id);
    
    if (!searchResults) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    res.status(200).json(searchResults);
  } catch (error) {
    console.error('Error fetching raw SENTINEL data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Endpoint for saving search results
 * Requires wallet address for user identification
 */
router.post('/save', async (req, res) => {
  try {
    const { id, notes, walletAddress } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get the search data from the cache or search history
    const searchResults = await getSearchStatus(id);
    
    if (!searchResults || !searchResults.results) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    // Add notes and wallet address to the search data
    const dataToSave = {
      ...searchResults,
      notes: notes || '',
      walletAddress
    };
    
    // Save the search results with user's wallet address
    const savedResult = await saveSearchResult(id, dataToSave, walletAddress);
    res.status(200).json(savedResult);
  } catch (error) {
    console.error('Error saving SENTINEL results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Status endpoint to check progress of ongoing searches
 * This is used by the frontend polling mechanism
 */
router.get('/status', async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Get the current status of the search
    const status = await getSearchStatus(id);
    res.status(200).json(status);
  } catch (error) {
    console.error('Error fetching SENTINEL search status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Retrieve endpoint to get saved search results by ID
 * Used by the frontend to display past searches from history
 * Requires wallet address for user identification
 */
router.get('/retrieve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get the saved results from the database for this specific wallet address
    const results = await getSavedResult(id, walletAddress);
    
    if (!results) {
      return res.status(404).json({ error: 'Search results not found for your wallet' });
    }
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Error retrieving saved SENTINEL results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Voice endpoint to process audio data from the frontend
 * Uses Gemini API for speech-to-text processing
 */
router.post('/voice', async (req, res) => {
  try {
    const { audio } = req.body;
    
    if (!audio) {
      return res.status(400).json({ 
        success: false, 
        error: 'Audio data is required' 
      });
    }
    
    // Process audio data with Gemini
    const result = await processVoiceInput(audio);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to process audio'
      });
    }
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Error processing voice input:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * History endpoint to get all search history for a user by wallet address
 * Enforces wallet connection requirement and respects history limit
 */
router.get('/history', async (req, res) => {
  try {
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Wallet address is required. Please connect your wallet to use SENTINEL.' 
      });
    }
    
    // Get all search history for this wallet address
    const history = await getUserSearchHistory(walletAddress);
    
    // Return the search history (will be empty array if none found)
    res.status(200).json({
      walletAddress,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('Error retrieving SENTINEL search history:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
