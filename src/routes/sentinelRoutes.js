import express from 'express';
import { renderSentinelPage, searchSentinel, getSearchStatus, saveSearchResult, getSavedResult } from '../core/sentinel/SentinelAPI.js';

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
 */
router.post('/save', async (req, res) => {
  try {
    const { id, notes } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Get the search data from the cache or search history
    const searchResults = await getSearchStatus(id);
    
    if (!searchResults || !searchResults.results) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    // Add notes to the search data if provided
    const dataToSave = {
      ...searchResults,
      notes: notes || ''
    };
    
    // Save the search results with optional user notes
    const savedResult = await saveSearchResult(id, dataToSave);
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
 */
router.get('/retrieve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Search ID is required' });
    }
    
    // Get the saved results from the database
    const results = await getSavedResult(id);
    
    if (!results) {
      return res.status(404).json({ error: 'Search results not found' });
    }
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Error retrieving saved SENTINEL results:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
