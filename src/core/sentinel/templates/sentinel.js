// SENTINEL API JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const searchInput = document.getElementById('sentinelSearch');
    const searchTypeSelect = document.getElementById('searchType');
    const searchButton = document.getElementById('searchButton');
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
    
    // Current search ID and data
    let currentSearchId = null;
    let currentResults = null;

    // Initialize
    function init() {
        // Add event listeners
        searchButton.addEventListener('click', handleSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
        
        // Suggestion chips
        suggestionChips.forEach(chip => {
            chip.addEventListener('click', () => {
                searchInput.value = chip.textContent.trim();
                handleSearch();
            });
        });

        // Modal events
        setupModals();
        
        // Tool status indicators
        setupToolIndicators();
    }

    // Handle search with animated results processing
    async function handleSearch() {
        const query = searchInput.value.trim();
        const searchType = searchTypeSelect.value;
        
        if (!query) {
            showNotification('Please enter a search query', 'warning');
            return;
        }
        
        // Show loading with AI animation effect
        showLoading(true);
        resetToolStatuses();
        
        // Clear previous results with fade-out effect
        if (resultsSection.children.length > 0) {
            resultsSection.classList.add('fade-out');
            setTimeout(() => {
                resultsSection.innerHTML = '';
                resultsSection.classList.remove('fade-out');
            }, 300);
        }
        
        // Show the AI thinking animation
        const sentinelBrain = document.getElementById('sentinelBrain');
        if (sentinelBrain) {
            sentinelBrain.classList.add('pulse');
        }
        
        try {
            // Simulate the AI thinking about which tools to use
            await simulateAiToolSelection();
            
            // Make API call to the backend
            const response = await fetch('/api/sentinel/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query,
                    type: searchType
                })
            });
            
            if (!response.ok) {
                throw new Error(`Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                showNotification(data.error, 'error');
                showLoading(false);
                return;
            }
            
            // Save results and search ID
            currentSearchId = data.id; // Make sure this matches the backend property
            currentResults = data;
            
            // Poll for tool status updates if results are still processing
            if (data.status === 'processing') {
                await pollForResults(data.id);
            } else {
                // Update tool statuses based on response
                updateToolStatuses(data.results);
                
                // Display results with animation
                await displayResultsWithAnimation(data.results);
            }
            
            // Show result actions with fade-in
            resultActions.style.display = 'flex';
            resultActions.classList.add('fade-in');
            
        } catch (error) {
            console.error('Search failed:', error);
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
    
    // Simulates AI thinking about which tools to use
    async function simulateAiToolSelection() {
        const toolNames = ['Token Info', 'Metadata', 'Security', 'Social'];
        const statusElement = document.getElementById('loadingStatus');
        
        // Add null check before accessing properties
        if (statusElement) {
            statusElement.textContent = 'Analyzing query...';
        }
        
        // Wait a short time before starting tool selection
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Simulate AI selecting tools
        if (statusElement) {
            statusElement.textContent = 'Selecting analysis tools...';
        }
        
        for (const tool of toolNames) {
            await new Promise(resolve => setTimeout(resolve, 400));
            if (statusElement) {
                statusElement.textContent = `Activating ${tool} tool...`;
            }
        }
        
        if (statusElement) {
            statusElement.textContent = 'Processing request...';
        }
        
        return Promise.resolve();
    }
    
    // Poll for results if they're being processed asynchronously
    async function pollForResults(searchId) {
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between polls
            
            try {
                const response = await fetch(`/api/sentinel/status?id=${searchId}`);
                
                if (!response.ok) {
                    throw new Error(`Error: ${response.status}`);
                }
                
                const data = await response.json();
                
                // Update tool statuses based on progress
                if (data.toolStatus) {
                    updateProgressiveToolStatus(data.toolStatus);
                }
                
                // If processing is complete, display results
                if (data.status === 'complete') {
                    updateToolStatuses(data.results);
                    await displayResultsWithAnimation(data.results);
                    return;
                }
                
                attempts++;
            } catch (error) {
                console.error('Error polling for results:', error);
                attempts++;
            }
        }
        
        // If we reach here, polling timed out
        showNotification('Search is taking longer than expected. Results will appear when ready.', 'warning');
    }

    // Display search results with animation
    async function displayResultsWithAnimation(data) {
        try {
            console.log('Displaying search results with animation:', data);
            
            // Clear previous results (should already be cleared with fade-out)
            resultsSection.innerHTML = '';
            
            // Validate input data
            if (!data) {
                console.error('No result data provided to displayResultsWithAnimation');
                showNotification('An error occurred displaying results', 'error');
                return;
            }
            
            // Create an array of card creation tasks with labels for better debugging
            const cardCreationTasks = [];
            
            // Add each available data type to our card creators array with labels for debugging
            if (data.tokenInfo) {
                cardCreationTasks.push({ 
                    type: 'tokenInfo', 
                    creator: () => createTokenInfoCard(data.tokenInfo)
                });
            }
            
            if (data.tokenMetadata) {
                cardCreationTasks.push({ 
                    type: 'tokenMetadata', 
                    creator: () => createMetadataCard(data.tokenMetadata)
                });
            }
            
            if (data.securityAnalysis) {
                cardCreationTasks.push({ 
                    type: 'securityAnalysis', 
                    creator: () => createSecurityCard(data.securityAnalysis)
                });
            }
            
            if (data.socialData) {
                cardCreationTasks.push({ 
                    type: 'socialData', 
                    creator: () => createSocialCard(data.socialData)
                });
            }
            
            // If no results
            if (cardCreationTasks.length === 0) {
                console.log('No card creation tasks, displaying placeholder');
                const placeholderEl = document.createElement('div');
                placeholderEl.className = 'sentinel-placeholder fade-in';
                placeholderEl.innerHTML = `
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <p>No results found for your query</p>
                `;
                resultsSection.appendChild(placeholderEl);
                return;
            }
            
            // Add cards one by one with animation
            let successfulCards = 0;
            for (const task of cardCreationTasks) {
                console.log(`Creating ${task.type} card...`);
                try {
                    const card = task.creator();
                    
                    // Enhanced null/undefined check with detailed logging
                    if (!card) {
                        console.warn(`Card creation failed for ${task.type}: Card is null or undefined`);
                        continue;
                    }
                    
                    // Verify that card is a DOM element that we can add classes to
                    if (typeof card.classList === 'undefined') {
                        console.error(`Card creation error for ${task.type}: Created card does not have classList property`);
                        continue;
                    }
                    
                    // Add animation class and append to results
                    card.classList.add('slide-in');
                    resultsSection.appendChild(card);
                    successfulCards++;
                    
                    // Wait for the animation to complete before adding the next card
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    console.error(`Error creating or appending ${task.type} card:`, error);
                }
            }
            
            // Show notification if no cards were successfully created and displayed
            if (successfulCards === 0 && cardCreationTasks.length > 0) {
                console.error('No cards were successfully created');
                const errorEl = document.createElement('div');
                errorEl.className = 'sentinel-placeholder fade-in error';
                errorEl.innerHTML = `
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <p>Error displaying results. Please try again.</p>
                `;
                resultsSection.appendChild(errorEl);
            } else {
                // Add expand/collapse functionality to results cards
                setupCardExpansion();
            }
        } catch (error) {
            console.error('Fatal error in displayResultsWithAnimation:', error);
            showNotification('An error occurred displaying results', 'error');
        }
    }
    
    // Original display results function (kept for backward compatibility)
    function displayResults(data) {
        // Clear previous results
        resultsSection.innerHTML = '';

        // Process token info if available
        if (data.tokenInfo) {
            const tokenInfoCard = createTokenInfoCard(data.tokenInfo);
            resultsSection.appendChild(tokenInfoCard);
        }
        
        // Process token metadata if available
        if (data.tokenMetadata) {
            const metadataCard = createMetadataCard(data.tokenMetadata);
            resultsSection.appendChild(metadataCard);
        }
        
        // Process security analysis if available
        if (data.securityAnalysis) {
            const securityCard = createSecurityCard(data.securityAnalysis);
            resultsSection.appendChild(securityCard);
        }
        
        // Process social data if available
        if (data.socialData) {
            const socialCard = createSocialCard(data.socialData);
            resultsSection.appendChild(socialCard);
        }

        // If no results
        if (resultsSection.children.length === 0) {
            resultsSection.innerHTML = `
                <div class="sentinel-placeholder">
                    <div class="sentinel-placeholder-icon">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <p>No results found for your query</p>
                </div>
            `;
        }

        // Add expand/collapse functionality to results cards
        setupCardExpansion();
    }

    // Create token info card
    function createTokenInfoCard(tokenInfo) {
        try {
            // Check if the template exists
            const templateElement = document.getElementById('tokenInfoTemplate');
            if (!templateElement) {
                console.error('Token info template not found');
                return null;
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = 'sentinel-result-card token-info-card';
            
            // Replace template variables with actual data
            // Use local asset or data URI as fallback for missing logos
            template.querySelector('.sentinel-token-icon img').src = tokenInfo.logo || '/assets/images/token-placeholder.png';
            // Set onerror handler to use a data URI if the image fails to load
            template.querySelector('.sentinel-token-icon img').onerror = function() {
                this.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0IiBmaWxsPSJub25lIj48Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMCIgZmlsbD0iIzMzMzMzMyIgLz48dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtc2l6ZT0iMzAiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPj88L3RleHQ+PC9zdmc+Cg==';
                console.log('Using fallback image for token icon');
            };
            template.querySelector('.sentinel-token-icon img').alt = tokenInfo.symbol || '?';
            template.querySelector('.sentinel-token-details h4').textContent = `${tokenInfo.name || 'Unknown'} (${tokenInfo.symbol || '?'})`;
            template.querySelector('.sentinel-token-price').textContent = formatPrice(tokenInfo.price);
            
            // Price change
            const priceChange = template.querySelector('.sentinel-token-change');
            const changeValue = tokenInfo.priceChange24h || 0;
            
            if (changeValue > 0) {
                priceChange.classList.add('positive');
                priceChange.querySelector('i').classList.add('fa-caret-up');
                priceChange.innerHTML += ` +${formatPercentage(changeValue)}`;
            } else {
                priceChange.classList.add('negative');
                priceChange.querySelector('i').classList.add('fa-caret-down');
                priceChange.innerHTML += ` ${formatPercentage(changeValue)}`;
            }
            
            // Stats
            template.querySelectorAll('.sentinel-stat-value')[0].textContent = formatCurrency(tokenInfo.marketCap);
            template.querySelectorAll('.sentinel-stat-value')[1].textContent = formatCurrency(tokenInfo.volume24h);
            template.querySelectorAll('.sentinel-stat-value')[2].textContent = formatCurrency(tokenInfo.liquidity);
            
            // Append the fragment to our element
            cardElement.appendChild(template);
            return cardElement;
        } catch (error) {
            console.error('Error creating token info card:', error);
            return null;
        }
    }

    // Create metadata card
    function createMetadataCard(metadata) {
        try {
            // Check if template exists
            const templateElement = document.getElementById('tokenMetadataTemplate');
            if (!templateElement) {
                console.error('Token metadata template not found');
                return null;
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = 'sentinel-result-card metadata-card';
            
            // Add holders chart - we'll use a placeholder for now
            // In a real implementation, you'd use Chart.js or similar to create a proper chart
            const chartContainer = template.querySelector('.sentinel-chart-container');
            chartContainer.innerHTML = `
                <div class="sentinel-chart-placeholder">
                    <p>Holders: ${metadata.holders || '?'}</p>
                    <div class="sentinel-distribution">
                        <div class="sentinel-dist-bar" style="width: 80%;" title="Top 10 wallets: ${metadata.topWallets?.percentage || '?'}%">
                            <span>Top 10: ${metadata.topWallets?.percentage || '?'}%</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Add snipers if available
            const snipersList = template.querySelector('.sentinel-snipers-list');
            
            if (metadata.snipers && metadata.snipers.length > 0) {
                snipersList.innerHTML = metadata.snipers.slice(0, 5).map(sniper => `
                    <div class="sentinel-sniper-item">
                        <span class="sentinel-sniper-address">${truncateAddress(sniper.address)}</span>
                        <span class="sentinel-sniper-amount">${formatCurrency(sniper.amount)}</span>
                    </div>
                `).join('');
            } else {
                snipersList.innerHTML = '<p class="sentinel-no-data">No sniper data available</p>';
            }
            
            // Append the fragment to our element
            cardElement.appendChild(template);
            return cardElement;
        } catch (error) {
            console.error('Error creating metadata card:', error);
            return null;
        }
    }

    // Create security card
    function createSecurityCard(security) {
        try {
            // Check if template exists
            const templateElement = document.getElementById('securityAnalysisTemplate');
            if (!templateElement) {
                console.error('Security analysis template not found');
                return null;
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = 'sentinel-result-card security-card';
            
            // Set security score
            const score = security.score || 0;
            const gaugeProgress = template.querySelector('.sentinel-gauge-progress');
            const gaugeText = template.querySelector('.sentinel-gauge-text');
            const riskList = template.querySelector('.sentinel-risk-list');
            
            // Update gauge values
            const circumference = 54 * 2 * Math.PI;
            const offset = circumference - (score / 100) * circumference;
            gaugeProgress.style.strokeDasharray = `${circumference} ${circumference}`;
            gaugeProgress.style.strokeDashoffset = offset;
            
            // Determine color based on score
            let scoreColor;
            if (score >= 70) {
                scoreColor = 'var(--sentinel-success)';
            } else if (score >= 40) {
                scoreColor = 'var(--sentinel-warning)';
            } else {
                scoreColor = 'var(--sentinel-danger)';
            }
            
            gaugeProgress.style.stroke = scoreColor;
            gaugeText.textContent = `${score}%`;
            
            // Update security rating
            template.querySelector('.sentinel-security-value').textContent = getSecurityRating(score);
            template.querySelector('.sentinel-security-value').style.color = scoreColor;
            
            // Add risk factors
            if (security.risks && security.risks.length > 0) {
                riskList.innerHTML = security.risks.map(risk => `
                    <li class="sentinel-risk-item ${risk.severity}">
                        <div class="sentinel-risk-header">
                            <span class="sentinel-risk-name">${risk.name}</span>
                            <span class="sentinel-risk-severity ${risk.severity}">${risk.severity}</span>
                        </div>
                        <p class="sentinel-risk-description">${risk.description}</p>
                    </li>
                `).join('');
            } else {
                riskList.innerHTML = '<li class="sentinel-no-data">No risk factors detected</li>';
            }
            
            // Append the fragment to our element
            cardElement.appendChild(template);
            return cardElement;
        } catch (error) {
            console.error('Error creating security card:', error);
            return null;
        }
    }

    // Create social card
    function createSocialCard(socialData) {
        try {
            // Check if template exists
            const templateElement = document.getElementById('socialDataTemplate');
            if (!templateElement) {
                console.error('Social data template not found');
                return null;
            }
            
            const template = templateElement.content.cloneNode(true);
            
            // Create wrapper element to convert DocumentFragment to a proper DOM element
            const cardElement = document.createElement('div');
            cardElement.className = 'sentinel-result-card social-card';
            
            // Set tweet stats
            template.querySelector('[data-field="tweetCount"]').textContent = socialData.tweetCount || '0';
            template.querySelector('[data-field="engagement"]').textContent = formatNumber(socialData.engagement) || '0';
            
            // Set sentiment with color
            const sentimentEl = template.querySelector('[data-field="sentiment"]');
            const sentiment = socialData.sentiment || 'Neutral';
            let sentimentClass = 'neutral';
            
            if (sentiment.toLowerCase().includes('positive')) {
                sentimentClass = 'positive';
            } else if (sentiment.toLowerCase().includes('negative')) {
                sentimentClass = 'negative';
            }
            
            sentimentEl.textContent = sentiment;
            sentimentEl.classList.add(sentimentClass);
            
            // Add tweets
            const tweetsList = template.querySelector('.sentinel-tweets-list');
            
            if (socialData.tweets && socialData.tweets.length > 0) {
                tweetsList.innerHTML = socialData.tweets.slice(0, 5).map(tweet => `
                    <div class="sentinel-tweet">
                        <div class="sentinel-tweet-header">
                            <span class="sentinel-tweet-user">${tweet.username}</span>
                            <span class="sentinel-tweet-date">${formatDate(tweet.date)}</span>
                        </div>
                        <p class="sentinel-tweet-content">${tweet.text}</p>
                        <div class="sentinel-tweet-stats">
                            <span class="sentinel-tweet-likes"><i class="far fa-heart"></i> ${tweet.likes || 0}</span>
                            <span class="sentinel-tweet-retweets"><i class="fas fa-retweet"></i> ${tweet.retweets || 0}</span>
                        </div>
                    </div>
                `).join('');
            } else {
                tweetsList.innerHTML = '<p class="sentinel-no-data">No tweets available</p>';
            }
            
            // Append the fragment to our element
            cardElement.appendChild(template);
            return cardElement;
        } catch (error) {
            console.error('Error creating social card:', error);
            return null;
        }
    }

    // Setup card expansion/collapse
    function setupCardExpansion() {
        const expandButtons = document.querySelectorAll('.sentinel-expand-btn');
        
        expandButtons.forEach(button => {
            button.addEventListener('click', function() {
                const card = this.closest('.sentinel-result-card');
                const content = card.querySelector('.sentinel-result-content');
                
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    this.innerHTML = '<i class="fas fa-chevron-up"></i>';
                } else {
                    content.style.display = 'none';
                    this.innerHTML = '<i class="fas fa-chevron-down"></i>';
                }
            });
        });
    }

    // Modal setup
    function setupModals() {
        // Raw data modal
        rawDataBtn.addEventListener('click', async function() {
            if (!currentSearchId) return;
            
            try {
                const response = await fetch(`/api/sentinel/raw/${currentSearchId}`);
                const data = await response.json();
                
                rawDataContent.textContent = JSON.stringify(data, null, 2);
                rawDataModal.classList.add('active');
            } catch (error) {
                console.error('Failed to fetch raw data:', error);
                showNotification('Failed to fetch raw data', 'error');
            }
        });
        
        // Save results modal
        saveResultsBtn.addEventListener('click', function() {
            if (!currentSearchId) return;
            saveModal.classList.add('active');
        });
        
        // Confirm save
        confirmSaveBtn.addEventListener('click', async function() {
            if (!currentSearchId) return;
            
            try {
                const response = await fetch('/api/sentinel/save', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        searchId: currentSearchId,
                        notes: saveNotes.value
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showNotification('Results saved successfully!', 'success');
                    saveModal.classList.remove('active');
                } else {
                    throw new Error(data.error || 'Failed to save results');
                }
            } catch (error) {
                console.error('Save failed:', error);
                showNotification('Failed to save results', 'error');
            }
        });
        
        // Close modals
        document.querySelectorAll('.sentinel-modal-close').forEach(button => {
            button.addEventListener('click', function() {
                this.closest('.sentinel-raw-data-modal, .sentinel-save-modal').classList.remove('active');
            });
        });
        
        // Close modal on outside click
        window.addEventListener('click', function(e) {
            if (e.target === rawDataModal) {
                rawDataModal.classList.remove('active');
            }
            if (e.target === saveModal) {
                saveModal.classList.remove('active');
            }
        });
    }

    // Tool status indicators
    function setupToolIndicators() {
        // Tool status elements are already defined in HTML
    }

    // Reset tool statuses
    function resetToolStatuses() {
        document.querySelectorAll('.sentinel-tool-indicator').forEach(indicator => {
            indicator.className = 'sentinel-tool-indicator pending';
        });
    }

    // Update tool statuses based on response
    function updateToolStatuses(data) {
        const toolStatusMap = {
            'tool1Status': data.tokenInfo ? 'complete' : 'error',
            'tool2Status': data.tokenMetadata ? 'complete' : 'error',
            'tool3Status': data.securityAnalysis ? 'complete' : 'error',
            'tool4Status': data.socialData ? 'complete' : 'error'
        };
        
        for (const [id, status] of Object.entries(toolStatusMap)) {
            const indicator = document.getElementById(id).querySelector('.sentinel-tool-indicator');
            
            // First set to processing for animation effect
            if (status === 'complete') {
                indicator.className = 'sentinel-tool-indicator processing';
                
                // Use setTimeout to create an animation effect for status changes
                setTimeout(() => {
                    indicator.className = `sentinel-tool-indicator ${status}`;
                }, 300);
            } else {
                indicator.className = `sentinel-tool-indicator ${status}`;
            }
            
            // Update the label text
            const label = document.getElementById(id).querySelector('.sentinel-tool-name');
            if (status === 'complete') {
                label.innerHTML += ' <i class="fas fa-check-circle"></i>';
            } else if (status === 'error') {
                label.innerHTML += ' <i class="fas fa-exclamation-circle"></i>';
            }
        }
    }
    
    // Update tool statuses progressively during processing
    function updateProgressiveToolStatus(toolStatus) {
        for (const [tool, status] of Object.entries(toolStatus)) {
            let id;
            
            // Map tool name to element ID
            switch(tool) {
                case 'tokenInfo':
                    id = 'tool1Status';
                    break;
                case 'tokenMetadata':
                    id = 'tool2Status';
                    break;
                case 'securityAnalysis':
                    id = 'tool3Status';
                    break;
                case 'socialData':
                    id = 'tool4Status';
                    break;
                default:
                    continue;
            }
            
            // Update the visual indicator
            const indicator = document.getElementById(id).querySelector('.sentinel-tool-indicator');
            
            // Set different statuses
            if (status === 'running') {
                indicator.className = 'sentinel-tool-indicator processing';
            } else if (status === 'complete') {
                indicator.className = 'sentinel-tool-indicator complete';
                // Update the label text
                const label = document.getElementById(id).querySelector('.sentinel-tool-name');
                label.innerHTML += ' <i class="fas fa-check-circle"></i>';
            } else if (status === 'error') {
                indicator.className = 'sentinel-tool-indicator error';
                // Update the label text
                const label = document.getElementById(id).querySelector('.sentinel-tool-name');
                label.innerHTML += ' <i class="fas fa-exclamation-circle"></i>';
            }
        }
    }

    // Show/hide loading overlay
    function showLoading(show) {
        if (show) {
            loadingOverlay.classList.add('active');
        } else {
            loadingOverlay.classList.remove('active');
        }
    }

    // Show notification (implement this to show toast notifications)
    function showNotification(message, type) {
        // This is a placeholder - in a real implementation you would have a toast system
        console.log(`Notification (${type}): ${message}`);
        alert(`${message}`);
    }

    // Helper functions
    function formatPrice(price) {
        if (!price) return '$0.00';
        return new Intl.NumberFormat('en-US', { 
            style: 'currency', 
            currency: 'USD',
            minimumFractionDigits: price < 1 ? 4 : 2,
            maximumFractionDigits: price < 1 ? 8 : 2
        }).format(price);
    }

    function formatCurrency(value) {
        if (!value) return '$0';
        return new Intl.NumberFormat('en-US', { 
            style: 'currency', 
            currency: 'USD',
            notation: 'compact',
            compactDisplay: 'short'
        }).format(value);
    }

    function formatPercentage(value) {
        return `${Math.abs(value).toFixed(2)}%`;
    }

    function formatNumber(num) {
        if (!num) return '0';
        return new Intl.NumberFormat('en-US', {notation: 'compact'}).format(num);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
    }

    function truncateAddress(address) {
        if (!address) return '';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }

    function getSecurityRating(score) {
        if (score >= 80) return 'Excellent';
        if (score >= 70) return 'Good';
        if (score >= 50) return 'Moderate';
        if (score >= 30) return 'Risky';
        return 'High Risk';
    }

    // Initialize when document is ready
    init();
});
