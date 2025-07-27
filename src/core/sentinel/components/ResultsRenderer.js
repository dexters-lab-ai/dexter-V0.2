/**
 * SENTINEL Results Renderer
 * Modern, comprehensive token data visualization for DeFi investors
 */

/**
 * Main function to render search results with modern DeFi styling
 * @param {Object} data - Search results data
 * @param {HTMLElement} container - Container element to render into
 */
export function renderSearchResults(data, container) {
    try {
        if (!container) {
            throw new Error('Container element is required');
        }

        // Clear existing content
        container.innerHTML = '';
        
        // Create main results wrapper
        const resultsWrapper = document.createElement('div');
        resultsWrapper.className = 'sentinel-results-wrapper';
        
        // Render each data section
        if (data.tokenMetadata) {
            renderTokenOverview(data.tokenMetadata, resultsWrapper);
            renderPriceMetrics(data.tokenMetadata, resultsWrapper);
            renderTradingActivity(data.tokenMetadata, resultsWrapper);
            renderLiquidityMetrics(data.tokenMetadata, resultsWrapper);
            renderSniperAnalysis(data.tokenMetadata, resultsWrapper);
            renderPairInformation(data.tokenMetadata, resultsWrapper);
        }
        
        if (data.tokenInfo && !data.tokenInfo.error) {
            renderAdditionalTokenInfo(data.tokenInfo, resultsWrapper);
        }
        
        if (data.socialData) {
            renderSocialData(data.socialData, resultsWrapper);
        }
        
        container.appendChild(resultsWrapper);
        
        // Add animation classes
        setTimeout(() => {
            resultsWrapper.classList.add('fade-in');
        }, 100);
        
        console.log('Search results rendered successfully');
        
    } catch (error) {
        console.error('Error rendering search results:', error);
        container.innerHTML = `
            <div class="sentinel-error-card">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Error Displaying Results</h3>
                <p>Unable to render search results. Please try again.</p>
            </div>
        `;
    }
}

/**
 * Render token overview section with key metrics
 */
function renderTokenOverview(tokenMetadata, container) {
    const { holders, price } = tokenMetadata;
    
    if (!holders || !price?.data) return;
    
    const overviewCard = document.createElement('div');
    overviewCard.className = 'sentinel-card sentinel-overview-card';
    
    const currentPrice = price.data.usdPrice || holders.currentUsdPrice;
    const priceChange24h = price.data.usdPrice24hrPercentChange || holders.pricePercentChange?.['24h'];
    const changeClass = priceChange24h >= 0 ? 'positive' : 'negative';
    const changeIcon = priceChange24h >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
    
    overviewCard.innerHTML = `
        <div class="sentinel-card-header">
            <div class="token-identity">
                <img src="${holders.tokenLogo || price.data.logo}" alt="${holders.tokenName}" class="token-logo" data-token-address="${holders.tokenAddress}" title="Click to view on DexScreener">
                <div class="token-info">
                    <h2 class="token-name">${holders.tokenName}</h2>
                    <span class="token-symbol">$${holders.tokenSymbol}</span>
                    <span class="token-address" title="${holders.tokenAddress}">
                        ${holders.tokenAddress.slice(0, 6)}...${holders.tokenAddress.slice(-4)}
                        <i class="fas fa-copy copy-address" data-address="${holders.tokenAddress}"></i>
                    </span>
                </div>
            </div>
            <div class="price-section">
                <div class="current-price">$${formatNumber(currentPrice, 6)}</div>
                <div class="price-change ${changeClass}">
                    <i class="fas ${changeIcon}"></i>
                    ${formatPercentage(priceChange24h)}
                </div>
            </div>
        </div>
        
        <div class="sentinel-card-content">
            <div class="metrics-grid">
                <div class="metric-item">
                    <span class="metric-label">Exchange</span>
                    <div class="metric-value">
                        <img src="${holders.exchangeLogo}" alt="${holders.exchange}" class="exchange-logo">
                        ${holders.exchange}
                    </div>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Pair</span>
                    <span class="metric-value">${holders.pairLabel}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Liquidity</span>
                    <span class="metric-value">$${formatNumber(holders.totalLiquidityUsd)}</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">24h Volume</span>
                    <span class="metric-value">$${formatNumber(holders.totalVolume?.['24h'])}</span>
                </div>
            </div>
        </div>
    `;
    
    container.appendChild(overviewCard);
    
    // Add copy address functionality
    const copyBtn = overviewCard.querySelector('.copy-address');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => copyToClipboard(holders.tokenAddress));
    }
    
    // Add clickable token logo to open DexScreener
    const tokenLogo = overviewCard.querySelector('.token-logo');
    if (tokenLogo) {
        tokenLogo.addEventListener('click', () => {
            const tokenAddress = tokenLogo.getAttribute('data-token-address');
            if (tokenAddress) {
                const dexScreenerUrl = `https://dexscreener.com/solana/${tokenAddress}`;
                window.open(dexScreenerUrl, '_blank');
                console.log(`Opening DexScreener for token: ${tokenAddress}`);
            }
        });
    }
}

