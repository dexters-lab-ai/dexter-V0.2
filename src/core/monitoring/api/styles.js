export const apiStyles = `
  /* API Documentation Styles */
  .api-docs {
    margin-top: 2rem;
    padding: 2rem;
  }

  .api-endpoint {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .endpoint-url {
    font-family: monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 0.5rem 1rem;
    border-radius: 5px;
    color: var(--accent);
    display: inline-block;
    margin: 1rem 0;
  }

  .method-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-weight: bold;
    margin-right: 1rem;
  }

  .method-post { background: #49cc90; }
  .method-get { background: #61affe; }

  /* Request/Response Examples */
  .example-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    margin: 1.5rem 0;
  }

  .example-box {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .example-box h4 {
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }

  /* Interactive Testing Console */
  .api-console {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    padding: 1.5rem;
    margin-top: 2rem;
  }

  .console-output {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 5px;
    padding: 1rem;
    font-family: monospace;
    margin-top: 1rem;
    min-height: 100px;
    max-height: 300px;
    overflow-y: auto;
  }

  /* API Key Display */
  .api-key-box {
    background: rgba(0, 255, 0, 0.1);
    border: 1px solid rgba(0, 255, 0, 0.2);
    border-radius: 8px;
    padding: 1rem;
    margin: 1rem 0;
    position: relative;
  }

  .key-value {
    font-family: monospace;
    word-break: break-all;
  }

  .copy-button {
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .copy-button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Usage Statistics */
  .usage-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 2rem;
  }

  .stat-card {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: bold;
    color: var(--primary);
    margin: 0.5rem 0;
  }

  .stat-label {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  /* Loading States */
  .loading {
    position: relative;
    pointer-events: none;
  }

  .loading::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    border-radius: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
  }

  .loading::before {
    content: '⚡';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.5; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }

  /* Response Formatting */
  .response-success {
    border-left: 4px solid #49cc90;
  }

  .response-error {
    border-left: 4px solid #f93e3e;
  }

  /* Cost Estimation */
  .cost-estimate {
    margin-top: 1rem;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .cost-breakdown {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .cost-item {
    display: contents;
  }

  .cost-item > * {
    padding: 0.25rem;
  }

  .cost-item:nth-child(odd) > * {
    background: rgba(255, 255, 255, 0.02);
  }

  /* Rate Limit Display */
  .rate-limit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .rate-limit-progress {
    flex: 1;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .rate-limit-bar {
    height: 100%;
    background: var(--primary);
    width: var(--progress);
    transition: width 0.3s ease;
  }

  /* Documentation Improvements */
  .schema-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }

  .schema-table th,
  .schema-table td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .schema-table th {
    color: var(--text-secondary);
    font-weight: normal;
  }

  .param-required {
    color: #f93e3e;
    margin-left: 0.25rem;
  }

  .param-optional {
    color: #909399;
    margin-left: 0.25rem;
  }

  /* Interactive Elements */
  .try-it-out {
    margin-top: 1rem;
  }

  .try-it-out button {
    background: var(--primary);
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    color: white;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .try-it-out button:hover {
    background: var(--primary-dark);
    transform: translateY(-1px);
  }

  /* Authentication Section */
  .auth-section {
    margin: 2rem 0;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }

  .auth-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .auth-type {
    background: rgba(97, 175, 254, 0.1);
    color: #61affe;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  /* Responsive Adjustments */
  @media (max-width: 768px) {
    .example-container {
      grid-template-columns: 1fr;
    }

    .usage-stats {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }

    .api-console {
      padding: 1rem;
    }
  }
`;