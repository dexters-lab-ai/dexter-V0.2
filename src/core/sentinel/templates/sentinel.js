// SENTINEL API JavaScript
console.log('Sentinel.js loaded - Version: ' + new Date().getTime());
import { VoiceStreamingClient } from '../VoiceStreamingClient.js';
    // Elements
    const searchInput = document.getElementById('sentinelSearch');
    const searchButton = document.getElementById('searchButton');
    const micButton = document.getElementById('sentinelMicButton');
    const connectWalletButton = document.getElementById('connectWalletButton');
    const resultsSection = document.getElementById('resultsSection');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const suggestionChips = document.querySelectorAll('.sentinel-suggestion-chip');
    const rawDataBtn = document.getElementById('viewRawDataBtn');
    const saveResultsBtn = document.getElementById('saveResultsBtn');
    const rawDataModal = document.getElementById('rawDataModal');
    const saveModal = document.getElementById('saveModal');
    const rawDataContent = document.getElementById('rawDataContent');
    const confirmSaveBtn = document.getElementById('confirmSaveBtn');
    const saveNotes = document.getElementById('saveNotes');
    const resultActions = document.getElementById('resultActions');
    const summaryContent = document.getElementById('summaryContent');
    const aiSummarySection = document.getElementById('aiSummarySection');
    const expandSummaryBtn = document.getElementById('expandSummaryBtn');
    const copySummaryBtn = document.getElementById('copySummaryBtn');
    const timelineContainer = document.getElementById('timelineContainer');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    
    // Current search ID and data
    let currentSearchId = null;
    let currentResults = null;
    
    // Search history in memory (will be saved to localStorage)
    let searchHistory = [];
    
    // Voice Client
    const voiceClient = new VoiceStreamingClient();
    
    // Wallet connection state
    let walletConnected = false;
    let walletAddress = null;

    // AI Result Summarization
    function generateResultSummary(results) {
        try {
            // Input validation
            if (!results || typeof results !== 'object') {
                console.error('Invalid results object provided to generateResultSummary');
                return 'No valid results to summarize';
            }
            
            // Clear previous summary
            clearSummary();
            
            // Generate summary based on result type
            let summary = 'SENTINEL API search results: ';
            
            // Ensure consistent property naming - check both possible property names
            const tokenInfo = results.tokenInfo || {};
            const securityAnalysis = results.securityAnalysis || results.security || {};
            const socialData = results.socialData || results.social || {};
            const tokenMetadata = results.tokenMetadata || results.metadata || {};
            
            if (tokenInfo && Object.keys(tokenInfo).length > 0) {
                const token = tokenInfo;
                summary += `${token.name || token.symbol || 'Unknown token'} (${token.symbol || '??'}) `;
                
                if (token.price) {
                    summary += `currently priced at ${formatCurrency(token.price)}. `;
                }
                
                if (token.volume24h) {
                    summary += `24h volume: ${formatCurrency(token.volume24h)}. `;
                }
                
                if (token.marketCap) {
                    summary += `Market cap: ${formatCurrency(token.marketCap)}. `;
                }
            }
            
            if (securityAnalysis && securityAnalysis.score !== undefined) {
                summary += `Security score: ${securityAnalysis.score}/100. `;
                
                if (securityAnalysis.risks && securityAnalysis.risks.length > 0) {
                    const riskCount = securityAnalysis.risks.length;
                    const highRisks = securityAnalysis.risks.filter(r => r.severity === 'high').length;
                    
                    if (highRisks > 0) {
                        summary += `Found ${riskCount} risk factors including ${highRisks} high severity issues. `;
                    } else {
                        summary += `Found ${riskCount} minor risk factors. `;
                    }
                } else {
                    summary += 'No significant risks detected. ';
                }
            }
            
            if (socialData && socialData.tweetCount !== undefined) {
                summary += `Found ${socialData.tweetCount} tweets `;
                
                if (socialData.sentiment) {
                    summary += `with overall ${socialData.sentiment} sentiment. `;
                }
            }
            
            if (tokenMetadata && tokenMetadata.holders !== undefined) {
                summary += `Token has ${formatNumber(tokenMetadata.holders)} holders. `;
            }
            
            // Limit to 300 characters for conciseness
            if (summary.length > 300) {
                summary = summary.substring(0, 297) + '...';
            }
            
            // Update summary in UI
            updateSummaryUI(summary);
            
            // Update the search history item with the summary
            if (currentSearchId) {
                updateSearchHistorySummary(currentSearchId, summary);
            }
            
            return summary;
        } catch (error) {
            console.error('Error generating summary:', error);
            const errorSummary = 'Unable to generate summary due to an error.';
            updateSummaryUI(errorSummary);
            return errorSummary;
        }
    }
    
    // Update summary UI
    function updateSummaryUI(summary) {
        try {
            if (!summaryContent) {
                console.warn('Summary content element not found');
                return;
            }
            
            if (!summary || typeof summary !== 'string') {
                summary = 'No summary available';
            }
            
            summaryContent.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = summary;
            summaryContent.appendChild(p);
            
            // Show the summary section if it exists
            if (aiSummarySection) {
                aiSummarySection.classList.add('fade-in');
            }
        } catch (error) {
            console.error('Error updating summary UI:', error);
        }
    }
    
    // Clear summary
    function clearSummary() {
        try {
            if (!summaryContent) {
                console.warn('Summary content element not found');
                return;
            }
            
            summaryContent.innerHTML = '<p class="sentinel-empty-summary">AI will provide a summary of your search results here</p>';
        } catch (error) {
            console.error('Error clearing summary:', error);
        }
    }
    
    // Search History Management
    function loadSearchHistory() {
        try {
            const storedHistory = localStorage.getItem('sentinel-search-history');
            if (storedHistory) {
                const parsedHistory = JSON.parse(storedHistory);
                
                // Validate that the parsed data is an array
                if (Array.isArray(parsedHistory)) {
                    searchHistory = parsedHistory;
                    console.log(`Loaded ${searchHistory.length} search history items`);
                    renderSearchHistory();
                } else {
                    console.warn('Invalid search history format in localStorage, resetting');
                    searchHistory = [];
                    // Clear the invalid data
                    localStorage.removeItem('sentinel-search-history');
                }
            } else {
                // No history found, initialize empty array
                searchHistory = [];
            }
        } catch (error) {
            console.error('Error loading search history:', error);
            searchHistory = [];
            // Attempt to clear potentially corrupted data
            try {
                localStorage.removeItem('sentinel-search-history');
            } catch (e) {
                console.error('Failed to clear corrupted search history:', e);
            }
        }
    }
    
    function saveSearchHistory() {
        try {
            // Validate searchHistory is an array
            if (!Array.isArray(searchHistory)) {
                console.error('Invalid search history format, resetting');
                searchHistory = [];
            }
            
            // Limit history to last 15 searches
            if (searchHistory.length > 15) {
                searchHistory = searchHistory.slice(0, 15);
            }
            
            // Try to serialize and save
            const serialized = JSON.stringify(searchHistory);
            localStorage.setItem('sentinel-search-history', serialized);
            console.log(`Saved ${searchHistory.length} search history items`);
        } catch (error) {
            console.error('Error saving search history:', error);
            // Attempt to save an empty array instead
            try {
                localStorage.setItem('sentinel-search-history', '[]');
            } catch (e) {
                console.error('Failed to reset search history in localStorage:', e);
            }
        }
    }
    
    function addToSearchHistory(searchItem) {
        try {
            // Validate input
            if (!searchItem || typeof searchItem !== 'object') {
                console.error('Invalid search item format', searchItem);
                return;
            }
            
            // Ensure searchHistory is an array
            if (!Array.isArray(searchHistory)) {
                console.warn('searchHistory is not an array, resetting');
                searchHistory = [];
            }
            
            // Add to beginning (newest first)
            searchHistory.unshift(searchItem);
            
            // Persist changes
            saveSearchHistory();
            renderSearchHistory();
            
            console.log(`Added search item to history: ${searchItem.query || 'Unknown query'}`);
        } catch (error) {
            console.error('Error adding to search history:', error);
        }
    }
    
    function updateSearchHistorySummary(searchId, summary) {
        try {
            // Validate inputs
            if (!searchId) {
                console.error('Invalid searchId provided to updateSearchHistorySummary');
                return;
            }
            
            if (!summary || typeof summary !== 'string') {
                console.warn('Invalid summary provided, using empty string');
                summary = '';
            }
            
            // Ensure searchHistory is an array
            if (!Array.isArray(searchHistory)) {
                console.error('searchHistory is not an array in updateSearchHistorySummary');
                searchHistory = [];
                return; // Nothing to update
            }
            
            // Find the search item by ID
            const index = searchHistory.findIndex(item => item && item.id === searchId);
            
            if (index !== -1) {
                searchHistory[index].summary = summary;
                console.log(`Updated summary for search item: ${searchId}`);
                
                // Persist changes
                saveSearchHistory();
                renderSearchHistory();
            } else {
                console.warn(`Search item with ID ${searchId} not found in history`);
            }
        } catch (error) {
            console.error('Error updating search history summary:', error);
        }
    }
    
    function clearSearchHistory() {
        try {
            console.log('Clearing search history');
            searchHistory = [];
            
            // Persist changes
            saveSearchHistory();
            renderSearchHistory();
        } catch (error) {
            console.error('Error clearing search history:', error);
            
            // Attempt direct localStorage removal as fallback
            try {
                localStorage.removeItem('sentinel-search-history');
            } catch (e) {
                console.error('Failed to clear search history from localStorage:', e);
            }
        }
    }
    
    function renderSearchHistory() {
        try {
            // Validate container exists
            if (!timelineContainer) {
                console.warn('Timeline container not found');
                return;
            }
            
            // Ensure searchHistory is an array
            if (!Array.isArray(searchHistory)) {
                console.error('searchHistory is not an array in renderSearchHistory');
                searchHistory = [];
            }
            
            // Clear existing items
            timelineContainer.innerHTML = '';
            
            // Hide entire timeline if history is empty
            const searchHistoryTimeline = document.getElementById('searchHistoryTimeline');
            if (searchHistory.length === 0) {
                if (searchHistoryTimeline) {
                    searchHistoryTimeline.style.display = 'none';
                }
                timelineContainer.innerHTML = `
                    <div class="sentinel-timeline-placeholder">
                        <p>Your search history will appear here</p>
                    </div>
                `;
                return;
            } else {
                // Show timeline if we have history
                if (searchHistoryTimeline) {
                    searchHistoryTimeline.style.display = 'block';
                }
            }
            
            // Add each item to timeline
            searchHistory.forEach((item, index) => {
                try {
                    // Validate item has required properties
                    if (!item || !item.id || !item.query) {
                        console.warn(`Invalid search history item at index ${index}`, item);
                        return; // Skip this item
                    }
                    
                    const timelineItem = document.createElement('div');
                    timelineItem.className = 'sentinel-timeline-item';
                    timelineItem.dataset.searchId = item.id;
                    
                    // Format timestamp safely
                    let formattedTime = 'Unknown time';
                    try {
                        if (item.timestamp) {
                            formattedTime = new Date(item.timestamp).toLocaleTimeString() + ' ' + 
                                new Date(item.timestamp).toLocaleDateString();
                        }
                    } catch (e) {
                        console.warn(`Error formatting timestamp for item ${item.id}:`, e);
                    }
                    
                    // Sanitize content before insertion
                    const safeQuery = (item.query || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    
                    timelineItem.innerHTML = `
                        <div class="sentinel-query">${safeQuery}</div>
                        <span class="sentinel-time">${formattedTime}</span>
                    `;
                    
                    // Add click event listener
                    timelineItem.addEventListener('click', () => {
                        try {
                            loadSearchFromHistory(item.id);
                        } catch (e) {
                            console.error(`Error loading search from history: ${item.id}`, e);
                        }
                    });
                    
                    timelineContainer.appendChild(timelineItem);
                } catch (itemError) {
                    console.error(`Error rendering timeline item at index ${index}:`, itemError);
                }
            });
            
            console.log(`Rendered ${searchHistory.length} search history items`);
        } catch (error) {
            console.error('Error rendering search history:', error);
        }
    }
    
    async function loadSearchFromHistory(searchId) {
        try {
            if (!searchId) {
                console.error('Invalid searchId provided to loadSearchFromHistory');
                return;
            }
            
            console.log(`Loading search from history: ${searchId}`);
            showLoading(true);
            
            // Find item in history
            const historyItem = searchHistory.find(item => item && item.id === searchId);
            if (!historyItem) {
                throw new Error(`Search with ID ${searchId} not found in history`);
            }
            
            try {
                // Fetch results from server
                const response = await fetch(`/api/sentinel/retrieve/${searchId}`);
                if (!response.ok) {
                    throw new Error(`API returned status ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data || !data.results) {
                    throw new Error('Results data not found or invalid');
                }
                
                // Update current search values
                currentSearchId = searchId;
                currentResults = data.results;
                
                // Clear previous results with fade-out effect
                if (resultsSection) {
                    resultsSection.classList.add('fade-out');
                    
                    // Use setTimeout to allow animation to complete
                    setTimeout(() => {
                        try {
                            resultsSection.innerHTML = '';
                            resultsSection.classList.remove('fade-out');
                            
                            // Display results
                            displayResultsWithAnimation(data.results);
                            
                            // Show result actions if available
                            if (resultActions) {
                                resultActions.style.display = 'flex';
                            }
                            
                            // Update summary if available
                            if (historyItem.summary) {
                                updateSummaryUI(historyItem.summary);
                            } else {
                                generateResultSummary(data.results);
                            }
                            
                            console.log(`Successfully loaded search results for: ${historyItem.query}`);
                        } catch (innerError) {
                            console.error('Error rendering results after fade animation:', innerError);
                            showNotification('Error displaying results', 'error');
                        }
                    }, 300); // 300ms for the fade-out animation to complete
                }
            } catch (fetchError) {
                console.error('Error fetching search results:', fetchError);
                showNotification('Could not load search results from server', 'error');
                showLoading(false);
            }
        } catch (error) {
            console.error('Error loading search from history:', error);
            showNotification('Failed to load search history', 'error');
            showLoading(false);
        }
    }

    /**
     * Shows an overlay prompting the user to connect their wallet
     * This function creates and displays a wallet connection message overlay
     * in the results section or specified container
     * @returns {void}
     */
    /**
     * Show wallet connection overlay with static message
     */
    function showWalletConnectionOverlay() {
        try {
            console.log('🔒 Showing wallet connection overlay');
            
            const overlay = document.getElementById('walletConnectionOverlay');
            if (!overlay) {
                console.error('Wallet connection overlay element not found');
                return;
            }
            
            // Show the overlay
            overlay.classList.add('visible');
            
            // Set up the connect wallet button in the overlay
            const connectBtn = document.getElementById('walletConnectBtn');
            if (connectBtn) {
                // Remove previous listeners to avoid duplicates
                const newConnectBtn = connectBtn.cloneNode(true);
                connectBtn.parentNode.replaceChild(newConnectBtn, connectBtn);
                
                // Add click handler for connect button
                newConnectBtn.addEventListener('click', () => {
                    console.log('Connect wallet clicked from overlay');
                    handleConnectWalletClick();
                });
            }
            
            // Set up the close button
            const closeBtn = document.getElementById('closeWalletOverlay');
            if (closeBtn) {
                // Remove previous listeners to avoid duplicates
                const newCloseBtn = closeBtn.cloneNode(true);
                closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                
                // Add click handler for close button
                newCloseBtn.addEventListener('click', () => {
                    console.log('Close wallet overlay clicked');
                    hideWalletConnectionOverlay();
                });
            }
            
            console.log('✅ Wallet connection overlay displayed with close button');
        } catch (error) {
            console.error('Error showing wallet connection overlay:', error);
        }
    }

    // Handle search with animated results processing
    async function handleSearch() {
        try {
            console.log('🔍 Search initiated - checking wallet connection...');
            console.log('Wallet connected:', walletConnected);
            console.log('Wallet address:', walletAddress);
            
            // Check if wallet is connected first
            if (!walletConnected || !walletAddress) {
                console.warn('🚫 Search blocked: Wallet not connected');
                showNotification('🔒 Wallet Required: Please connect your wallet to use SENTINEL', 'warning');
                showWalletConnectionOverlay();
                return;
            }
            
            console.log('✅ Wallet check passed - proceeding with search...');
            
            // Validate input
            if (!searchInput) {
                console.error('Search input element not found');
                return;
            }
            
            const query = searchInput.value.trim();
            if (!query) {
                showNotification('Please enter a search query', 'warning');
                return;
            }
            
            // Validate search type
            if (!searchTypeSelect) {
                console.error('Search type select element not found');
                return;
            }
            
            let searchType = searchTypeSelect.value;
            const validTypes = ['text', 'contract', 'url', 'auto']; // Add all valid types here
            
            // If type is 'auto', default to 'text' and let the AI backend decide
            if (searchType === 'auto') {
                console.log('Auto search type selected - defaulting to text for AI processing');
                searchType = 'text';
            }
            
            if (!validTypes.includes(searchType)) {
                console.error(`Invalid search type: ${searchType}`);
                showNotification('Invalid search type selected', 'error');
                return;
            }
            
            console.log(`Initiating search: "${query}" (type: ${searchType})`);
            
            // Show loading with AI animation effect
            showLoading(true);
            resetToolStatuses();
            
            // Clear previous results with fade-out effect
            if (resultsSection && resultsSection.children.length > 0) {
                resultsSection.classList.add('fade-out');
                setTimeout(() => {
                    try {
                        resultsSection.innerHTML = '';
                        resultsSection.classList.remove('fade-out');
                    } catch (animError) {
                        console.error('Error clearing previous results:', animError);
                    }
                }, 300);
            }
            
            // Clear previous summary
            clearSummary();
            
            // Show the AI thinking animation
            const sentinelBrain = document.getElementById('sentinelBrain');
            if (sentinelBrain) {
                sentinelBrain.classList.add('pulse');
            }
            
            try {
                // Simulate the AI thinking about which tools to use
                await simulateAiToolSelection();
                
                console.log(`Initiating search for: "${query}"`);

                // Prepare search data with wallet address
                const searchData = {
                    query,
                    walletAddress // Include wallet address in all searches
                };
                
                // Make API call to the backend (correct endpoint)
                const response = await fetch('/sentinel/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(searchData)
                });
                
                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'No error details');
                    
                    // Check if we got HTML instead of a proper JSON error (common with 404s)
                    if (errorText.includes('<!DOCTYPE html>') || errorText.includes('<html>')) {
                        console.error(`Got HTML error response (${response.status})`);
                        throw new Error(`Server error: API endpoint not found (${response.status}). Please check server configuration.`);
                    }
                    
                    throw new Error(`Server error (${response.status}): ${errorText}`);
                }
                
                const data = await response.json().catch(e => {
                    throw new Error(`Invalid JSON response: ${e.message}`);
                });
                
                if (!data) {
                    throw new Error('Empty response received');
                }
                
                if (data.error) {
                    showNotification(data.error, 'error');
                    return;
                }
                
                if (!data.id) {
                    throw new Error('Response missing search ID');
                }
                
                // Save results and search ID
                currentSearchId = data.id;
                currentResults = data;
                
                // Poll for tool status updates if results are still processing
                if (data.status === 'processing') {
                    await pollForResults(data.id);
                } else if (data.results) {
                    // Display results immediately if available
                    if (resultActions) {
                        resultActions.style.display = 'flex';
                        resultActions.classList.add('fade-in');
                    }
                    
                    // Display results with animation
                    displayResultsWithAnimation(data.results);
                    
                    // Generate AI summary of results
                    generateResultSummary(data.results);
                    
                    // Add to search history
                    const searchItem = {
                        id: data.id,
                        query: query,
                        timestamp: Date.now(),
                        summary: null // Will be updated when summary is generated
                    };
                    addToSearchHistory(searchItem);
                } else {
                    throw new Error('No results in response and status not processing');
                }
            } catch (apiError) {
                console.error('API request failed:', apiError);
                showNotification(`Search failed: ${apiError.message}`, 'error');
            }
        } catch (error) {
            console.error('Search handler error:', error);
            showNotification('Search failed. Please try again.', 'error');
        } finally {
            // Stop AI thinking animation
            const sentinelBrain = document.getElementById('sentinelBrain');
            if (sentinelBrain) {
                sentinelBrain.classList.remove('pulse');
            }
            showLoading(false);
        }
    }
    
    // Simulates AI thinking about which tools to use with animated status updates
    async function simulateAiToolSelection() {
        try {
            // Configuration for timing (in ms)
            const config = {
                initialDelay: 800,     // Initial thinking delay
                toolActivationDelay: 400, // Delay between tool activations
                toolNames: ['Token Info', 'Metadata', 'Security', 'Social']
            };
            
            const statusElement = document.getElementById('loadingStatus');
            
            // Show initial thinking status
            if (statusElement) {
                statusElement.textContent = 'Analyzing query...';
                console.log('SENTINEL AI: Analyzing query...');
            } else {
                console.warn('Loading status element not found for animation');
            }
            
            // Wait initial delay before starting tool selection
            await new Promise(resolve => setTimeout(resolve, config.initialDelay));
            
            // Simulate AI selecting tools
            if (statusElement) {
                statusElement.textContent = 'Selecting analysis tools...';
                console.log('SENTINEL AI: Selecting analysis tools...');
            }
            
            // Simulate activating each tool with a delay
            for (const tool of config.toolNames) {
                await new Promise(resolve => setTimeout(resolve, config.toolActivationDelay));
                if (statusElement) {
                    statusElement.textContent = `Activating ${tool} tool...`;
                    console.log(`SENTINEL AI: Activating ${tool} tool...`);
                }
            }
            
            // Final processing message
            if (statusElement) {
                statusElement.textContent = 'Processing request...';
                console.log('SENTINEL AI: Processing request...');
            }
            
            return Promise.resolve(true);
        } catch (error) {
            console.error('Error during AI tool selection simulation:', error);
            // Even on error, we resolve to allow the search flow to continue
            return Promise.resolve(false);
        }
    }
    
    // Poll for results if they're being processed asynchronously
    async function pollForResults(searchId) {
        // Validate input parameter
        if (!searchId) {
            console.error('Invalid searchId provided to pollForResults');
            showNotification('Error tracking search progress', 'error');
            return;
        }

        // Polling configuration
        const config = {
            pollingInterval: 1000,   // Time between polling attempts in ms
            maxAttempts: 20,         // Maximum number of polling attempts
            statusMessages: [        // Rotating messages to show during polling
                'Processing data...',
                'Analyzing results...',
                'Retrieving information...',
                'Correlating data sources...'
            ]
        };
        
        // Initialize tracking variables
        let attempts = 0;
        let statusMessageIndex = 0;
        const statusElement = document.getElementById('loadingStatus');
        
        console.log(`Starting to poll for results: ${searchId}`);
        
        // Main polling loop
        while (attempts < config.maxAttempts) {
            // Update the status message to show progress
            if (statusElement && attempts % 2 === 0) {
                const message = config.statusMessages[statusMessageIndex];
                statusElement.textContent = message;
                statusMessageIndex = (statusMessageIndex + 1) % config.statusMessages.length;
            }
            
            // Wait before the next poll attempt
            await new Promise(resolve => setTimeout(resolve, config.pollingInterval));
            
            try {
                // Make API request to check status (correct endpoint)
                const response = await fetch(`/sentinel/status?id=${searchId}`);
                
                if (!response.ok) {
                    console.warn(`Status check returned ${response.status} for search ${searchId}`);
                    throw new Error(`Server returned status ${response.status} when checking search status`);
                }
                
                // Parse response data
                const data = await response.json().catch(e => {
                    throw new Error(`Failed to parse status response: ${e.message}`);
                });
                
                if (!data) {
                    throw new Error('Empty response received from status endpoint');
                }
                
                console.log(`Poll attempt ${attempts + 1}: Status = ${data.status || 'unknown'}`);
                
                // Update tool statuses based on progress if available
                if (data.toolStatus) {
                    updateProgressiveToolStatus(data.toolStatus);
                }
                
                // If processing is complete, display results and exit polling
                if (data.status === 'complete' && data.results) {
                    console.log('Search processing complete, displaying results');
                    updateToolStatuses(data.results);
                    
                    // Show result actions if available
                    if (resultActions) {
                        resultActions.style.display = 'flex';
                        resultActions.classList.add('fade-in');
                    }
                    
                    await displayResultsWithAnimation(data.results);
                    return true; // Successfully completed
                } else if (data.status === 'error') {
                    throw new Error(data.error || 'An error occurred during search processing');
                }
                
                attempts++;
            } catch (error) {
                console.error(`Error during poll attempt ${attempts + 1}:`, error);
                attempts++;
                
                // Only show error notification on certain failures to avoid spamming the user
                if (attempts % 3 === 0) { 
                    showNotification('Having trouble retrieving results', 'warning');
                }
            }
        }
        
        // If we reach here, polling has timed out
        console.warn(`Polling timed out after ${config.maxAttempts} attempts`);
        showNotification('Search is taking longer than expected. Results will appear when ready.', 'warning');
        return false; // Timed out
    }

    /**
     * Display search results with staggered animation
     * Creates cards for each data type available in the results and adds them
     * to the results section one by one with a sliding animation
     * @param {Object} data - The results data containing token info, metadata, security analysis, and social data
     * @returns {Promise<boolean>} - Promise resolving to true if displayed successfully, false otherwise
     */
    async function displayResultsWithAnimation(data) {
        // Animation timing configuration
        const config = {
            cardAnimationDelay: 300, // ms between card animations
            errorDisplayDuration: 7000, // ms to show error notifications
            placeholderClasses: 'sentinel-placeholder fade-in',
            errorClasses: 'sentinel-placeholder fade-in error'
        };
        
        try {
            console.log('Displaying search results with animation:', data);
            
            // Validate DOM target element
            if (!resultsSection) {
                console.error('Results section DOM element not found');
                showNotification('Cannot display results: UI element missing', 'error');
                return false;
            }
            
            // Clear previous results (should already be cleared with fade-out)
            resultsSection.innerHTML = '';
            
            // Validate input data
            if (!data) {
                console.error('No result data provided to displayResultsWithAnimation');
                showNotification('No result data available to display', 'error');
                
                const noDataEl = document.createElement('div');
                noDataEl.className = config.errorClasses;
                noDataEl.innerHTML = `
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <p>No data received from search. Please try again.</p>
                `;
                resultsSection.appendChild(noDataEl);
                return false;
            }
            
            // Create an array of card creation tasks with labels for better debugging
            const cardCreationTasks = [];
            
            // Add each available data type to our card creators array with error handling
            if (data.tokenInfo && Object.keys(data.tokenInfo).length > 0) {
                // Check if this is an error response
                if (data.tokenInfo.error) {
                    console.warn('TokenInfo contains error:', data.tokenInfo.error);
                    cardCreationTasks.push({ 
                        type: 'tokenInfo', 
                        creator: () => createErrorCard('Token Information', data.tokenInfo.error)
                    });
                } else {
                    cardCreationTasks.push({ 
                        type: 'tokenInfo', 
                        creator: () => createTokenInfoCard(data.tokenInfo)
                    });
                }
            }
            
            if (data.tokenMetadata && Object.keys(data.tokenMetadata).length > 0) {
                // Check if this is an error response
                if (data.tokenMetadata.error) {
                    console.warn('TokenMetadata contains error:', data.tokenMetadata.error);
                    cardCreationTasks.push({ 
                        type: 'tokenMetadata', 
                        creator: () => createErrorCard('Token Metadata', data.tokenMetadata.error)
                    });
                } else {
                    cardCreationTasks.push({ 
                        type: 'tokenMetadata', 
                        creator: () => createMetadataCard(data.tokenMetadata)
                    });
                }
            }
            
            if (data.securityAnalysis && Object.keys(data.securityAnalysis).length > 0) {
                // Check if this is an error response
                if (data.securityAnalysis.error) {
                    console.warn('SecurityAnalysis contains error:', data.securityAnalysis.error);
                    cardCreationTasks.push({ 
                        type: 'securityAnalysis', 
                        creator: () => createErrorCard('Security Analysis', data.securityAnalysis.error)
                    });
                } else {
                    cardCreationTasks.push({ 
                        type: 'securityAnalysis', 
                        creator: () => createSecurityCard(data.securityAnalysis)
                    });
                }
            }
            
            if (data.socialData && (Array.isArray(data.socialData) ? data.socialData.length > 0 : Object.keys(data.socialData).length > 0)) {
                // Check if this is an error response
                if (data.socialData.error) {
                    console.warn('SocialData contains error:', data.socialData.error);
                    cardCreationTasks.push({ 
                        type: 'socialData', 
                        creator: () => createErrorCard('Social Data', data.socialData.error)
                    });
                } else {
                    cardCreationTasks.push({ 
                        type: 'socialData', 
                        creator: () => createSocialCard(data.socialData)
                    });
                }
            }
            
            // If no results
            if (cardCreationTasks.length === 0) {
                console.log('No data available for card creation, displaying empty result placeholder');
                const placeholderEl = document.createElement('div');
                placeholderEl.className = config.placeholderClasses;
                placeholderEl.innerHTML = `
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-search"></i>
                    </div>
                    <p>No results found for your query</p>
                    <p class="subtext">Try adjusting your search terms or selecting a different search type</p>
                `;
                resultsSection.appendChild(placeholderEl);
                return true; // Successfully displayed empty state
            }
            
            // Add cards one by one with animation
            let successfulCards = 0;
            for (const task of cardCreationTasks) {
                console.log(`Creating ${task.type} card...`);
                try {
                    // Create the card
                    const card = task.creator();
                    
                    // Enhanced null/undefined check with detailed logging
                    if (!card) {
                        console.warn(`Card creation failed for ${task.type}: Card is null or undefined`);
                        continue;
                    }
                    
                    // Verify that card is a DOM element that we can add classes to
                    if (!card.classList || typeof card.classList.add !== 'function') {
                        console.error(`Card creation error for ${task.type}: Created card does not have valid classList property`); 
                        continue;
                    }
                    
                    // Add animation class and append to results
                    card.classList.add('slide-in');
                    resultsSection.appendChild(card);
                    successfulCards++;
                    
                    // Wait for the animation to complete before adding the next card
                    await new Promise(resolve => setTimeout(resolve, config.cardAnimationDelay));
                } catch (error) {
                    console.error(`Error creating or appending ${task.type} card:`, error);
                }
            }
            
            // Show notification if no cards were successfully created and displayed
            if (successfulCards === 0 && cardCreationTasks.length > 0) {
                console.error(`Failed to create any cards despite having ${cardCreationTasks.length} data sources`);
                
                const errorEl = document.createElement('div');
                errorEl.className = config.errorClasses;
                errorEl.innerHTML = `
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <p>Error displaying results. Please try again.</p>
                    <p class="subtext">The system encountered an error while rendering your results.</p>
                `;
                resultsSection.appendChild(errorEl);
                
                showNotification('Failed to display search results', 'error', config.errorDisplayDuration);
                return false;
            } 
            
            // Setup card interactivity if we have successful cards
            if (successfulCards > 0) {
                // Add expand/collapse functionality to results cards
                try {
                    setupCardExpansion();
                } catch (setupError) {
                    console.error('Error setting up card expansion:', setupError);
                    // Non-critical error, continue without stopping execution
                }
            }
            
            console.log(`Successfully displayed ${successfulCards} result cards`);
            return true;
        } catch (error) {
            console.error('Fatal error in displayResultsWithAnimation:', error);
            showNotification('An error occurred displaying results', 'error', config.errorDisplayDuration);
            return false;
        }
    }
    
    /**
     * Original display results function (kept for backward compatibility)
     * This is a non-animated version of displayResultsWithAnimation
     * @param {Object} data - The results data containing token info, metadata, security analysis, and social data
     * @returns {boolean} - True if displayed successfully, false otherwise
     */
    function displayResults(data) {
        try {
            // Validate DOM target element
            if (!resultsSection) {
                console.error('Results section DOM element not found');
                showNotification('Cannot display results: UI element missing', 'error');
                return false;
            }
            
            // Validate input data
            if (!data) {
                console.error('No result data provided to displayResults');
                showNotification('No result data available to display', 'error');
                
                if (resultsSection) {
                    resultsSection.innerHTML = `
                        <div class="sentinel-placeholder error">
                            <div class="sentinel-placeholder-icon">
                                <i class="fas fa-exclamation-triangle"></i>
                            </div>
                            <p>No data received from search. Please try again.</p>
                        </div>
                    `;
                }
                return false;
            }
            
            // Clear previous results
            resultsSection.innerHTML = '';
            let successfulCards = 0;

            // Process token info if available
            if (data.tokenInfo && Object.keys(data.tokenInfo).length > 0) {
                try {
                    const tokenInfoCard = createTokenInfoCard(data.tokenInfo);
                    if (tokenInfoCard && tokenInfoCard.nodeType === Node.ELEMENT_NODE) {
                        resultsSection.appendChild(tokenInfoCard);
                        successfulCards++;
                    }
                } catch (error) {
                    console.error('Error creating or appending token info card:', error);
                }
            }
            
            // Process token metadata if available
            if (data.tokenMetadata && Object.keys(data.tokenMetadata).length > 0) {
                try {
                    const metadataCard = createMetadataCard(data.tokenMetadata);
                    if (metadataCard && metadataCard.nodeType === Node.ELEMENT_NODE) {
                        resultsSection.appendChild(metadataCard);
                        successfulCards++;
                    }
                } catch (error) {
                    console.error('Error creating or appending metadata card:', error);
                }
            }
            
            // Process security analysis if available
            if (data.securityAnalysis && Object.keys(data.securityAnalysis).length > 0) {
                try {
                    const securityCard = createSecurityCard(data.securityAnalysis);
                    if (securityCard && securityCard.nodeType === Node.ELEMENT_NODE) {
                        resultsSection.appendChild(securityCard);
                        successfulCards++;
                    }
                } catch (error) {
                    console.error('Error creating or appending security card:', error);
                }
            }
            
            // Process social data if available
            if (data.socialData && (Array.isArray(data.socialData) ? data.socialData.length > 0 : Object.keys(data.socialData).length > 0)) {
                try {
                    const socialCard = createSocialCard(data.socialData);
                    if (socialCard && socialCard.nodeType === Node.ELEMENT_NODE) {
                        resultsSection.appendChild(socialCard);
                        successfulCards++;
                    }
                } catch (error) {
                    console.error('Error creating or appending social card:', error);
                }
            }

            // If no results or all card creations failed
            if (successfulCards === 0) {
                console.log('No successful cards created, displaying placeholder');
                resultsSection.innerHTML = `
                    <div class="sentinel-placeholder">
                        <div class="sentinel-placeholder-icon">
                            <i class="fas fa-search"></i>
                        </div>
                        <p>No results found for your query</p>
                        <p class="subtext">Try adjusting your search terms or selecting a different search type</p>
                    </div>
                `;
                return true; // Successfully displayed empty state message
            }

            // Only setup card expansion if we have at least one card successfully added
            try {
                setupCardExpansion();
            } catch (setupError) {
                console.error('Error setting up card expansion:', setupError);
                // Non-critical error, continue without stopping execution
            }
            
            return true;
        } catch (error) {
            console.error('Error in displayResults:', error);
            showNotification('An error occurred displaying results', 'error');
            return false;
        }
    }

    /**
     * Create a card displaying token information
     * @param {Object} tokenInfo - Token information object containing price, market cap, etc.
     * @returns {HTMLElement|null} - The created card element or null if creation failed
     */
    function createTokenInfoCard(tokenInfo) {
        // Configuration for token card creation
        const config = {
            templateId: 'tokenInfoTemplate',
            cardClass: 'sentinel-result-card token-info-card',
            fallbackImage: '/assets/images/token-placeholder.png',
            fallbackDataUri: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0IiBmaWxsPSJub25lIj48Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMCIgZmlsbD0iIzMzMzMzMyIgLz48dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtc2l6ZT0iMzAiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPj88L3RleHQ+PC9zdmc+Cg==',
            selectors: {
                iconImg: '.sentinel-token-icon img',
                tokenName: '.sentinel-token-details h4',
                tokenPrice: '.sentinel-token-price',
                priceChange: '.sentinel-token-change',
                statValues: '.sentinel-stat-value'
            },
            cssClasses: {
                positive: 'positive',
                negative: 'negative',
                caretUp: 'fa-caret-up',
                caretDown: 'fa-caret-down'
            },
            fallbacks: {
                symbol: '?',
                name: 'Unknown',
                priceChange: 0
            }
        };
        
        try {
            // Validate input
            if (!tokenInfo) {
                console.error('Invalid token info provided to createTokenInfoCard');
                return createErrorCard('Token Info', 'No token information available');
            }
            
            // Check if the template exists
            const templateElement = document.getElementById(config.templateId);
            if (!templateElement) {
                console.error(`Template not found: ${config.templateId}`);
                return createErrorCard('Token Info', 'Template not available');
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = config.cardClass;
            
            // Helper function to safely query and update elements
            function safeQueryAndUpdate(selector, updateFn) {
                const element = template.querySelector(selector);
                if (element) {
                    updateFn(element);
                } else {
                    console.warn(`Element not found in template: ${selector}`);
                }
            }
            
            // Replace template variables with actual data
            // Handle logo with fallbacks
            safeQueryAndUpdate(config.selectors.iconImg, img => {
                img.src = tokenInfo.logo || config.fallbackImage;
                img.alt = tokenInfo.symbol || config.fallbacks.symbol;
                
                // Set onerror handler to use a data URI if the image fails to load
                img.onerror = function() {
                    this.src = config.fallbackDataUri;
                    console.log('Using data URI fallback for token icon');
                };
            });
            
            // Set token name and symbol
            safeQueryAndUpdate(config.selectors.tokenName, element => {
                element.textContent = `${tokenInfo.name || config.fallbacks.name} (${tokenInfo.symbol || config.fallbacks.symbol})`;
            });
            
            // Set token price
            safeQueryAndUpdate(config.selectors.tokenPrice, element => {
                element.textContent = formatPrice(tokenInfo.price);
            });
            
            // Price change with appropriate styling
            safeQueryAndUpdate(config.selectors.priceChange, priceChange => {
                const changeValue = tokenInfo.priceChange24h || config.fallbacks.priceChange;
                const iconElement = priceChange.querySelector('i');
                
                if (changeValue > 0) {
                    priceChange.classList.add(config.cssClasses.positive);
                    if (iconElement) iconElement.classList.add(config.cssClasses.caretUp);
                    priceChange.innerHTML += ` +${formatPercentage(changeValue)}`;
                } else {
                    priceChange.classList.add(config.cssClasses.negative);
                    if (iconElement) iconElement.classList.add(config.cssClasses.caretDown);
                    priceChange.innerHTML += ` ${formatPercentage(changeValue)}`;
                }
            });
            
            // Set statistics safely
            const statElements = template.querySelectorAll(config.selectors.statValues);
            if (statElements.length >= 3) {
                statElements[0].textContent = formatCurrency(tokenInfo.marketCap);
                statElements[1].textContent = formatCurrency(tokenInfo.volume24h);
                statElements[2].textContent = formatCurrency(tokenInfo.liquidity);
            } else {
                console.warn('Not enough stat elements found in token info template');
            }
            
            // Properly handle template content (clone nodes from fragment to element)
            while (template.firstChild) {
                cardElement.appendChild(template.firstChild);
            }
            
            console.log('Token info card created successfully', cardElement);
            return cardElement;
        } catch (error) {
            console.error('Error creating token info card:', error);
            return createErrorCard('Token Information', 'Failed to create token info card');
        }
    }
    
    /**
     * Creates a card displaying social data like tweets and mentions
     * @param {Object|Array} socialData - Social data object or array of social items
     * @returns {HTMLElement} - The created card element or an error card if creation failed
     */
    function createSocialCard(socialData) {
        // Configuration for social card creation
        const config = {
            templateId: 'socialDataTemplate',
            cardClass: 'sentinel-result-card social-card',
            selectors: {
                tweetsList: '.sentinel-tweets-list',
                mentionCount: '.sentinel-mention-count',
                sentimentIndicator: '.sentinel-sentiment-indicator',
                sentimentValue: '.sentinel-sentiment-value'
            },
            classes: {
                tweetItem: 'sentinel-tweet-item',
                tweetAuthor: 'sentinel-tweet-author',
                tweetContent: 'sentinel-tweet-content',
                tweetDate: 'sentinel-tweet-date',
                tweetMetrics: 'sentinel-tweet-metrics',
                noData: 'sentinel-no-data',
                sentimentPositive: 'positive',
                sentimentNeutral: 'neutral',
                sentimentNegative: 'negative'
            },
            maxTweetsToShow: 5,
            sentimentThresholds: {
                positive: 0.6,
                negative: 0.4
            }
        };
        
        try {
            // Validate input
            if (!socialData || (Array.isArray(socialData) && socialData.length === 0) || 
                (!Array.isArray(socialData) && Object.keys(socialData).length === 0)) {
                console.error('Invalid social data provided to createSocialCard');
                return createErrorCard('Social Data', 'No social information available');
            }
            
            // Check if template exists
            const templateElement = document.getElementById(config.templateId);
            if (!templateElement) {
                console.error(`Template not found: ${config.templateId}`);
                return createErrorCard('Social Data', 'Template not available');
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = config.cardClass;
            
            // Parse the data - we support both object format and array format
            const tweets = Array.isArray(socialData) ? socialData : (socialData.tweets || []);
            const mentionCount = !Array.isArray(socialData) ? (socialData.mentionCount || tweets.length) : tweets.length;
            const sentiment = !Array.isArray(socialData) ? (socialData.sentiment || 0.5) : 0.5; // Default neutral
            
            // Update mention count
            const mentionCountElement = template.querySelector(config.selectors.mentionCount);
            if (mentionCountElement) {
                mentionCountElement.textContent = mentionCount.toString();
            }
            
            // Update sentiment indicator
            const sentimentIndicator = template.querySelector(config.selectors.sentimentIndicator);
            const sentimentValue = template.querySelector(config.selectors.sentimentValue);
            
            if (sentimentIndicator && sentimentValue) {
                // Determine sentiment class and text
                let sentimentClass, sentimentText;
                
                if (sentiment >= config.sentimentThresholds.positive) {
                    sentimentClass = config.classes.sentimentPositive;
                    sentimentText = 'Positive';
                } else if (sentiment <= config.sentimentThresholds.negative) {
                    sentimentClass = config.classes.sentimentNegative;
                    sentimentText = 'Negative';
                } else {
                    sentimentClass = config.classes.sentimentNeutral;
                    sentimentText = 'Neutral';
                }
                
                sentimentIndicator.className = `${config.selectors.sentimentIndicator.substring(1)} ${sentimentClass}`;
                sentimentValue.textContent = sentimentText;
                sentimentValue.className = `${config.selectors.sentimentValue.substring(1)} ${sentimentClass}`;
            }
            
            // Add tweets
            const tweetsList = template.querySelector(config.selectors.tweetsList);
            if (tweetsList) {
                if (tweets && tweets.length > 0) {
                    try {
                        const tweetItems = tweets
                            .slice(0, config.maxTweetsToShow)
                            .map(tweet => {
                                // Validate tweet object with defaults
                                const author = tweet?.author || 'Unknown';
                                const content = tweet?.content || 'No content';
                                const date = tweet?.date ? formatDate(new Date(tweet.date)) : 'Unknown date';
                                const likes = tweet?.metrics?.likes || 0;
                                const retweets = tweet?.metrics?.retweets || 0;
                                
                                return `
                                    <div class="${config.classes.tweetItem}">
                                        <div class="${config.classes.tweetAuthor}">${author}</div>
                                        <div class="${config.classes.tweetContent}">${content}</div>
                                        <div class="${config.classes.tweetMetrics}">
                                            <span class="${config.classes.tweetDate}">${date}</span>
                                            <span><i class="fas fa-heart"></i> ${likes}</span>
                                            <span><i class="fas fa-retweet"></i> ${retweets}</span>
                                        </div>
                                    </div>
                                `;
                            })
                            .join('');
                        
                        tweetsList.innerHTML = tweetItems;
                    } catch (tweetError) {
                        console.error('Error processing tweets data:', tweetError);
                        tweetsList.innerHTML = `<div class="${config.classes.noData}">Error processing tweets data</div>`;
                    }
                } else {
                    tweetsList.innerHTML = `<div class="${config.classes.noData}">No tweets found</div>`;
                }
            } else {
                console.warn('Tweets list element not found in social template');
            }
            
            // Properly handle template content (clone nodes from fragment to element)
            while (template.firstChild) {
                cardElement.appendChild(template.firstChild);
            }
            
            console.log('Social card created successfully', cardElement);
            return cardElement;
        } catch (error) {
            console.error('Error creating social card:', error);
            return createErrorCard('Social Data', 'Failed to create social card');
        }
    }
    
    /**
     * Create a generic error card when a specific card creation fails
     * @param {string} title - The title for the error card
     * @param {string} message - The error message to display
     * @returns {HTMLElement} - The error card element
     */
    function createErrorCard(title, message) {
        const errorCard = document.createElement('div');
        errorCard.className = 'sentinel-result-card error-card';
        errorCard.innerHTML = `
            <div class="sentinel-card-header">
                <h4>${title || 'Error'}</h4>
            </div>
            <div class="sentinel-card-body">
                <p class="error-message">${message || 'An error occurred while creating this card'}</p>
            </div>
        `;
        return errorCard;
    }

    /**
     * Create a card displaying token metadata information including holders and snipers
     * @param {Object} metadata - Token metadata object containing holders, distribution, snipers
     * @returns {HTMLElement} - The created card element or an error card if creation failed
     */
    function createMetadataCard(metadata) {
        // Configuration for metadata card creation
        const config = {
            templateId: 'tokenMetadataTemplate',
            cardClass: 'sentinel-result-card metadata-card',
            selectors: {
                chartContainer: '.sentinel-chart-container',
                snipersList: '.sentinel-snipers-list'
            },
            classes: {
                chartPlaceholder: 'sentinel-chart-placeholder',
                distribution: 'sentinel-distribution',
                distBar: 'sentinel-dist-bar',
                sniperItem: 'sentinel-sniper-item',
                sniperAddress: 'sentinel-sniper-address',
                sniperAmount: 'sentinel-sniper-amount',
                noData: 'sentinel-no-data'
            },
            maxSnipersToShow: 5,
            defaultBarWidth: '80%'
        };
        
        try {
            // Validate input
            if (!metadata) {
                console.error('Invalid metadata provided to createMetadataCard');
                return createErrorCard('Token Metadata', 'No metadata information available');
            }
            
            // Check if template exists
            const templateElement = document.getElementById(config.templateId);
            if (!templateElement) {
                console.error(`Template not found: ${config.templateId}`);
                return createErrorCard('Token Metadata', 'Template not available');
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = config.cardClass;
            
            // Add holders chart - we'll use a placeholder for now
            // In a real implementation, you'd use Chart.js or similar to create a proper chart
            const chartContainer = template.querySelector(config.selectors.chartContainer);
            if (chartContainer) {
                const holdersCount = metadata.holders || '?';
                const topWalletsPercentage = metadata.topWallets?.percentage || '?';
                
                chartContainer.innerHTML = `
                    <div class="${config.classes.chartPlaceholder}">
                        <p>Holders: ${holdersCount}</p>
                        <div class="${config.classes.distribution}">
                            <div class="${config.classes.distBar}" style="width: ${config.defaultBarWidth};" title="Top 10 wallets: ${topWalletsPercentage}%">
                                <span>Top 10: ${topWalletsPercentage}%</span>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                console.warn('Chart container element not found in metadata template');
            }
            
            // Add snipers if available
            const snipersList = template.querySelector(config.selectors.snipersList);
            if (snipersList) {
                if (metadata.snipers && Array.isArray(metadata.snipers) && metadata.snipers.length > 0) {
                    // Safely create sniper list items
                    try {
                        const sniperItems = metadata.snipers
                            .slice(0, config.maxSnipersToShow)
                            .map(sniper => {
                                // Validate each sniper object
                                const address = sniper?.address || 'Unknown';
                                const amount = sniper?.amount || 0;
                                
                                return `
                                    <div class="${config.classes.sniperItem}">
                                        <span class="${config.classes.sniperAddress}">${truncateAddress(address)}</span>
                                        <span class="${config.classes.sniperAmount}">${formatCurrency(amount)}</span>
                                    </div>
                                `;
                            })
                            .join('');
                        
                        snipersList.innerHTML = sniperItems;
                    } catch (sniperError) {
                        console.error('Error processing snipers data:', sniperError);
                        snipersList.innerHTML = `<p class="${config.classes.noData}">Error processing snipers data</p>`;
                    }
                } else {
                    snipersList.innerHTML = `<p class="${config.classes.noData}">No sniper data available</p>`;
                }
            } else {
                console.warn('Snipers list element not found in metadata template');
            }
            
            // Properly handle template content (clone nodes from fragment to element)
            while (template.firstChild) {
                cardElement.appendChild(template.firstChild);
            }
            
            console.log('Metadata card created successfully', cardElement);
            return cardElement;
        } catch (error) {
            console.error('Error creating metadata card:', error);
            return createErrorCard('Token Metadata', 'Failed to create metadata card');
        }
    }

    /**
     * Create a card displaying security analysis information including score and risk factors
     * @param {Object} security - Security data object containing score and risk factors
     * @returns {HTMLElement} - The created card element or an error card if creation failed
     */
    function createSecurityCard(security) {
        // Configuration for security card creation
        const config = {
            templateId: 'securityAnalysisTemplate',
            cardClass: 'sentinel-result-card security-card',
            selectors: {
                gaugeProgress: '.sentinel-gauge-progress',
                gaugeText: '.sentinel-gauge-text',
                riskList: '.sentinel-risk-list',
                securityValue: '.sentinel-security-value'
            },
            classes: {
                riskItem: 'sentinel-risk-item',
                riskHeader: 'sentinel-risk-header',
                riskName: 'sentinel-risk-name',
                riskSeverity: 'sentinel-risk-severity',
                riskDescription: 'sentinel-risk-description',
                noData: 'sentinel-no-data'
            },
            scoreThresholds: {
                high: 70,
                medium: 40
            },
            scoreColors: {
                high: 'var(--sentinel-success)',
                medium: 'var(--sentinel-warning)',
                low: 'var(--sentinel-danger)'
            },
            gaugeSvgRadius: 54 // SVG circle radius for gauge
        };
        
        try {
            // Validate input
            if (!security) {
                console.error('Invalid security data provided to createSecurityCard');
                return createErrorCard('Security Analysis', 'No security information available');
            }
            
            // Check if template exists
            const templateElement = document.getElementById(config.templateId);
            if (!templateElement) {
                console.error(`Template not found: ${config.templateId}`);
                return createErrorCard('Security Analysis', 'Template not available');
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = config.cardClass;
            
            // Helper function to safely query and update elements
            function safeQueryAndUpdate(selector, updateFn) {
                const element = template.querySelector(selector);
                if (element) {
                    updateFn(element);
                } else {
                    console.warn(`Element not found in template: ${selector}`);
                }
            }
            
            // Set security score (default to 0 if not provided)
            const score = parseInt(security.score || 0);
            
            // Get required elements with null checks
            const gaugeProgress = template.querySelector(config.selectors.gaugeProgress);
            const gaugeText = template.querySelector(config.selectors.gaugeText);
            const riskList = template.querySelector(config.selectors.riskList);
            
            // Skip gauge updates if elements don't exist
            if (gaugeProgress && gaugeText) {
                // Update gauge values
                const circumference = config.gaugeSvgRadius * 2 * Math.PI;
                const offset = circumference - (score / 100) * circumference;
                gaugeProgress.style.strokeDasharray = `${circumference} ${circumference}`;
                gaugeProgress.style.strokeDashoffset = offset;
                
                // Determine color based on score
                let scoreColor;
                if (score >= config.scoreThresholds.high) {
                    scoreColor = config.scoreColors.high;
                } else if (score >= config.scoreThresholds.medium) {
                    scoreColor = config.scoreColors.medium;
                } else {
                    scoreColor = config.scoreColors.low;
                }
                
                gaugeProgress.style.stroke = scoreColor;
                gaugeText.textContent = `${score}%`;
                
                // Update security rating
                safeQueryAndUpdate(config.selectors.securityValue, element => {
                    element.textContent = getSecurityRating(score);
                    element.style.color = scoreColor;
                });
            } else {
                console.warn('Gauge elements not found in security template');
            }
            
            // Add risk factors
            if (riskList) {
                if (security.risks && Array.isArray(security.risks) && security.risks.length > 0) {
                    try {
                        const riskItems = security.risks.map(risk => {
                            // Validate risk object properties with defaults
                            const name = risk?.name || 'Unknown Risk';
                            const severity = risk?.severity || 'unknown';
                            const description = risk?.description || 'No details available';
                            
                            return `
                                <li class="${config.classes.riskItem} ${severity}">
                                    <div class="${config.classes.riskHeader}">
                                        <span class="${config.classes.riskName}">${name}</span>
                                        <span class="${config.classes.riskSeverity} ${severity}">${severity}</span>
                                    </div>
                                    <p class="${config.classes.riskDescription}">${description}</p>
                                </li>
                            `;
                        }).join('');
                        
                        riskList.innerHTML = riskItems;
                    } catch (riskError) {
                        console.error('Error processing risk data:', riskError);
                        riskList.innerHTML = `<li class="${config.classes.noData}">Error processing risk data</li>`;
                    }
                } else {
                    
                    riskList.innerHTML = `<li class="${config.classes.noData}">No risk factors detected</li>`;
                }
            } else {
                console.warn('Risk list element not found in security template');
            }
            
            // Append the template to our element
            cardElement.appendChild(template);
            return cardElement;
        } catch (error) {
            console.error('Error creating security card:', error);
            return createErrorCard('Security Analysis', 'Failed to create security card');
        }
    }



    
    /**
     * Setup event handlers for card expansion and collapse functionality
     * Attaches click handlers to expansion buttons and handles toggling content visibility
     */
    function setupCardExpansion() {
        // Configuration for card expansion
        const config = {
            selectors: {
                expandButton: '.sentinel-expand-btn',
                resultCard: '.sentinel-result-card',
                resultContent: '.sentinel-result-content'
            },
            icons: {
                expand: 'fa-chevron-down',
                collapse: 'fa-chevron-up'
            },
            display: {
                show: 'block',
                hide: 'none'
            }
        };
        
        try {
            // Get all expansion buttons
            const expandButtons = document.querySelectorAll(config.selectors.expandButton);
            
            if (expandButtons.length === 0) {
                console.warn('No expansion buttons found for card expansion setup');
                return;
            }
            
            // Add click handlers to each button
            expandButtons.forEach(button => {
                button.addEventListener('click', function(event) {
                    try {
                        const card = this.closest(config.selectors.resultCard);
                        if (!card) {
                            console.warn('No parent card found for expansion button');
                            return;
                        }
                        
                        const content = card.querySelector(config.selectors.resultContent);
                        if (!content) {
                            console.warn('Content element not found in card');
                            return;
                        }
                        
                        // Toggle content visibility
                        const isHidden = content.style.display === config.display.hide;
                        content.style.display = isHidden ? config.display.show : config.display.hide;
                        
                        // Update icon safely using classList instead of innerHTML
                        const icon = this.querySelector('i');
                        if (icon) {
                            if (isHidden) {
                                icon.classList.remove(config.icons.expand);
                                icon.classList.add(config.icons.collapse);
                            } else {
                                icon.classList.remove(config.icons.collapse);
                                icon.classList.add(config.icons.expand);
                            }
                        } else {
                            // If icon doesn't exist, create it (safer than using innerHTML)
                            this.textContent = '';
                            const newIcon = document.createElement('i');
                            newIcon.className = `fas ${isHidden ? config.icons.collapse : config.icons.expand}`;
                            this.appendChild(newIcon);
                        }
                    } catch (error) {
                        console.error('Error in card expansion click handler:', error);
                    }
                });
            });
            
            console.log(`Card expansion setup complete for ${expandButtons.length} buttons`);
        } catch (error) {
            console.error('Failed to setup card expansion:', error);
        }
    }

    /**
     * Sets up modal dialogs and their interactive elements including raw data view, save results, etc.
     * Configures event handlers for all modal-related actions.
     */
    function setupModals() {
        // Configuration for modals
        const config = {
            selectors: {
                // Raw data modal selectors
                rawDataModalClose: '#rawDataModal .sentinel-modal-close',
                closeRawDataBtn: 'close-raw-data',
                copyRawDataBtn: 'copy-raw-data',
                downloadRawDataBtn: 'download-raw-data',
                // Save modal selectors
                saveModalClose: '#saveModal .sentinel-modal-close',
                cancelSaveBtn: 'cancel-save'
            },
            classes: {
                active: 'active'
            },
            endpoints: {
                search: '/sentinel/search',
                save: '/sentinel/save',
                raw: '/sentinel/raw',
                status: '/sentinel/status',
                voice: '/sentinel/voice',
                history: '/sentinel/history'
            },
            downloadPrefix: 'sentinel-data-',
            mimeTypes: {
                json: 'data:text/json;charset=utf-8,'
            }
        };
        
        try {
            // Raw data modal
            if (!rawDataBtn) {
                console.error('Raw data button not found');
            } else {
                rawDataBtn.addEventListener('click', async function() {
                    if (!currentSearchId) {
                        showNotification('No active search to show data for', 'warning');
                        return;
                    }
                    
                    try {
                        const response = await fetch(`${config.endpoints.rawData}${currentSearchId}`);
                        const data = await response.json();
                        
                        if (rawDataContent) {
                            rawDataContent.textContent = JSON.stringify(data, null, 2);
                        }
                        
                        if (rawDataModal) {
                            rawDataModal.classList.add(config.classes.active);
                        } else {
                            console.error('Raw data modal element not found');
                        }
                    } catch (error) {
                        console.error('Failed to fetch raw data:', error);
                        showNotification('Failed to fetch raw data', 'error');
                    }
                });
            }
            
            // Close raw data modal
            const closeRawDataModalBtn = document.querySelector(config.selectors.rawDataModalClose);
            if (closeRawDataModalBtn) {
                closeRawDataModalBtn.addEventListener('click', function() {
                    if (rawDataModal) {
                        rawDataModal.classList.remove(config.classes.active);
                    }
                });
            } else {
                console.warn('Raw data modal close button not found');
            }
            
            // Add close button functionality for raw data modal footer
            const closeRawDataBtn = document.getElementById(config.selectors.closeRawDataBtn);
            if (closeRawDataBtn) {
                closeRawDataBtn.addEventListener('click', function() {
                    if (rawDataModal) {
                        rawDataModal.classList.remove(config.classes.active);
                    }
                });
            }
            
            // Copy raw data to clipboard
            const copyRawDataBtn = document.getElementById(config.selectors.copyRawDataBtn);
            if (copyRawDataBtn) {
                copyRawDataBtn.addEventListener('click', function() {
                    try {
                        if (!rawDataContent || !rawDataContent.textContent) {
                            showNotification('No data to copy', 'warning');
                            return;
                        }
                        
                        navigator.clipboard.writeText(rawDataContent.textContent);
                        showNotification('Raw data copied to clipboard', 'success');
                    } catch (error) {
                        console.error('Failed to copy raw data:', error);
                        showNotification('Failed to copy raw data', 'error');
                    }
                });
            }
            
            // Download raw data as JSON file
            const downloadRawDataBtn = document.getElementById(config.selectors.downloadRawDataBtn);
            if (downloadRawDataBtn) {
                downloadRawDataBtn.addEventListener('click', function() {
                    try {
                        if (!rawDataContent || !rawDataContent.textContent) {
                            showNotification('No data to download', 'warning');
                            return;
                        }
                        
                        if (!currentSearchId) {
                            showNotification('No search ID for download', 'warning');
                            return;
                        }
                        
                        const dataStr = config.mimeTypes.json + encodeURIComponent(rawDataContent.textContent);
                        const downloadAnchorNode = document.createElement('a');
                        downloadAnchorNode.setAttribute('href', dataStr);
                        downloadAnchorNode.setAttribute('download', `${config.downloadPrefix}${currentSearchId}.json`);
                        document.body.appendChild(downloadAnchorNode);
                        downloadAnchorNode.click();
                        downloadAnchorNode.remove();
                        showNotification('Raw data downloaded successfully', 'success');
                    } catch (error) {
                        console.error('Failed to download raw data:', error);
                        showNotification('Failed to download raw data', 'error');
                    }
                });
            }
            
            // Save results modal
            if (!saveResultsBtn) {
                console.error('Save results button not found');
            } else {
                saveResultsBtn.addEventListener('click', function() {
                    if (!currentSearchId) {
                        showNotification('No active search to save', 'warning');
                        return;
                    }
                    
                    if (saveModal) {
                        saveModal.classList.add(config.classes.active);
                    } else {
                        console.error('Save modal element not found');
                    }
                });
            }
            
            // Close save modal
            const closeSaveModalBtn = document.querySelector(config.selectors.saveModalClose);
            if (closeSaveModalBtn) {
                closeSaveModalBtn.addEventListener('click', function() {
                    if (saveModal) {
                        saveModal.classList.remove(config.classes.active);
                    }
                });
            } else {
                console.warn('Save modal close button not found');
            }
            
            // Cancel save button
            const cancelSaveBtn = document.getElementById(config.selectors.cancelSaveBtn);
            if (cancelSaveBtn) {
                cancelSaveBtn.addEventListener('click', function() {
                    if (saveModal) {
                        saveModal.classList.remove(config.classes.active);
                    }
                    
                    // Clear the notes field
                    if (saveNotes) {
                        saveNotes.value = '';
                    }
                });
            }
            
            // Confirm save
            if (!confirmSaveBtn) {
                console.error('Confirm save button not found');
            } else {
                confirmSaveBtn.addEventListener('click', async function() {
                    if (!currentSearchId) {
                        showNotification('No search ID to save', 'warning');
                        return;
                    }
                    
                    try {
                        const response = await fetch(config.endpoints.save, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                id: currentSearchId,
                                notes: saveNotes ? saveNotes.value : ''
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.error) {
                            throw new Error(result.error);
                        }
                        
                        // Update the search history to reflect the save
                        const historyItem = searchHistory.find(item => item.id === currentSearchId);
                        if (historyItem) {
                            historyItem.saved = true;
                            historyItem.notes = saveNotes ? saveNotes.value : '';
                            saveSearchHistory();
                        }
                        
                        // Close the modal and show success
                        if (saveModal) {
                            saveModal.classList.remove(config.classes.active);
                        }
                        
                        showNotification('Search results saved successfully', 'success');
                        
                        // Clear the notes field
                        if (saveNotes) {
                            saveNotes.value = '';
                        }
                    } catch (error) {
                        console.error('Error saving search results:', error);
                        showNotification('Failed to save search results: ' + (error.message || 'Unknown error'), 'error');
                    }
                });
            }
            
            console.log('Modals setup complete');
        } catch (error) {
            console.error('Failed to setup modals:', error);
        }
    }

    /**
     * Sets up indicators for the AI tool selection and processing progress.
     * This is a minimal setup function as elements are defined in HTML.
     */
    function setupToolIndicators() {
        // Tool status elements are already defined in HTML template
        // This function can be expanded if dynamic indicators are needed
        console.log('Tool indicators ready for status updates');  
    }

    /**
     * Resets all tool status indicators to the pending state
     * @returns {void}
     */
    function resetToolStatuses() {
        try {
            const indicators = document.querySelectorAll('.sentinel-tool-indicator');
            if (!indicators || indicators.length === 0) {
                console.warn('No tool indicators found to reset');
                return;
            }
            
            indicators.forEach(indicator => {
                if (indicator) {
                    indicator.className = 'sentinel-tool-indicator pending';
                }
            });
            console.log('Tool statuses reset to pending state');
        } catch (error) {
            console.error('Error resetting tool statuses:', error);
        }
    }

    /**
     * Updates tool status indicators based on the final response data
     * @param {Object} data - The response data containing tool results
     * @returns {void}
     */
    function updateToolStatuses(data) {
        try {
            if (!data) {
                console.error('Cannot update tool statuses: No data provided');
                return;
            }
            
            // Configuration for tool statuses
            const config = {
                toolMap: {
                    'tool1Status': { dataKey: 'tokenInfo', icon: 'fa-check-circle', errorIcon: 'fa-exclamation-circle' },
                    'tool2Status': { dataKey: 'tokenMetadata', icon: 'fa-check-circle', errorIcon: 'fa-exclamation-circle' },
                    'tool3Status': { dataKey: 'securityAnalysis', icon: 'fa-check-circle', errorIcon: 'fa-exclamation-circle' },
                    'tool4Status': { dataKey: 'socialData', icon: 'fa-check-circle', errorIcon: 'fa-exclamation-circle' }
                },
                animationDelay: 300
            };
            
            // Build status map from data
            const toolStatusMap = {};
            Object.entries(config.toolMap).forEach(([id, toolConfig]) => {
                toolStatusMap[id] = data[toolConfig.dataKey] ? 'complete' : 'error';
            });
            
            // Update each tool's status
            for (const [id, status] of Object.entries(toolStatusMap)) {
                const toolEl = document.getElementById(id);
                if (!toolEl) {
                    console.warn(`Tool element not found: ${id}`);
                    continue;
                }
                
                const indicator = toolEl.querySelector('.sentinel-tool-indicator');
                if (!indicator) {
                    console.warn(`Tool indicator not found in: ${id}`);
                    continue;
                }
                
                // First set to processing for animation effect
                if (status === 'complete') {
                    indicator.className = 'sentinel-tool-indicator processing';
                    
                    // Use setTimeout to create an animation effect for status changes
                    setTimeout(() => {
                        indicator.className = `sentinel-tool-indicator ${status}`;
                    }, config.animationDelay);
                } else {
                    indicator.className = `sentinel-tool-indicator ${status}`;
                }
                
                // Update the label text
                const label = toolEl.querySelector('.sentinel-tool-name');
                if (!label) {
                    console.warn(`Tool name label not found in: ${id}`);
                    continue;
                }
                
                // Add the appropriate icon based on status
                const toolConfig = config.toolMap[id];
                if (status === 'complete') {
                    label.innerHTML += ` <i class="fas ${toolConfig.icon}"></i>`;
                } else if (status === 'error') {
                    label.innerHTML += ` <i class="fas ${toolConfig.errorIcon}"></i>`;
                }
            }
            console.log('Tool statuses updated based on response data');
        } catch (error) {
            console.error('Error updating tool statuses:', error);
        }
    }
    
    /**
     * Updates tool statuses progressively during processing
     * @param {Object} toolStatus - Object with tool names as keys and status values ('running', 'complete', 'error')
     * @returns {void}
     */
    function updateProgressiveToolStatus(toolStatus) {
        try {
            if (!toolStatus || typeof toolStatus !== 'object') {
                console.error('Invalid tool status data provided');
                return;
            }

            // Configuration for tool mapping and icons
            const config = {
                toolMap: {
                    'tokenInfo': 'tool1Status',
                    'tokenMetadata': 'tool2Status',
                    'securityAnalysis': 'tool3Status',
                    'socialData': 'tool4Status'
                },
                icons: {
                    complete: 'fa-check-circle',
                    error: 'fa-exclamation-circle'
                }
            };
            
            // Process each tool status update
            for (const [tool, status] of Object.entries(toolStatus)) {
                // Get the corresponding element ID
                const id = config.toolMap[tool];
                if (!id) {
                    console.warn(`Unknown tool type: ${tool}`);
                    continue;
                }
                
                // Get the tool element
                const toolEl = document.getElementById(id);
                if (!toolEl) {
                    console.warn(`Tool element not found: ${id}`);
                    continue;
                }
                
                // Get the indicator element
                const indicator = toolEl.querySelector('.sentinel-tool-indicator');
                if (!indicator) {
                    console.warn(`Tool indicator not found in: ${id}`);
                    continue;
                }
                
                // Update status class based on the current status
                switch (status) {
                    case 'running':
                        indicator.className = 'sentinel-tool-indicator processing';
                        break;
                    case 'complete':
                    case 'error':
                        indicator.className = `sentinel-tool-indicator ${status}`;
                        
                        // Get the label element
                        const label = toolEl.querySelector('.sentinel-tool-name');
                        if (!label) {
                            console.warn(`Tool name label not found in: ${id}`);
                            continue;
                        }
                        
                        // Add the appropriate icon based on status
                        const iconClass = config.icons[status];
                        if (iconClass) {
                            // Use a safer approach than direct innerHTML manipulation
                            const iconEl = document.createElement('i');
                            iconEl.className = `fas ${iconClass}`;
                            label.appendChild(document.createTextNode(' '));
                            label.appendChild(iconEl);
                        }
                        break;
                    default:
                        console.warn(`Unknown status type: ${status}`);
                }
            }
            console.log('Tool statuses progressively updated');
        } catch (error) {
            console.error('Error updating progressive tool status:', error);
        }
    }

    /**
     * Shows or hides the loading overlay
     * @param {boolean} show - Whether to show (true) or hide (false) the loading overlay
     * @returns {void}
     */
    function showLoading(show) {
        try {
            if (!loadingOverlay) {
                console.error('Loading overlay element not found');
                return;
            }
            
            if (show) {
                loadingOverlay.classList.add('active');
                console.log('Loading overlay shown');
            } else {
                loadingOverlay.classList.remove('active');
                console.log('Loading overlay hidden');
            }
        } catch (error) {
            console.error('Error toggling loading overlay:', error);
        }
    }

    /**
     * Shows a notification to the user
     * @param {string} message - The notification message to display
     * @param {string} type - The notification type (success, error, warning, info)
     * @returns {void}
     */
    function showNotification(message, type) {
        try {
            if (!message) {
                console.warn('Empty notification message');
                return;
            }
            
            // Log the notification for debugging instead of showing alerts
            console.log(`Notification (${type}): ${message}`);
            
            // Disabled alert system - notifications are now console-only
            // This prevents annoying popups during wallet connection and other operations
            
            // Future enhancement could include:
            // - Creating a custom toast element
            // - Applying different styles based on type
            // - Auto-dismiss after a timeout
            // - Supporting multiple notifications
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    /**
     * Format helpers for consistent data presentation
     * These functions handle different data types with appropriate formatting
     */

    /**
     * Formats a price value with appropriate decimal places based on magnitude
     * @param {number} price - The price to format
     * @returns {string} Formatted price string with currency symbol
     */
    function formatPrice(price) {
        try {
            // Return default value for null, undefined, or non-numeric inputs
            if (price === null || price === undefined || isNaN(parseFloat(price))) {
                return '$0.00';
            }
            
            // Parse to ensure we're working with a number
            const numPrice = parseFloat(price);
            
            // Configure format options based on price magnitude
            const config = {
                locale: 'en-US',
                currency: 'USD',
                options: {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: numPrice < 1 ? 4 : 2,
                    maximumFractionDigits: numPrice < 1 ? 8 : 2
                }
            };
            
            return new Intl.NumberFormat(config.locale, config.options).format(numPrice);
        } catch (error) {
            console.error('Error formatting price:', error);
            return '$0.00'; // Fallback value
        }
    }

    /**
     * Formats a currency value with compact notation for readability
     * @param {number} value - The currency value to format
     * @returns {string} Formatted currency string with compact notation
     */
    function formatCurrency(value) {
        try {
            // Return default value for null, undefined, or non-numeric inputs
            if (value === null || value === undefined || isNaN(parseFloat(value))) {
                return '$0';
            }
            
            // Parse to ensure we're working with a number
            const numValue = parseFloat(value);
            
            // Configure format options
            const config = {
                locale: 'en-US',
                options: { 
                    style: 'currency', 
                    currency: 'USD',
                    notation: 'compact',
                    compactDisplay: 'short'
                }
            };
            
            return new Intl.NumberFormat(config.locale, config.options).format(numValue);
        } catch (error) {
            console.error('Error formatting currency value:', error);
            return '$0'; // Fallback value
        }
    }

    /**
     * Formats a value as a percentage with 2 decimal places
     * @param {number} value - The value to format as percentage
     * @returns {string} Formatted percentage string
     */
    function formatPercentage(value) {
        try {
            // Return default value for null, undefined, or non-numeric inputs
            if (value === null || value === undefined || isNaN(parseFloat(value))) {
                return '0.00%';
            }
            
            // Parse to ensure we're working with a number and use absolute value
            const numValue = Math.abs(parseFloat(value));
            return `${numValue.toFixed(2)}%`;
        } catch (error) {
            console.error('Error formatting percentage:', error);
            return '0.00%'; // Fallback value
        }
    }

    /**
     * Formats a number with compact notation for readability
     * @param {number} num - The number to format
     * @returns {string} Formatted number string with compact notation
     */
    function formatNumber(num) {
        try {
            // Return default value for null, undefined, or non-numeric inputs
            if (num === null || num === undefined || isNaN(parseFloat(num))) {
                return '0';
            }
            
            // Parse to ensure we're working with a number
            const numValue = parseFloat(num);
            
            // Configure format options
            const config = {
                locale: 'en-US',
                options: { notation: 'compact' }
            };
            
            return new Intl.NumberFormat(config.locale, config.options).format(numValue);
        } catch (error) {
            console.error('Error formatting number:', error);
            return '0'; // Fallback value
        }
    }

    /**
     * Formats a date string into a short readable format
     * @param {string} dateStr - The date string to format
     * @returns {string} Formatted date string (e.g. 'Jan 15')
     */
    function formatDate(dateStr) {
        try {
            // Return empty string for null or undefined inputs
            if (!dateStr) return '';
            
            const date = new Date(dateStr);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
                console.warn('Invalid date format:', dateStr);
                return '';
            }
            
            // Configure format options
            const config = {
                locale: 'en-US',
                options: { month: 'short', day: 'numeric' }
            };
            
            return date.toLocaleDateString(config.locale, config.options);
        } catch (error) {
            console.error('Error formatting date:', error);
            return ''; // Fallback value
        }
    }

    /**
     * Truncates a blockchain address for display
     * @param {string} address - The full blockchain address
     * @returns {string} Truncated address (e.g. '0x1234...5678')
     */
    function truncateAddress(address) {
        try {
            // Return empty string for null, undefined, or empty inputs
            if (!address) return '';
            
            // Validate the address has minimum required length
            if (address.length < 12) {
                console.warn('Address too short for truncation:', address);
                return address; // Return as-is if too short to truncate properly
            }
            
            // Configure truncation options
            const config = {
                prefixLength: 6,
                suffixLength: 4,
                separator: '...'
            };
            
            return `${address.substring(0, config.prefixLength)}${config.separator}${address.substring(address.length - config.suffixLength)}`;
        } catch (error) {
            console.error('Error truncating address:', error);
            return address || ''; // Return original or empty string as fallback
        }
    }

    /**
     * Gets a security rating label based on a numeric score
     * @param {number} score - The security score (0-100)
     * @returns {string} Security rating label
     */
    function getSecurityRating(score) {
        try {
            // Validate score is a number
            const numScore = parseFloat(score);
            if (isNaN(numScore)) {
                console.warn('Invalid security score:', score);
                return 'Unknown';
            }
            
            // Configure rating thresholds and labels
            const ratings = [
                { threshold: 80, label: 'Excellent' },
                { threshold: 70, label: 'Good' },
                { threshold: 50, label: 'Moderate' },
                { threshold: 30, label: 'Risky' },
                { threshold: 0, label: 'High Risk' }
            ];
            
            // Find the appropriate rating based on threshold
            for (const rating of ratings) {
                if (numScore >= rating.threshold) {
                    return rating.label;
                }
            }
            
            return 'Unknown'; // Fallback if score is negative or otherwise invalid
        } catch (error) {
            console.error('Error determining security rating:', error);
            return 'Unknown'; // Fallback value
        }
    }

    /**
     * Initialize wallet connection functionality
     * Sets up wallet connection and user identification
     */
    function initializeWalletConnection() {
        try {
            if (!connectWalletButton) {
                console.error('Connect wallet button element not found');
                return;
            }

            // Check for previously connected wallet in local storage
            const savedWallet = localStorage.getItem('sentinelWalletAddress');
            if (savedWallet && validateSolanaAddress(savedWallet)) {
                console.log('🔄 Restoring wallet connection:', truncateAddress(savedWallet));
                // Auto-connect with saved wallet if available and valid
                connectWallet(savedWallet);
            } else {
                // Clear any invalid saved wallet
                if (savedWallet) {
                    localStorage.removeItem('sentinelWalletAddress');
                }
                // Ensure button shows disconnected state
                updateWalletButtonState('disconnected');
                // Disable SENTINEL features until wallet is connected
                disableSentinelFeatures();
            }

            // Set up connect wallet button event listener
            connectWalletButton.addEventListener('click', handleConnectWalletClick);
            console.log('Wallet button listener attached');
            
            // Set up automatic wallet detection for supported wallets
            setupAutomaticWalletDetection();
            
        } catch (error) {
            console.error('Error initializing wallet connection:', error);
            showNotification('Failed to initialize wallet connection. Please refresh the page.', 'error');
        }
    }
    async function handleConnectWalletClick() {
        try {
            if (walletConnected) {
                // Disconnect wallet if already connected
                disconnectWallet();
                return;
            }

            // Show Solana wallet selection modal
            showSolanaWalletModal();
        } catch (error) {
            console.error('Error handling wallet connect click:', error);
            showNotification('Wallet connection failed', 'error');
        }
    }

    /**
     * Show Solana wallet selection modal
     */
    function showSolanaWalletModal() {
        // Create modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'solana-wallet-overlay';
        modalOverlay.innerHTML = `
            <div class="solana-wallet-modal">
                <div class="wallet-modal-header">
                    <h3>Connect Solana Wallet</h3>
                    <button class="close-wallet-modal" aria-label="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="wallet-modal-content">
                    <p class="wallet-description">
                        Connect your Solana wallet to access SENTINEL features. Only Solana wallets are supported.
                    </p>
                    <div class="wallet-options">
                        <button class="wallet-option" data-wallet="phantom">
                            <div class="wallet-icon">👻</div>
                            <div class="wallet-info">
                                <span class="wallet-name">Phantom</span>
                                <small>Most popular Solana wallet</small>
                            </div>
                        </button>
                        <button class="wallet-option" data-wallet="solflare">
                            <div class="wallet-icon">🔥</div>
                            <div class="wallet-info">
                                <span class="wallet-name">Solflare</span>
                                <small>Multi-platform Solana wallet</small>
                            </div>
                        </button>
                        <button class="wallet-option" data-wallet="backpack">
                            <div class="wallet-icon">🎒</div>
                            <div class="wallet-info">
                                <span class="wallet-name">Backpack</span>
                                <small>Modern Solana wallet</small>
                            </div>
                        </button>
                    </div>
                    <div class="wallet-footer">
                        <small>⚠️ Only Solana wallets supported. EVM wallets will be rejected.</small>
                    </div>
                </div>
            </div>
        `;

        // Add modal styles
        const modalStyles = document.createElement('style');
        modalStyles.id = 'solana-wallet-styles';
        modalStyles.textContent = `
            .solana-wallet-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                backdrop-filter: blur(15px);
            }
            .solana-wallet-modal {
                background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05));
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 24px;
                max-width: 450px;
                width: 90%;
                box-shadow: 0 30px 60px rgba(0,0,0,0.6);
                backdrop-filter: blur(25px);
                animation: modalSlideIn 0.4s ease-out;
            }
            @keyframes modalSlideIn {
                from { opacity: 0; transform: translateY(-30px) scale(0.9); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .wallet-modal-header {
                padding: 28px 28px 20px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .wallet-modal-header h3 {
                margin: 0;
                color: #fff;
                font-size: 22px;
                font-weight: 600;
            }
            .close-wallet-modal {
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                color: rgba(255,255,255,0.8);
                font-size: 16px;
                cursor: pointer;
                padding: 10px;
                border-radius: 12px;
                transition: all 0.3s ease;
                width: 40px;
                height: 40px;
            }
            .close-wallet-modal:hover {
                background: rgba(255,255,255,0.2);
                color: #fff;
            }
            .wallet-modal-content {
                padding: 28px;
            }
            .wallet-description {
                color: rgba(255,255,255,0.85);
                margin: 0 0 28px;
                line-height: 1.6;
            }
            .wallet-options {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .wallet-option {
                display: flex;
                align-items: center;
                gap: 20px;
                padding: 20px 24px;
                background: rgba(255,255,255,0.08);
                border: 1px solid rgba(255,255,255,0.15);
                border-radius: 16px;
                color: #fff;
                cursor: pointer;
                transition: all 0.3s ease;
                width: 100%;
                text-align: left;
            }
            .wallet-option:hover {
                background: rgba(255,255,255,0.15);
                border-color: rgba(255,255,255,0.3);
                transform: translateY(-2px);
            }
            .wallet-icon {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                background: rgba(255,255,255,0.1);
            }
            .wallet-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .wallet-name {
                font-size: 18px;
                font-weight: 600;
            }
            .wallet-info small {
                color: rgba(255,255,255,0.6);
                font-size: 13px;
            }
            .wallet-footer {
                margin-top: 24px;
                padding-top: 20px;
                border-top: 1px solid rgba(255,255,255,0.1);
                text-align: center;
            }
            .wallet-footer small {
                color: rgba(255,255,255,0.7);
                font-size: 13px;
            }
        `;

        document.head.appendChild(modalStyles);
        document.body.appendChild(modalOverlay);

        // Set up event listeners
        const closeBtn = modalOverlay.querySelector('.close-wallet-modal');
        const walletOptions = modalOverlay.querySelectorAll('.wallet-option');

        function closeWalletModal() {
            modalOverlay.remove();
            modalStyles.remove();
        }

        // Close modal on overlay click
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeWalletModal();
            }
        });

        // Close modal on close button click
        closeBtn.addEventListener('click', closeWalletModal);

        // Handle wallet selection
        walletOptions.forEach(option => {
            option.addEventListener('click', async () => {
                const walletType = option.dataset.wallet;
                closeWalletModal();
                await connectSolanaWallet(walletType);
            });
        });
    }

    /**
     * Connect to a Solana wallet with validation
     */
    async function connectSolanaWallet(walletType) {
        try {
            console.log(`Attempting to connect to ${walletType} wallet...`);
            showNotification('Connecting to wallet...', 'info');
            
            let walletAdapter;
            
            // Get the appropriate wallet adapter
            switch (walletType) {
                case 'phantom':
                    if (window.solana && window.solana.isPhantom) {
                        walletAdapter = window.solana;
                    } else {
                        showNotification('Phantom wallet not found. Please install Phantom extension.', 'error');
                        window.open('https://phantom.app/', '_blank');
                        return;
                    }
                    break;
                case 'solflare':
                    if (window.solflare && window.solflare.isSolflare) {
                        walletAdapter = window.solflare;
                    } else {
                        showNotification('Solflare wallet not found. Please install Solflare extension.', 'error');
                        window.open('https://solflare.com/', '_blank');
                        return;
                    }
                    break;
                case 'backpack':
                    if (window.backpack && window.backpack.isBackpack) {
                        walletAdapter = window.backpack;
                    } else {
                        showNotification('Backpack wallet not found. Please install Backpack extension.', 'error');
                        window.open('https://backpack.app/', '_blank');
                        return;
                    }
                    break;
                default:
                    showNotification('Unsupported wallet type', 'error');
                    return;
            }
            
            // Connect to the wallet
            const response = await walletAdapter.connect();
            
            if (!response || !response.publicKey) {
                throw new Error('Failed to get wallet public key');
            }
            
            // Validate that this is a Solana address
            const solanaAddress = response.publicKey.toString();
            if (!validateSolanaAddress(solanaAddress)) {
                throw new Error('Invalid Solana address received from wallet');
            }
            
            // Request signature to verify wallet ownership
            const message = `SENTINEL API Access Request\nTimestamp: ${Date.now()}\nWallet: ${solanaAddress}`;
            const encodedMessage = new TextEncoder().encode(message);
            
            const signature = await walletAdapter.signMessage(encodedMessage);
            if (!signature) {
                throw new Error('Wallet signature verification failed');
            }
            
            console.log('✅ Solana wallet connected and verified:', solanaAddress);
            
            // Connect the wallet
            connectWallet(solanaAddress);
            
        } catch (error) {
            console.error('Error connecting Solana wallet:', error);
            if (error.message.includes('User rejected')) {
                showNotification('Wallet connection cancelled by user', 'warning');
            } else {
                showNotification(`Failed to connect ${walletType}: ${error.message}`, 'error');
            }
        }
    }
    
    /**
     * Validate Solana address format
     */
    function validateSolanaAddress(address) {
        try {
            // Solana addresses are base58 encoded and typically 32-44 characters
            if (!address || typeof address !== 'string') {
                return false;
            }
            
            // Basic length check (Solana addresses are usually 32-44 chars)
            if (address.length < 32 || address.length > 44) {
                return false;
            }
            
            // Check for valid base58 characters
            const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
            if (!base58Regex.test(address)) {
                return false;
            }
            
            // Reject common EVM address patterns
            if (address.startsWith('0x') || address.length === 42) {
                console.warn('EVM address detected and rejected:', address);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Error validating Solana address:', error);
            return false;
        }
    }

    /**
     * Set up automatic wallet detection for supported wallets
     * Monitors wallet connection state changes and updates UI accordingly
     */
    function setupAutomaticWalletDetection() {
        try {
            console.log('🔍 Setting up automatic wallet detection...');
            
            // Monitor Phantom wallet connection changes
            if (window.solana && window.solana.isPhantom) {
                window.solana.on('connect', (publicKey) => {
                    console.log('🔗 Phantom wallet connected automatically:', publicKey.toString());
                    if (!walletConnected) {
                        connectWallet(publicKey.toString());
                    }
                });
                
                window.solana.on('disconnect', () => {
                    console.log('🔌 Phantom wallet disconnected automatically');
                    if (walletConnected) {
                        disconnectWallet();
                    }
                });
                
                // Check if already connected
                if (window.solana.isConnected && !walletConnected) {
                    const publicKey = window.solana.publicKey;
                    if (publicKey) {
                        console.log('🔄 Phantom wallet already connected, syncing state');
                        connectWallet(publicKey.toString());
                    }
                }
            }
            
            // Monitor other wallet types (Solflare, Backpack) if available
            if (window.solflare) {
                window.solflare.on('connect', (publicKey) => {
                    console.log('🔗 Solflare wallet connected automatically:', publicKey.toString());
                    if (!walletConnected) {
                        connectWallet(publicKey.toString());
                    }
                });
                
                window.solflare.on('disconnect', () => {
                    console.log('🔌 Solflare wallet disconnected automatically');
                    if (walletConnected) {
                        disconnectWallet();
                    }
                });
            }
            
            if (window.backpack) {
                window.backpack.on('connect', (publicKey) => {
                    console.log('🔗 Backpack wallet connected automatically:', publicKey.toString());
                    if (!walletConnected) {
                        connectWallet(publicKey.toString());
                    }
                });
                
                window.backpack.on('disconnect', () => {
                    console.log('🔌 Backpack wallet disconnected automatically');
                    if (walletConnected) {
                        disconnectWallet();
                    }
                });
            }
            
            console.log('✅ Automatic wallet detection setup complete');
        } catch (error) {
            console.error('Error setting up automatic wallet detection:', error);
        }
    }
    
    /**
     * Connect wallet and enable SENTINEL features
     * @param {string} address - Wallet address
     */
    function connectWallet(address) {
        if (!address) return;
        
        walletAddress = address;
        walletConnected = true;
        
        // Save to local storage for persistent connection
        localStorage.setItem('sentinelWalletAddress', address);
        
        // Update UI to show connected state immediately
        updateWalletButtonState('connected', address);
        
        // Enable all SENTINEL features
        enableSentinelFeatures();
        
        // Load user's search history
        loadSearchHistoryFromWallet(address);
        
        // Hide wallet connection overlay if visible
        hideWalletConnectionOverlay();
        
        console.log('✅ Wallet connected successfully:', truncateAddress(address));
    }

    /**
     * Disconnect wallet and disable SENTINEL features
     */
    /**
     * Update wallet button state and appearance
     * @param {string} state - 'connected' or 'disconnected'
     * @param {string} address - Wallet address (for connected state)
     */
    function updateWalletButtonState(state, address = null) {
        if (!connectWalletButton) return;
        
        if (state === 'connected' && address) {
            connectWalletButton.classList.remove('connect');
            connectWalletButton.classList.add('connected');
            connectWalletButton.innerHTML = `<i class="fas fa-wallet"></i> ${truncateAddress(address)}`;
            connectWalletButton.title = `Connected: ${address}`;
        } else {
            connectWalletButton.classList.remove('connected');
            connectWalletButton.classList.add('connect');
            connectWalletButton.innerHTML = '<i class="fas fa-wallet"></i> Connect Wallet';
            connectWalletButton.title = 'Connect your Solana wallet';
        }
    }

    /**
     * Disconnect wallet and disable SENTINEL features
     */
    function disconnectWallet() {
        walletAddress = null;
        walletConnected = false;
        
        // Remove from local storage
        localStorage.removeItem('sentinelWalletAddress');
        
        // Update UI to show disconnected state
        updateWalletButtonState('disconnected');
        
        // Disable SENTINEL features until wallet is connected
        disableSentinelFeatures();
        
        // Clear search history display
        clearSearchHistory();
        
        console.log('🔌 Wallet disconnected');
    }

    /**
     * Enable all SENTINEL features
     */
    function enableSentinelFeatures() {
        // Console log to help with debugging
        console.log('Enabling SENTINEL features');
        
        if (searchButton) {
            searchButton.disabled = false;
            console.log('Search button enabled');
        }
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = 'Search tokens, contracts, or ask questions...';
            console.log('Search input enabled with proper placeholder');
        }
        if (micButton) {
            micButton.disabled = false;
            console.log('Mic button enabled');
        }
        
        // Show any wallet-specific UI elements
        const walletElements = document.querySelectorAll('.sentinel-wallet-overlay');
        walletElements.forEach(el => el.classList.remove('hidden'));
        
        // Hide the wallet connection overlay if it's visible
        hideWalletConnectionOverlay();
        
        // Clear any dynamic wallet overlay from the results section
        if (resultsSection && resultsSection.querySelector('.sentinel-wallet-overlay')) {
            resultsSection.classList.add('fade-out');
            setTimeout(() => {
                resultsSection.innerHTML = '';
                resultsSection.classList.remove('fade-out');
            }, 300);
        }
    }

    /**
     * Disable all SENTINEL features until wallet is connected
     */
    function disableSentinelFeatures() {
        console.log('Disabling SENTINEL features until wallet is connected');
        
        if (searchButton) {
            searchButton.disabled = true;
            console.log('Search button disabled');
        }
        
        // IMPORTANT: Do NOT disable the search input - users need to be able to type
        // Instead, we'll check wallet connection in handleSearch() function
        if (searchInput) {
            // Keep search input enabled for typing, but add visual indicator
            searchInput.disabled = false;
            searchInput.placeholder = 'Connect wallet to search...';
            console.log('Search input kept enabled (wallet check in handleSearch)');
        }
        if (searchTypeSelect) {
            searchTypeSelect.disabled = true;
            console.log('Search type selector disabled');
        }
        // Search type selector was removed from UI - AI handles tool selection automatically
        if (micButton) {
            micButton.disabled = true;
            console.log('Mic button disabled');
        }
        
        // IMPORTANT: Never disable the wallet connection button!
        // Users need to be able to connect their wallet
        if (connectWalletButton) {
            connectWalletButton.disabled = false;
            console.log('Wallet connection button kept enabled');
        }
        
        // Hide any wallet-specific UI elements
        const walletElements = document.querySelectorAll('.sentinel-wallet-overlay');
        walletElements.forEach(el => el.classList.add('hidden'));
        
        console.log('SENTINEL features disabled - wallet connection required');
    }
    



    /**
     * Hide wallet connection overlay
     */
    function hideWalletConnectionOverlay() {
        try {
            console.log('🔓 Hiding wallet connection overlay');
            
            const overlay = document.getElementById('walletConnectionOverlay');
            if (overlay) {
                overlay.classList.remove('visible');
                console.log('✅ Wallet connection overlay hidden');
            } else {
                console.warn('Wallet connection overlay element not found when trying to hide');
            }
        } catch (error) {
            console.error('Error hiding wallet connection overlay:', error);
        }
    }
    
    /**
     * Load search history for a specific wallet address
     * @param {string} address - Wallet address
     */
    async function loadSearchHistoryFromWallet(address) {
        try {
            // Fetch search history from backend
            const response = await fetch(`/sentinel/history?walletAddress=${encodeURIComponent(address)}`);
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.history && Array.isArray(data.history)) {
                // Update search history array
                searchHistory = data.history;
                
                // Update UI with search history
                renderSearchHistory();
                
                console.log(`Loaded ${data.count} search history items for wallet: ${address}`);
            }
        } catch (error) {
            console.error('Error loading search history:', error);
            // Don't show notification to avoid confusion - this is a background operation
        }
    }

    // Voice streaming client for real-time voice interaction

    /**
     * Sets up the voice client, its event listeners, and UI interactions.
     */
    function setupVoiceClient() {
        const micButton = document.querySelector('#sentinelMicButton');
        if (!micButton) return;

        function updateMicButtonState(state) {
            if (!micButton) return;
            const states = ['idle', 'connecting', 'listening', 'speaking_detected', 'speaking', 'error', 'disconnected'];
            micButton.classList.remove(...states);
            micButton.classList.add(state);

            switch (state) {
                case 'idle':
                    micButton.innerHTML = '<i class="fas fa-microphone"></i>';
                    break;
                case 'connecting':
                case 'disconnected': // Show spinner for disconnecting too
                    micButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    break;
                case 'listening':
                    micButton.innerHTML = '<i class="fas fa-microphone"></i>';
                    break;
                case 'speaking_detected':
                    micButton.innerHTML = '<i class="fas fa-microphone-alt"></i>';
                    break;
                case 'speaking':
                    micButton.innerHTML = '<i class="fas fa-volume-up"></i>';
                    break;
                case 'error':
                    micButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
                    break;
                default:
                    micButton.innerHTML = '<i class="fas fa-microphone"></i>';
            }
        }

        function resetMicButton() {
            updateMicButtonState('idle');
            if (voiceClient && voiceClient.isConnected) {
                voiceClient.disconnect();
            }
        }

        micButton.addEventListener('click', () => {
            if (!walletConnected || !walletAddress) {
                showNotification('🔒 Please connect your wallet to use voice.', 'warning');
                showWalletConnectionOverlay();
                return;
            }

            if (!voiceClient.isSessionActive) {
                const instructions = `You are SENTINEL, an AI-powered crypto intelligence assistant. 
                Analyze user voice queries about tokens, prices, security, or social sentiment. 
                Provide concise, actionable insights. Keep responses under 30 seconds for voice interaction. 
                Use available tools to fetch real-time data when needed.`;
                voiceClient.startVoiceSession(instructions);
            } else {
                voiceClient.endVoiceSession();
            }
        });

        document.addEventListener('walletConnected', async (e) => {
            try {
                await voiceClient.connect(e.detail.walletAddress);
            } catch (error) {
                console.error('Failed to connect voice client:', error);
                showNotification('Voice service connection failed.', 'error');
            }
        });

        voiceClient.onStateChange = (state) => {
            updateMicButtonState(state);
        };

        voiceClient.onTranscription = (transcription) => {
            if (transcription.trim()) {
                searchInput.value = transcription;
                // Auto-trigger search for voice queries
                setTimeout(() => handleSearch(), 500);
            }
        };

        voiceClient.onError = (error) => {
            showNotification(`Voice Error: ${error}`, 'error');
            resetMicButton();
        };

        // Set initial state
        updateMicButtonState('idle');
    }

    /**
     * Initialize mobile controls and auto-expanding textarea functionality
     */
    function initializeMobileControls() {
        try {
            console.log('Initializing mobile controls...');
            
            // Get mobile control elements
            const sentinelMicButtonMobile = document.getElementById('sentinelMicButtonMobile');
            const searchInput = document.getElementById('sentinelSearch');
            const sentinelMicButtonDesktop = document.getElementById('sentinelMicButton');
            
            // Search type dropdown removed - AI handles tool selection automatically
            
            // Synchronize mobile and desktop mic buttons
            if (sentinelMicButtonMobile && sentinelMicButtonDesktop) {
                sentinelMicButtonMobile.addEventListener('click', function() {
                    sentinelMicButtonDesktop.click();
                    console.log('Mobile mic button clicked');
                });
            }
            
            // Auto-expanding textarea functionality
            if (searchInput && searchInput.tagName === 'TEXTAREA') {
                searchInput.addEventListener('input', function() {
                    // Reset height to auto to get the correct scrollHeight
                    this.style.height = 'auto';
                    
                    // Set height based on scrollHeight, with min and max constraints
                    const minHeight = 44; // Minimum height in pixels
                    const maxHeight = 120; // Maximum height in pixels
                    const newHeight = Math.min(Math.max(this.scrollHeight, minHeight), maxHeight);
                    
                    this.style.height = newHeight + 'px';
                    
                    // Show/hide scrollbar if content exceeds max height
                    if (this.scrollHeight > maxHeight) {
                        this.style.overflowY = 'auto';
                    } else {
                        this.style.overflowY = 'hidden';
                    }
                });
                
                // Handle Enter key (allow Shift+Enter for new lines)
                searchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSearch();
                    }
                });
                
                console.log('Auto-expanding textarea initialized');
            }
            
            console.log('Mobile controls initialized successfully');
        } catch (error) {
            console.error('Failed to initialize mobile controls:', error);
        }
    }

    /**
     * Initialize all components and set up event listeners
     * This is the main initialization function that runs when the page loads
     */
    function init() {
        try {
            console.log('Initializing SENTINEL API');
            
            // Set up event listeners
            if (searchButton) {
                searchButton.addEventListener('click', function() {
                    console.log('🔍 Search button clicked - checking wallet connection...');
                    
                    if (!walletConnected || !walletAddress) {
                        console.warn('🚫 Search blocked: Wallet not connected');
                        showNotification('🔒 Wallet Required: Please connect your wallet to use SENTINEL', 'warning');
                        showWalletConnectionOverlay();
                        return;
                    }
                    
                    console.log('✅ Search allowed - proceeding with search');
                    handleSearch();
                });
                console.log('Search button listener attached with wallet enforcement');
            }
            
            // Set up wallet connection button
            if (connectWalletButton) {
                connectWalletButton.addEventListener('click', handleConnectWalletClick);
                console.log('Wallet connect button listener attached');
            }
            
            if (searchInput) {
                searchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleSearch();
                    }
                });
                console.log('Search input enter key listener attached');
            }
            
            if (clearHistoryBtn) {
                clearHistoryBtn.addEventListener('click', clearSearchHistory);
                console.log('Clear history button listener attached');
            }
            
            // Search type dropdown removed - AI handles tool selection automatically
            
            // Set up suggestion chip listeners
            if (suggestionChips && suggestionChips.length > 0) {
                suggestionChips.forEach(chip => {
                    chip.addEventListener('click', function() {
                        console.log('💡 Suggestion chip clicked - checking wallet connection...');
                        
                        if (!walletConnected || !walletAddress) {
                            console.warn('🚫 Suggestion chip blocked: Wallet not connected');
                            showNotification('🔒 Wallet Required: Please connect your wallet to use SENTINEL', 'warning');
                            showWalletConnectionOverlay();
                            return;
                        }
                        
                        console.log('✅ Suggestion chip allowed - filling search input');
                        if (searchInput) {
                            searchInput.value = this.textContent.trim();
                        }
                    });
                });
                console.log('Suggestion chips listeners attached');
            }
            
            // Set up copy summary button
            if (copySummaryBtn) {
                copySummaryBtn.addEventListener('click', function() {
                    if (summaryContent) {
                        navigator.clipboard.writeText(summaryContent.textContent)
                            .then(() => showNotification('Summary copied to clipboard', 'success'))
                            .catch(err => {
                                console.error('Could not copy summary:', err);
                                showNotification('Failed to copy summary', 'error');
                            });
                    }
                });
            }
            
            // Set up modals
            setupModals();
            
            // Set up tool indicators
            setupToolIndicators();
            
            // Load search history
            loadSearchHistory();
            
            // Clear any summary content
            clearSummary();
            
            // Initialize the voice client
            setupVoiceClient();
            
            // Initialize wallet connection functionality
            initializeWalletConnection();
            
            // Initialize mobile controls and textarea functionality
            initializeMobileControls();
            

            
            console.log('SENTINEL API initialized successfully');
        } catch (error) {
            console.error('Failed to initialize SENTINEL API:', error);
        }
    }
    

    
    // Initialize the application
    init();