/**
 * Render price metrics with timeframe breakdown
 */
function renderPriceMetrics(tokenMetadata, container) {
    const { holders } = tokenMetadata;
    if (!holders?.pricePercentChange) return;
    
    const priceCard = document.createElement('div');
    priceCard.className = 'sentinel-card sentinel-price-card';
    
    const timeframes = ['5min', '1h', '4h', '24h'];
    const priceChanges = holders.pricePercentChange;
    
    priceCard.innerHTML = `
        <div class="sentinel-card-header">
            <h3><i class="fas fa-chart-line"></i> Price Performance</h3>
        </div>
        <div class="sentinel-card-content">
            <div class="timeframe-grid">
                ${timeframes.map(tf => {
                    const change = priceChanges[tf];
                    const changeClass = change >= 0 ? 'positive' : 'negative';
                    const changeIcon = change >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
                    
                    return `
                        <div class="timeframe-item">
                            <span class="timeframe-label">${tf.toUpperCase()}</span>
                            <div class="timeframe-change ${changeClass}">
                                <i class="fas ${changeIcon}"></i>
                                ${formatPercentage(change)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    container.appendChild(priceCard);
}

/**
 * Render trading activity metrics
 */
function renderTradingActivity(tokenMetadata, container) {
    const { holders } = tokenMetadata;
    if (!holders?.buys || !holders?.sells) return;
    
    const tradingCard = document.createElement('div');
    tradingCard.className = 'sentinel-card sentinel-trading-card';
    
    const timeframes = ['5min', '1h', '4h', '24h'];
    
    tradingCard.innerHTML = `
        <div class="sentinel-card-header">
            <h3><i class="fas fa-exchange-alt"></i> Trading Activity</h3>
        </div>
        <div class="sentinel-card-content">
            <div class="trading-grid">
                ${timeframes.map(tf => {
                    const buys = holders.buys[tf] || 0;
                    const sells = holders.sells[tf] || 0;
                    const buyers = holders.buyers[tf] || 0;
                    const sellers = holders.sellers[tf] || 0;
                    const buyVolume = holders.buyVolume[tf] || 0;
                    const sellVolume = holders.sellVolume[tf] || 0;
                    
                    const totalTxs = buys + sells;
                    const buyRatio = totalTxs > 0 ? (buys / totalTxs) * 100 : 0;
                    
                    return `
                        <div class="trading-timeframe">
                            <h4>${tf.toUpperCase()}</h4>
                            <div class="trading-metrics">
                                <div class="trading-row">
                                    <span class="buy-metric">
                                        <i class="fas fa-arrow-up"></i>
                                        <span class="trades-count">${buys} buys</span>
                                        <span class="traders-count">(${buyers} buyers)</span>
                                    </span>
                                    <span class="sell-metric">
                                        <i class="fas fa-arrow-down"></i>
                                        <span class="trades-count">${sells} sells</span>
                                        <span class="traders-count">(${sellers} sellers)</span>
                                    </span>
                                </div>
                                <div class="volume-row">
                                    <span class="buy-volume">Buy: $${formatNumber(buyVolume)}</span>
                                    <span class="sell-volume">Sell: $${formatNumber(sellVolume)}</span>
                                </div>
                                <div class="ratio-bar">
                                    <div class="buy-ratio" style="width: ${buyRatio}%"></div>
                                    <div class="sell-ratio" style="width: ${100 - buyRatio}%"></div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    container.appendChild(tradingCard);
}

/**
 * Render liquidity metrics
 */
function renderLiquidityMetrics(tokenMetadata, container) {
    const { holders } = tokenMetadata;
    if (!holders?.liquidityPercentChange) return;
    
    const liquidityCard = document.createElement('div');
    liquidityCard.className = 'sentinel-card sentinel-liquidity-card';
    
    const timeframes = ['5min', '1h', '4h', '24h'];
    const liquidityChanges = holders.liquidityPercentChange;
    
    liquidityCard.innerHTML = `
        <div class="sentinel-card-header">
            <h3><i class="fas fa-tint"></i> Liquidity Analysis</h3>
        </div>
        <div class="sentinel-card-content">
            <div class="liquidity-overview">
                <div class="liquidity-total">
                    <span class="liquidity-label">Total Liquidity</span>
                    <span class="liquidity-value">$${formatNumber(holders.totalLiquidityUsd)}</span>
                </div>
            </div>
            <div class="liquidity-changes">
                ${timeframes.map(tf => {
                    const change = liquidityChanges[tf];
                    const changeClass = change >= 0 ? 'positive' : 'negative';
                    const changeIcon = change >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
                    
                    return `
                        <div class="liquidity-change-item">
                            <span class="timeframe">${tf}</span>
                            <div class="change-value ${changeClass}">
                                <i class="fas ${changeIcon}"></i>
                                ${formatPercentage(change)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    container.appendChild(liquidityCard);
}

/**
 * Render sniper analysis
 */
function renderSniperAnalysis(tokenMetadata, container) {
    const { snipers } = tokenMetadata;
    if (!snipers?.data || snipers.data.length === 0) return;
    
    const sniperCard = document.createElement('div');
    sniperCard.className = 'sentinel-card sentinel-sniper-card';
    
    const sniperData = snipers.data[0]; // First sniper for now
    
    sniperCard.innerHTML = `
        <div class="sentinel-card-header">
            <h3><i class="fas fa-crosshairs"></i> Sniper Analysis</h3>
        </div>
        <div class="sentinel-card-content">
            <div class="sniper-metrics">
                <div class="sniper-item">
                    <span class="sniper-label">Total Sniped</span>
                    <span class="sniper-value">${formatNumber(sniperData.totalTokensSniped)} tokens</span>
                </div>
                <div class="sniper-item">
                    <span class="sniper-label">Sniped Value</span>
                    <span class="sniper-value">$${formatNumber(sniperData.totalSnipedUsd)}</span>
                </div>
                <div class="sniper-item">
                    <span class="sniper-label">Current Balance</span>
                    <span class="sniper-value">${formatNumber(sniperData.currentBalance)} tokens</span>
                </div>
                <div class="sniper-item">
                    <span class="sniper-label">Realized Profit</span>
                    <span class="sniper-value ${sniperData.realizedProfitUsd >= 0 ? 'positive' : 'negative'}">
                        $${formatNumber(sniperData.realizedProfitUsd)}
                    </span>
                </div>
            </div>
            <div class="sniper-wallet">
                <span class="wallet-label">Sniper Wallet:</span>
                <a href="${sniperData.walletAddress}" target="_blank" class="wallet-link">
                    ${sniperData.walletAddress.includes('solscan') ? 
                        sniperData.walletAddress.split('/').pop().slice(0, 8) + '...' : 
                        sniperData.walletAddress}
                    <i class="fas fa-external-link-alt"></i>
                </a>
            </div>
        </div>
    `;
    
    container.appendChild(sniperCard);
}

/**
 * Render pair information
 */
function renderPairInformation(tokenMetadata, container) {
    const { pairAddress } = tokenMetadata;
    if (!pairAddress || pairAddress.length === 0) return;
    
    const pairCard = document.createElement('div');
    pairCard.className = 'sentinel-card sentinel-pair-card';
    
    // Show first 10 pairs
    const displayPairs = pairAddress.slice(0, 10);
    
    pairCard.innerHTML = `
        <div class="sentinel-card-header">
            <h3><i class="fas fa-link"></i> Trading Pairs</h3>
            <span class="pair-count">${pairAddress.length} total pairs</span>
        </div>
        <div class="sentinel-card-content">
            <div class="pair-list">
                ${displayPairs.map((pair, index) => `
                    <div class="pair-item">
                        <span class="pair-index">${index + 1}</span>
                        <span class="pair-address" title="${pair}">
                            ${pair.slice(0, 8)}...${pair.slice(-6)}
                        </span>
                        <i class="fas fa-copy copy-pair" data-address="${pair}"></i>
                    </div>
                `).join('')}
            </div>
            ${pairAddress.length > 10 ? `
                <div class="pair-more">
                    <button class="show-more-pairs">Show ${pairAddress.length - 10} more pairs</button>
                </div>
            ` : ''}
        </div>
    `;
    
    container.appendChild(pairCard);
    
    // Add copy functionality
    pairCard.querySelectorAll('.copy-pair').forEach(btn => {
        btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.address);
        });
    });
}

/**
 * Render additional token info if available
 */
function renderAdditionalTokenInfo(tokenInfo, container) {
    // This would handle any additional token info that doesn't have errors
    // For now, we'll skip since the example shows an error
}

/**
 * Render social data with clean error handling
 */
function renderSocialData(socialData, container) {
    const socialCard = document.createElement('div');
    socialCard.className = 'sentinel-card sentinel-social-card';
    
    if (socialData.error) {
        // Display clean error message
        socialCard.innerHTML = `
            <div class="sentinel-card-header">
                <h3><i class="fas fa-exclamation-triangle"></i> Social Data</h3>
            </div>
            <div class="sentinel-card-content">
                <div class="error-message">
                    <i class="fas fa-info-circle"></i>
                    <p>${socialData.message}</p>
                </div>
            </div>
        `;
    } else {
        // Display successful social data
        const tweets = socialData.tweets || [];
        const searchTerm = socialData.searchTerm || socialData.tokenSymbol;
        
        socialCard.innerHTML = `
            <div class="sentinel-card-header">
                <h3><i class="fab fa-twitter"></i> Social Activity</h3>
                <span class="search-term">Search: ${searchTerm}</span>
            </div>
            <div class="sentinel-card-content">
                ${tweets.length > 0 ? `
                    <div class="tweets-list">
                        ${tweets.slice(0, 5).map(tweet => `
                            <div class="tweet-item">
                                <div class="tweet-content">${tweet.text || tweet.content}</div>
                                <div class="tweet-meta">
                                    <span class="tweet-author">@${tweet.author || 'Unknown'}</span>
                                    <span class="tweet-date">${tweet.created_at || tweet.date}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${tweets.length > 5 ? `
                        <div class="tweets-more">
                            <p>Showing 5 of ${tweets.length} tweets</p>
                        </div>
                    ` : ''}
                ` : `
                    <div class="no-tweets">
                        <i class="fas fa-search"></i>
                        <p>No recent social activity found for ${searchTerm}</p>
                    </div>
                `}
            </div>
        `;
    }
    
    container.appendChild(socialCard);
}

/**
 * Utility Functions
 */

function formatNumber(num, decimals = 2) {
    if (!num || isNaN(num)) return '0';
    
    const number = parseFloat(num);
    
    if (number >= 1e9) {
        return (number / 1e9).toFixed(1) + 'B';
    } else if (number >= 1e6) {
        return (number / 1e6).toFixed(1) + 'M';
    } else if (number >= 1e3) {
        return (number / 1e3).toFixed(1) + 'K';
    } else if (number < 0.01 && number > 0) {
        return number.toFixed(6);
    } else {
        return number.toFixed(decimals);
    }
}

function formatPercentage(num) {
    if (!num || isNaN(num)) return '0.00%';
    return `${parseFloat(num).toFixed(2)}%`;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show temporary success indicator
        showCopySuccess();
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function showCopySuccess() {
    // Create temporary success indicator
    const indicator = document.createElement('div');
    indicator.className = 'copy-success';
    indicator.textContent = 'Copied!';
    indicator.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--sentinel-primary);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;
    
    document.body.appendChild(indicator);
    
    setTimeout(() => {
        document.body.removeChild(indicator);
    }, 2000);
}

// Export the main render function
export { renderSearchResults as default };
