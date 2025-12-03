/**
 * Meshpay Charges Playground - Frontend Logic
 * 
 * Handles:
 * - Preset scenarios
 * - Form management
 * - Request inspector (real-time updates + cURL generation)
 * - API calls via proxy
 * - Response display
 * - Transaction log with latency tracking
 */

// ==========================================================================
// Configuration & State
// ==========================================================================

let backendUrl = 'http://localhost:8000';
const transactionLog = [];

// Current charge state for payment flow
let currentCharge = null;
let currentMonitorId = null;

// UI State polling handle (for cleanup)
let currentPollingInterval = null;

// Wallet state
let connectedWallet = null;
let walletPublicKey = null;

// USDC token addresses on Solana
const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Detect if Phantom is installed
const getPhantomProvider = () => {
    if ('phantom' in window) {
        const provider = window.phantom?.solana;
        if (provider?.isPhantom) {
            return provider;
        }
    }
    return null;
};

// Preset configurations
// Note: Presets do NOT include x402 fields - users must set up wallets or receiver configs
// This ensures proper x402 resolution flow and guides users to configure their payment setup
const PRESETS = {
    'small': {
        amount: 1,
        currency: 'USDC',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    },
    'medium': {
        amount: 50,
        currency: 'USDC',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    },
    'high': {
        amount: 1000,
        currency: 'USDC',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    },
    'metadata': {
        amount: 25,
        currency: 'USDC',
        customer_ref: 'demo_user_123',
        resource_ref: 'article:42',
        reference: 'order_456',
        metadata: JSON.stringify({
            tier: 'pro',
            source: 'playground',
            test: true
        }, null, 2)
    },
    'missing-amount': {
        amount: '',
        currency: 'USDC',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    },
    'bad-currency': {
        amount: 10,
        currency: 'INVALID',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    },
    'zero-amount': {
        amount: 0,
        currency: 'USDC',
        customer_ref: '',
        resource_ref: '',
        reference: '',
        metadata: ''
    }
};

// ==========================================================================
// DOM Elements
// ==========================================================================

const elements = {
    backendUrl: document.getElementById('backend-url'),
    proxyTarget: document.getElementById('proxy-target'),
    testConnectionBtn: document.getElementById('test-connection-btn'),
    connectionStatus: document.getElementById('connection-status'),
    chargeForm: document.getElementById('charge-form'),
    submitBtn: document.getElementById('submit-btn'),
    amountInput: document.getElementById('amount'),
    currencySelect: document.getElementById('currency'),
    customerRefInput: document.getElementById('customer_ref'),
    resourceRefInput: document.getElementById('resource_ref'),
    referenceInput: document.getElementById('reference'),
    metadataInput: document.getElementById('metadata'),
    requestBody: document.getElementById('request-body'),
    copyCurlBtn: document.getElementById('copy-curl-btn'),
    responseStatus: document.getElementById('response-status'),
    responseBody: document.getElementById('response-body'),
    copyResponseBtn: document.getElementById('copy-response-btn'),
    transactionLog: document.getElementById('transaction-log'),
    clearLogBtn: document.getElementById('clear-log-btn'),
    infoBanner: document.getElementById('info-banner'),
    infoBannerText: document.getElementById('info-banner-text'),
    // Payment panel elements
    paymentPanel: document.getElementById('payment-panel'),
    paymentTxnId: document.getElementById('payment-txn-id'),
    paymentAmount: document.getElementById('payment-amount'),
    paymentAddress: document.getElementById('payment-address'),
    paymentStatus: document.getElementById('payment-status'),
    startMonitorBtn: document.getElementById('start-monitor-btn'),
    simulatePaymentBtn: document.getElementById('simulate-payment-btn'),
    checkStatusBtn: document.getElementById('check-status-btn'),
    paymentMessage: document.getElementById('payment-message'),
    payWithWalletBtn: document.getElementById('pay-with-wallet-btn'),
    // Wallet elements
    walletDisconnected: document.getElementById('wallet-disconnected'),
    walletConnected: document.getElementById('wallet-connected'),
    connectPhantomBtn: document.getElementById('connect-phantom-btn'),
    disconnectWalletBtn: document.getElementById('disconnect-wallet-btn'),
    walletAddress: document.getElementById('wallet-address'),
    // Verification elements
    verificationSection: document.getElementById('verification-section'),
    verifyPaymentBtn: document.getElementById('verify-payment-btn'),
    verificationResult: document.getElementById('verification-result'),
    verificationStatus: document.getElementById('verification-status'),
    verificationResponse: document.getElementById('verification-response')
};

// ==========================================================================
// Initialization
// ==========================================================================

async function init() {
    // Load backend URL from config
    await loadConfig();
    
    // Set up event listeners
    setupEventListeners();
    
    // Update request inspector with initial state
    updateRequestInspector();
    
    // Check for Phantom wallet
    checkWalletConnection();
}

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const config = await response.json();
        backendUrl = config.backend_url || 'http://localhost:8000';
        
        // Update UI elements if they exist
        if (elements.backendUrl) {
            elements.backendUrl.textContent = backendUrl;
        }
        if (elements.proxyTarget) {
            elements.proxyTarget.textContent = backendUrl;
        }
        
        // Set up dashboard link for receiver configs
        const dashboardUrl = backendUrl.replace(':8000', ':3000');
        const setupLink = document.getElementById('setup-link');
        if (setupLink) {
            setupLink.href = `${dashboardUrl}/settings/receiver-configs`;
        }
        
        console.log('Config loaded successfully:', backendUrl);
    } catch (error) {
        console.error('Failed to load config:', error);
        const fallbackUrl = 'http://localhost:8000';
        backendUrl = fallbackUrl;
        if (elements.backendUrl) {
            elements.backendUrl.textContent = `${fallbackUrl} (config error)`;
        }
        if (elements.proxyTarget) {
            elements.proxyTarget.textContent = fallbackUrl;
        }
    }
}

function setupEventListeners() {
    // Test connection button
    elements.testConnectionBtn.addEventListener('click', testConnection);
    
    // Form submission
    elements.chargeForm.addEventListener('submit', handleFormSubmit);
    
    // Form input changes - update request inspector
    ['amount', 'currency', 'customer_ref', 'resource_ref', 'reference', 'metadata'].forEach(field => {
        const el = document.getElementById(field);
        if (el) {
            el.addEventListener('input', updateRequestInspector);
            el.addEventListener('change', updateRequestInspector);
        }
    });
    
    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });
    
    // Copy buttons
    elements.copyCurlBtn.addEventListener('click', copyCurl);
    elements.copyResponseBtn.addEventListener('click', copyResponse);
    
    // Clear log button
    elements.clearLogBtn.addEventListener('click', clearLog);
    
    // Payment panel buttons
    elements.startMonitorBtn.addEventListener('click', startPaymentMonitor);
    elements.simulatePaymentBtn.addEventListener('click', simulatePayment);
    elements.checkStatusBtn.addEventListener('click', checkPaymentStatus);
    elements.payWithWalletBtn.addEventListener('click', payWithWallet);
    
    // Wallet buttons
    elements.connectPhantomBtn.addEventListener('click', connectPhantomWallet);
    elements.disconnectWalletBtn.addEventListener('click', disconnectWallet);
    
    // Verification button
    elements.verifyPaymentBtn.addEventListener('click', verifyPayment);
}

// ==========================================================================
// Connection Test
// ==========================================================================

async function testConnection() {
    elements.testConnectionBtn.disabled = true;
    elements.testConnectionBtn.innerHTML = '<span class="btn-icon">⏳</span> Testing...';
    elements.connectionStatus.textContent = '';
    elements.connectionStatus.className = 'connection-status';
    
    try {
        const response = await fetch('/api/test-connection');
        const result = await response.json();
        
        if (result.backend.reachable && result.backend.api_key_valid) {
            elements.connectionStatus.textContent = '✅ Ready – Backend healthy, API key valid';
            elements.connectionStatus.className = 'connection-status success';
        } else if (result.backend.reachable && result.backend.api_key_valid === false) {
            elements.connectionStatus.textContent = '⚠️ Backend OK, but API key invalid – Check .env';
            elements.connectionStatus.className = 'connection-status warning';
        } else if (!result.backend.reachable) {
            elements.connectionStatus.textContent = '❌ Backend unreachable – Is it running?';
            elements.connectionStatus.className = 'connection-status error';
        } else {
            elements.connectionStatus.textContent = '⚠️ Partial connection';
            elements.connectionStatus.className = 'connection-status warning';
        }
    } catch (error) {
        elements.connectionStatus.textContent = '❌ Demo server error';
        elements.connectionStatus.className = 'connection-status error';
    } finally {
        elements.testConnectionBtn.disabled = false;
        elements.testConnectionBtn.innerHTML = '<span class="btn-icon">🔌</span> Test Connection';
    }
}

// ==========================================================================
// Presets
// ==========================================================================

function applyPreset(presetName) {
    const preset = PRESETS[presetName];
    if (!preset) return;
    
    elements.amountInput.value = preset.amount;
    
    // Handle invalid currency for error demo
    if (preset.currency === 'INVALID') {
        // Temporarily add invalid option
        const invalidOption = document.createElement('option');
        invalidOption.value = 'INVALID';
        invalidOption.textContent = 'INVALID';
        elements.currencySelect.appendChild(invalidOption);
        elements.currencySelect.value = 'INVALID';
    } else {
        // Remove invalid option if it exists
        const invalidOption = elements.currencySelect.querySelector('option[value="INVALID"]');
        if (invalidOption) invalidOption.remove();
        elements.currencySelect.value = preset.currency;
    }
    
    elements.customerRefInput.value = preset.customer_ref || '';
    elements.resourceRefInput.value = preset.resource_ref || '';
    elements.referenceInput.value = preset.reference || '';
    elements.metadataInput.value = preset.metadata || '';
    
    updateRequestInspector();
}

// ==========================================================================
// Request Inspector
// ==========================================================================

function buildRequestBody() {
    const body = {};
    
    const amount = elements.amountInput.value;
    if (amount !== '') {
        body.amount = parseFloat(amount);
    }
    
    const currency = elements.currencySelect.value;
    if (currency) {
        body.currency = currency;
    }
    
    const customerRef = elements.customerRefInput.value.trim();
    if (customerRef) {
        body.customer_ref = customerRef;
    }
    
    const resourceRef = elements.resourceRefInput.value.trim();
    if (resourceRef) {
        body.resource_ref = resourceRef;
    }
    
    const reference = elements.referenceInput.value.trim();
    if (reference) {
        body.reference = reference;
    }
    
    const metadataStr = elements.metadataInput.value.trim();
    if (metadataStr) {
        try {
            body.metadata = JSON.parse(metadataStr);
        } catch (e) {
            // Invalid JSON - will be caught during submission
        }
    }
    
    // x402 fields are NOT included in requests - users must set up proper configuration
    // The backend will validate x402 configuration via this fallback chain:
    // 1. Charge request x402 fields (if provided - not available in this demo)
    // 2. Receiver config (if receiver_config_id provided - not available in this demo)
    // 3. Default receiver config (if exists - user must create in dashboard)
    // 4. Connected Solana wallet (if available - user must connect in dashboard)
    // 5. Error with clear guidance (if none found)
    //
    // This ensures users are properly guided to set up wallets or receiver configs
    // before they can create charges.
    
    return body;
}

function updateRequestInspector() {
    const body = buildRequestBody();
    elements.requestBody.innerHTML = syntaxHighlightJSON(JSON.stringify(body, null, 2));
}

function syntaxHighlightJSON(json) {
    if (!json) return '';
    
    return json
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, (match) => {
            let cls = 'json-string';
            if (/:$/.test(match)) {
                cls = 'json-key';
                match = match.slice(0, -1) + '<span style="color: var(--text-primary)">:</span>';
            }
            return `<span class="${cls}">${match}</span>`;
        })
        .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
        .replace(/\bnull\b/g, '<span class="json-null">null</span>')
        .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="json-number">$1</span>');
}

// ==========================================================================
// cURL Generation
// ==========================================================================

function generateCurl() {
    const body = buildRequestBody();
    const jsonBody = JSON.stringify(body);
    
    return `curl -X POST "${backendUrl}/v1/charges" \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '${jsonBody}'`;
}

async function copyCurl() {
    const curl = generateCurl();
    try {
        await navigator.clipboard.writeText(curl);
        const originalText = elements.copyCurlBtn.innerHTML;
        elements.copyCurlBtn.innerHTML = '<span class="btn-icon">✅</span> Copied!';
        setTimeout(() => {
            elements.copyCurlBtn.innerHTML = originalText;
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
    }
}

// ==========================================================================
// Form Submission & API Call
// ==========================================================================

async function handleFormSubmit(event) {
    event.preventDefault();
    
    const body = buildRequestBody();
    
    // Validate metadata JSON if provided
    const metadataStr = elements.metadataInput.value.trim();
    if (metadataStr) {
        try {
            JSON.parse(metadataStr);
        } catch (e) {
            showResponse(400, { error: 'invalid_metadata', detail: 'Metadata must be valid JSON' });
            return;
        }
    }
    
    elements.submitBtn.disabled = true;
    elements.submitBtn.innerHTML = '<span class="btn-icon">⏳</span> Creating...';
    
    const startTime = Date.now();
    
    try {
        const response = await fetch('/api/charges', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const latency = Date.now() - startTime;
        const responseData = await response.json();
        
        showResponse(response.status, responseData);
        addLogEntry(body, response.status, responseData, latency);
        
    } catch (error) {
        const latency = Date.now() - startTime;
        const errorData = { error: 'network_error', detail: error.message };
        showResponse(0, errorData);
        addLogEntry(body, 0, errorData, latency);
    } finally {
        elements.submitBtn.disabled = false;
        elements.submitBtn.innerHTML = '<span class="btn-icon">🚀</span> Create Charge';
    }
}

// ==========================================================================
// Response Display
// ==========================================================================

function showResponse(statusCode, data) {
    // Status badge
    let statusClass = 'status-2xx';
    let statusText = `${statusCode} OK`;
    
    if (statusCode >= 400 && statusCode < 500) {
        statusClass = 'status-4xx';
        statusText = `${statusCode} Client Error`;
    } else if (statusCode >= 500 || statusCode === 0) {
        statusClass = 'status-5xx';
        statusText = statusCode === 0 ? 'Network Error' : `${statusCode} Server Error`;
    } else if (statusCode === 201) {
        statusText = '201 Created';
    }
    
    // Check for x402 configuration errors from backend and show banner
    let responseData = data;
    // Ensure errorDetail is a string before calling toLowerCase()
    const errorDetail = String(data?.detail || data?.error || '');
    const errorDetailLower = errorDetail.toLowerCase();
    const isX402Error = errorDetailLower.includes('x402') || 
                        errorDetailLower.includes('configuration') ||
                        errorDetailLower.includes('receiver config') ||
                        errorDetailLower.includes('wallet');
    
    // Show/hide info banner based on x402 error from backend
    if (isX402Error && statusCode >= 400) {
        // Display backend's error message in the banner
        elements.infoBannerText.innerHTML = `<strong>Setup required:</strong> ${errorDetail}`;
        elements.infoBanner.style.display = 'flex';
    } else {
        // Hide banner if no x402 error
        elements.infoBanner.style.display = 'none';
    }
    
    elements.responseStatus.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
    elements.responseBody.innerHTML = syntaxHighlightJSON(JSON.stringify(responseData, null, 2));
    elements.copyResponseBtn.disabled = false;
    
    // Show payment panel if charge was created successfully
    if (statusCode === 201 && data.id && data.x402_requirements) {
        showPaymentPanel(data);
    } else {
        hidePaymentPanel();
    }
}

// ==========================================================================
// Payment Panel
// ==========================================================================

function showPaymentPanel(chargeData) {
    currentCharge = chargeData;
    currentMonitorId = null;
    
    const x402 = chargeData.x402_requirements || {};
    const railConfig = x402.rail_config || {};
    
    // Update payment info
    elements.paymentTxnId.textContent = chargeData.id;
    elements.paymentAmount.textContent = `${x402.amount || chargeData.amount} ${x402.currency || chargeData.currency}`;
    elements.paymentAddress.textContent = railConfig.pay_to_address || 'N/A';
    updatePaymentStatus(chargeData.status);
    
    // Reset buttons
    elements.startMonitorBtn.disabled = false;
    elements.simulatePaymentBtn.disabled = true;
    elements.checkStatusBtn.disabled = true;
    
    // Enable pay button - it will handle wallet connection if needed
    elements.payWithWalletBtn.disabled = false;
    
    // Update button text based on wallet connection status
    if (walletPublicKey) {
        elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">💰</span> Pay with Wallet';
    } else {
        elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">🔌</span> Connect Wallet & Pay';
    }
    
    // Clear message
    setPaymentMessage('', '');
    
    // Show helpful message
    if (walletPublicKey) {
        setPaymentMessage(
            `💡 Wallet connected! Click "Pay with Wallet" to send ${x402.amount || chargeData.amount} ${x402.currency || chargeData.currency}`,
            'info'
        );
    } else {
        setPaymentMessage(
            '💡 Click "Connect Wallet & Pay" to connect your Phantom wallet and pay directly, or use "Simulate" for testing.',
            'info'
        );
    }
    
    // Hide content unlocked section (reset state)
    hideContentUnlocked();
    
    // Show panel
    elements.paymentPanel.style.display = 'block';
    
    // Start automatic UI state polling
    // This removes the need for manual "Verify Payment" clicks
    // The UI will automatically update when payment status changes
    startUIStatePolling(chargeData.id, handleUIStateUpdate);
}

function hidePaymentPanel() {
    elements.paymentPanel.style.display = 'none';
    currentCharge = null;
    currentMonitorId = null;
    
    // Stop any active polling
    stopUIStatePolling();
    
    // Hide related sections
    hideVerificationSection();
    hideContentUnlocked();
}

function updatePaymentStatus(status) {
    elements.paymentStatus.textContent = status;
    elements.paymentStatus.className = `payment-value status-${status}`;
}

function setPaymentMessage(message, type) {
    elements.paymentMessage.textContent = message;
    elements.paymentMessage.className = `payment-message ${type}`;
}

async function startPaymentMonitor() {
    if (!currentCharge) return;
    
    elements.startMonitorBtn.disabled = true;
    elements.startMonitorBtn.innerHTML = '<span class="btn-icon">⏳</span> Starting...';
    setPaymentMessage('Registering payment monitor...', 'info');
    
    try {
        const response = await fetch('/api/facilitator/monitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_id: currentCharge.id })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentMonitorId = result.monitor_id;
            updatePaymentStatus('monitoring');
            setPaymentMessage(
                `✅ Monitor started! Waiting for payment to ${result.pay_to_address}. ` +
                `Send ${result.amount} ${result.currency} to complete.`,
                'success'
            );
            
            // Enable simulate and check status buttons
            elements.simulatePaymentBtn.disabled = false;
            elements.checkStatusBtn.disabled = false;
        } else {
            setPaymentMessage(`❌ Error: ${result.detail || 'Failed to start monitor'}`, 'error');
            elements.startMonitorBtn.disabled = false;
        }
    } catch (error) {
        setPaymentMessage(`❌ Network error: ${error.message}`, 'error');
        elements.startMonitorBtn.disabled = false;
    } finally {
        elements.startMonitorBtn.innerHTML = '<span class="btn-icon">👁️</span> Start Payment Monitor';
    }
}

async function simulatePayment() {
    if (!currentCharge) return;
    
    elements.simulatePaymentBtn.disabled = true;
    elements.simulatePaymentBtn.innerHTML = '<span class="btn-icon">⏳</span> Simulating...';
    setPaymentMessage('Simulating blockchain payment...', 'info');
    
    // Generate a fake tx hash for testing
    const fakeTxHash = 'sim_' + Math.random().toString(36).substring(2, 15) + 
                       Math.random().toString(36).substring(2, 15);
    
    try {
        const response = await fetch('/api/facilitator/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction_id: currentCharge.id,
                tx_hash: fakeTxHash
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            const confirmResult = await response.json();
            updatePaymentStatus('succeeded');
            setPaymentMessage(
                `🎉 Payment confirmed! Transaction hash: ${fakeTxHash}`,
                'success'
            );
            
            // Disable payment buttons
            elements.startMonitorBtn.disabled = true;
            elements.simulatePaymentBtn.disabled = true;
            elements.checkStatusBtn.disabled = true;
            
            // Update the charge data
            currentCharge.status = 'succeeded';
            currentCharge.tx_hash = fakeTxHash;
            
            // Wait a moment for database to update, then show verification section
            setTimeout(() => {
                showVerificationSection();
            }, 500);
        } else {
            setPaymentMessage(`❌ Error: ${result.detail || 'Failed to confirm payment'}`, 'error');
            elements.simulatePaymentBtn.disabled = false;
        }
    } catch (error) {
        setPaymentMessage(`❌ Network error: ${error.message}`, 'error');
        elements.simulatePaymentBtn.disabled = false;
    } finally {
        elements.simulatePaymentBtn.innerHTML = '<span class="btn-icon">🧪</span> Simulate Payment (Test)';
    }
}

async function checkPaymentStatus() {
    if (!currentMonitorId) {
        setPaymentMessage('⚠️ No active monitor. Start a monitor first.', 'warning');
        return;
    }
    
    elements.checkStatusBtn.disabled = true;
    elements.checkStatusBtn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
    
    try {
        const response = await fetch(`/api/facilitator/monitor/${currentMonitorId}`);
        const result = await response.json();
        
        if (response.ok) {
            updatePaymentStatus(result.status);
            
            if (result.status === 'confirmed' || result.status === 'succeeded') {
                setPaymentMessage(
                    `✅ Payment confirmed! TX: ${result.tx_hash || 'N/A'}`,
                    'success'
                );
                elements.simulatePaymentBtn.disabled = true;
            } else if (result.status === 'timeout') {
                setPaymentMessage('⏰ Payment monitor timed out. Try starting a new monitor.', 'warning');
                elements.startMonitorBtn.disabled = false;
            } else {
                setPaymentMessage(`Status: ${result.status}. Still waiting for payment...`, 'info');
            }
        } else {
            setPaymentMessage(`❌ Error: ${result.detail || 'Failed to check status'}`, 'error');
        }
    } catch (error) {
        setPaymentMessage(`❌ Network error: ${error.message}`, 'error');
    } finally {
        elements.checkStatusBtn.disabled = false;
        elements.checkStatusBtn.innerHTML = '<span class="btn-icon">🔄</span> Check Status';
    }
}

async function copyResponse() {
    const responseText = elements.responseBody.textContent;
    try {
        await navigator.clipboard.writeText(responseText);
        const originalText = elements.copyResponseBtn.innerHTML;
        elements.copyResponseBtn.innerHTML = '<span class="btn-icon">✅</span> Copied!';
        setTimeout(() => {
            elements.copyResponseBtn.innerHTML = originalText;
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
    }
}

// ==========================================================================
// Transaction Log
// ==========================================================================

function addLogEntry(request, statusCode, response, latency) {
    const entry = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
        request,
        statusCode,
        response,
        latency
    };
    
    transactionLog.unshift(entry);
    renderLog();
}

function renderLog() {
    if (transactionLog.length === 0) {
        elements.transactionLog.innerHTML = '<div class="log-empty">No transactions yet. Create a charge to see logs.</div>';
        return;
    }
    
    elements.transactionLog.innerHTML = transactionLog.map(entry => {
        let statusClass = 'status-2xx';
        if (entry.statusCode >= 400 && entry.statusCode < 500) {
            statusClass = 'status-4xx';
        } else if (entry.statusCode >= 500 || entry.statusCode === 0) {
            statusClass = 'status-5xx';
        }
        
        // Generate summary
        let summary = '';
        if (entry.response.id) {
            summary = entry.response.id;
        } else if (entry.response.detail) {
            summary = entry.response.detail;
        } else if (entry.response.error) {
            summary = entry.response.error;
        } else {
            summary = 'Response received';
        }
        
        // Truncate summary if too long
        if (summary.length > 40) {
            summary = summary.substring(0, 40) + '...';
        }
        
        return `
            <div class="log-entry" data-id="${entry.id}">
                <div class="log-entry-header" onclick="toggleLogEntry(${entry.id})">
                    <span class="log-timestamp">${entry.timestamp}</span>
                    <span class="log-status ${statusClass}">${entry.statusCode || 'ERR'}</span>
                    <span class="log-summary">${escapeHtml(summary)}</span>
                    <span class="log-latency">(${entry.latency}ms)</span>
                    <span class="log-expand-icon">▶</span>
                </div>
                <div class="log-entry-details">
                    <div class="log-detail-section">
                        <div class="log-detail-title">Request</div>
                        <pre class="code-block code-small">${syntaxHighlightJSON(JSON.stringify(entry.request, null, 2))}</pre>
                    </div>
                    <div class="log-detail-section">
                        <div class="log-detail-title">Response</div>
                        <pre class="code-block code-small">${syntaxHighlightJSON(JSON.stringify(entry.response, null, 2))}</pre>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleLogEntry(id) {
    const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
    if (entry) {
        entry.classList.toggle('expanded');
    }
}

function clearLog() {
    transactionLog.length = 0;
    renderLog();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make toggleLogEntry available globally for onclick handler
window.toggleLogEntry = toggleLogEntry;

// ==========================================================================
// Wallet Connection
// ==========================================================================

function checkWalletConnection() {
    const provider = getPhantomProvider();
    
    if (!provider) {
        elements.connectPhantomBtn.innerHTML = '⬇️ Install Phantom';
        elements.connectPhantomBtn.onclick = () => {
            window.open('https://phantom.app/', '_blank');
        };
        return;
    }
    
    // Listen for wallet events
    provider.on('connect', (publicKey) => {
        console.log('Wallet connected:', publicKey.toBase58());
        updateWalletUI(publicKey);
    });
    
    provider.on('disconnect', () => {
        console.log('Wallet disconnected');
        updateWalletUI(null);
    });
    
    provider.on('accountChanged', (publicKey) => {
        if (publicKey) {
            console.log('Wallet account changed:', publicKey.toBase58());
            updateWalletUI(publicKey);
        } else {
            // Disconnected
            updateWalletUI(null);
        }
    });
    
    // Check if already connected
    if (provider.isConnected && provider.publicKey) {
        updateWalletUI(provider.publicKey);
    }
}

async function connectPhantomWallet() {
    const provider = getPhantomProvider();
    
    if (!provider) {
        window.open('https://phantom.app/', '_blank');
        return;
    }
    
    try {
        elements.connectPhantomBtn.disabled = true;
        elements.connectPhantomBtn.innerHTML = 'Connecting...';
        
        const resp = await provider.connect();
        walletPublicKey = resp.publicKey;
        connectedWallet = provider;
        
        updateWalletUI(walletPublicKey);
        console.log('Connected to Phantom:', walletPublicKey.toBase58());
    } catch (err) {
        console.error('Failed to connect wallet:', err);
        elements.connectPhantomBtn.disabled = false;
        elements.connectPhantomBtn.innerHTML = 'Connect Phantom';
    }
}

async function disconnectWallet() {
    const provider = getPhantomProvider();
    
    if (provider) {
        try {
            await provider.disconnect();
        } catch (err) {
            console.error('Failed to disconnect:', err);
        }
    }
    
    walletPublicKey = null;
    connectedWallet = null;
    updateWalletUI(null);
}

function updateWalletUI(publicKey) {
    if (publicKey) {
        walletPublicKey = publicKey;
        connectedWallet = getPhantomProvider();
        
        // Show connected state
        elements.walletDisconnected.style.display = 'none';
        elements.walletConnected.style.display = 'flex';
        
        // Truncate address for display
        const address = publicKey.toBase58();
        const truncated = address.slice(0, 4) + '...' + address.slice(-4);
        elements.walletAddress.textContent = truncated;
        elements.walletAddress.title = address;
        
        // Update pay button text and state if there's a current charge
        if (currentCharge && currentCharge.status === 'pending') {
            elements.payWithWalletBtn.disabled = false;
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">💰</span> Pay with Wallet';
        }
    } else {
        walletPublicKey = null;
        connectedWallet = null;
        
        // Show disconnected state
        elements.walletDisconnected.style.display = 'flex';
        elements.walletConnected.style.display = 'none';
        
        // Update pay button if there's a current charge
        if (currentCharge && currentCharge.status === 'pending') {
            elements.payWithWalletBtn.disabled = false;
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">🔌</span> Connect Wallet & Pay';
        } else {
            elements.payWithWalletBtn.disabled = true;
        }
        
        // Reset button text
        elements.connectPhantomBtn.disabled = false;
        elements.connectPhantomBtn.innerHTML = `
            <img src="https://phantom.app/img/phantom-icon-purple.svg" alt="Phantom" class="wallet-icon" onerror="this.style.display='none'">
            Connect Phantom
        `;
    }
}

// ==========================================================================
// Pay with Wallet (Real Solana USDC Transfer)
// ==========================================================================

async function payWithWallet() {
    if (!currentCharge) {
        setPaymentMessage('⚠️ No charge created. Please create a charge first.', 'warning');
        return;
    }
    
    // If wallet is not connected, connect it first
    if (!walletPublicKey || !connectedWallet) {
        setPaymentMessage('🔌 Connecting wallet...', 'info');
        elements.payWithWalletBtn.disabled = true;
        elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">⏳</span> Connecting...';
        
        try {
            await connectPhantomWallet();
            
            // After connection, check if we're still good to proceed
            if (!walletPublicKey || !connectedWallet) {
                setPaymentMessage('⚠️ Wallet connection cancelled or failed', 'warning');
                elements.payWithWalletBtn.disabled = false;
                elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">🔌</span> Connect Wallet & Pay';
                return;
            }
            
            // Update button text now that wallet is connected
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">💰</span> Pay with Wallet';
            setPaymentMessage('✅ Wallet connected! Processing payment...', 'success');
            
            // Continue with payment flow below
        } catch (error) {
            console.error('Failed to connect wallet:', error);
            setPaymentMessage('❌ Failed to connect wallet. Please try again.', 'error');
            elements.payWithWalletBtn.disabled = false;
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">🔌</span> Connect Wallet & Pay';
            return;
        }
    }
    
    const x402 = currentCharge.x402_requirements || {};
    const railConfig = x402.rail_config || {};
    
    // Validate we have the required payment details
    if (!railConfig.pay_to_address) {
        setPaymentMessage('❌ No payment address available', 'error');
        return;
    }
    
    // Check if it's a Solana payment
    if (!railConfig.network?.includes('solana')) {
        setPaymentMessage('❌ Only Solana payments are supported in this demo', 'error');
        return;
    }
    
    elements.payWithWalletBtn.disabled = true;
    elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">⏳</span> Processing...';
    setPaymentMessage('🔄 Creating transaction...', 'info');
    
    try {
        // Use Solana Web3.js from the global scope
        const { Connection, PublicKey, Transaction, SystemProgram } = solanaWeb3;
        
        // Determine network
        const isMainnet = railConfig.network === 'solana-mainnet';
        const rpcUrl = isMainnet 
            ? 'https://api.mainnet-beta.solana.com'
            : 'https://api.devnet.solana.com';
        
        const connection = new Connection(rpcUrl, 'confirmed');
        
        // Parse addresses
        const fromPubkey = walletPublicKey;
        const toPubkey = new PublicKey(railConfig.pay_to_address);
        
        // Get the amount in smallest unit (USDC has 6 decimals)
        const amount = parseFloat(x402.amount || currentCharge.amount);
        const amountInSmallestUnit = Math.floor(amount * 1_000_000);
        
        setPaymentMessage(`🔄 Preparing ${amount} USDC transfer...`, 'info');
        
        // For USDC, we need to use SPL Token transfer
        // For demo simplicity, we'll create a native SOL transfer if USDC fails
        // In production, you'd use @solana/spl-token for USDC transfers
        
        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        
        // Create transaction
        const transaction = new Transaction({
            feePayer: fromPubkey,
            blockhash,
            lastValidBlockHeight
        });
        
        // Check if SPL Token library is available
        // The IIFE version exposes it as window.splToken
        const splTokenLib = window.splToken;
        
        console.log('SPL Token library check:', {
            'window.splToken': typeof window.splToken,
            'has getAssociatedTokenAddress': splTokenLib?.getAssociatedTokenAddress ? 'yes' : 'no',
            'has createTransferInstruction': splTokenLib?.createTransferInstruction ? 'yes' : 'no'
        });
        
        if (!splTokenLib || !splTokenLib.getAssociatedTokenAddress) {
            // Fallback: Use memo transaction if SPL Token not loaded
            console.warn('SPL Token library not loaded or incomplete, using memo transaction for demo');
            console.log('Available globals with "spl":', Object.keys(window).filter(k => k.toLowerCase().includes('spl')));
            const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
            const memoText = `Meshpay charge: ${currentCharge.id}, Amount: ${amount} ${currentCharge.currency}`;
            const memoData = new TextEncoder().encode(memoText);
            
            transaction.add({
                keys: [{ pubkey: fromPubkey, isSigner: true, isWritable: false }],
                programId: memoProgram,
                data: memoData
            });
        } else {
            console.log('Using SPL Token library for real USDC transfer');
            // Real USDC transfer using SPL Token
            const USDC_MINT = isMainnet 
                ? new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')  // Mainnet
                : new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // Devnet
            
            // Get token accounts
            const sourceTokenAccount = await splTokenLib.getAssociatedTokenAddress(
                USDC_MINT,
                fromPubkey,
                false
            );
            
            const destinationTokenAccount = await splTokenLib.getAssociatedTokenAddress(
                USDC_MINT,
                toPubkey,
                false
            );
            
            // Check if source account exists
            let sourceAccountInfo;
            try {
                sourceAccountInfo = await connection.getAccountInfo(sourceTokenAccount);
            } catch (e) {
                sourceAccountInfo = null;
            }
            
            // Create source token account if needed
            if (!sourceAccountInfo) {
                transaction.add(
                    splTokenLib.createAssociatedTokenAccountInstruction(
                        fromPubkey,
                        sourceTokenAccount,
                        fromPubkey,
                        USDC_MINT
                    )
                );
            }
            
            // Check if destination account exists
            let destAccountInfo;
            try {
                destAccountInfo = await connection.getAccountInfo(destinationTokenAccount);
            } catch (e) {
                destAccountInfo = null;
            }
            
            // Create destination token account if needed
            if (!destAccountInfo) {
                transaction.add(
                    splTokenLib.createAssociatedTokenAccountInstruction(
                        fromPubkey,
                        destinationTokenAccount,
                        toPubkey,
                        USDC_MINT
                    )
                );
            }
            
            // Add USDC transfer instruction
            transaction.add(
                splTokenLib.createTransferInstruction(
                    sourceTokenAccount,
                    destinationTokenAccount,
                    fromPubkey,
                    amountInSmallestUnit,
                    []
                )
            );
        }
        
        // Set payment message based on whether we're doing real USDC transfer or memo
        if (splTokenLib) {
            setPaymentMessage(`📝 Please approve the ${amount} USDC transfer in your wallet...`, 'info');
        } else {
            setPaymentMessage('📝 Please approve the transaction in your wallet (demo mode - memo transaction)...', 'info');
        }
        
        // Sign and send transaction
        const signedTransaction = await connectedWallet.signTransaction(transaction);
        
        setPaymentMessage('📤 Sending transaction to network...', 'info');
        
        const signature = await connection.sendRawTransaction(
            signedTransaction.serialize(),
            { skipPreflight: false, preflightCommitment: 'confirmed' }
        );
        
        setPaymentMessage(`⏳ Confirming transaction: ${signature.slice(0, 8)}...`, 'info');
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        if (confirmation.value.err) {
            throw new Error('Transaction failed on-chain');
        }
        
        // Transaction confirmed! Now notify the backend
        setPaymentMessage('✅ Transaction confirmed! Notifying backend...', 'success');
        
        // Call the facilitator confirm endpoint
        const confirmResponse = await fetch('/api/facilitator/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction_id: currentCharge.id,
                tx_hash: signature
            })
        });
        
        if (confirmResponse.ok) {
            const confirmResult = await confirmResponse.json();
            updatePaymentStatus('succeeded');
            setPaymentMessage(
                `🎉 Payment complete! TX: ${signature.slice(0, 20)}...`,
                'success'
            );
            
            // Disable all payment buttons
            elements.payWithWalletBtn.disabled = true;
            elements.startMonitorBtn.disabled = true;
            elements.simulatePaymentBtn.disabled = true;
            elements.checkStatusBtn.disabled = true;
            
            // Update charge with confirmed status
            currentCharge.status = 'succeeded';
            currentCharge.tx_hash = signature;
            
            // Wait a moment for database to update, then show verification section
            setTimeout(() => {
                showVerificationSection();
            }, 500);
        } else {
            setPaymentMessage(
                `⚠️ Payment sent but confirmation failed. TX: ${signature}`,
                'warning'
            );
        }
        
    } catch (error) {
        console.error('Payment error:', error);
        
        const errorMessage = error.message || String(error);
        const errorString = errorMessage.toLowerCase();
        
        // Check for user rejection
        if (errorString.includes('user rejected') || errorString.includes('user cancelled')) {
            setPaymentMessage('❌ Transaction cancelled by user', 'warning');
            
            // Cancel the transaction on the backend if we have a transaction ID
            if (currentCharge?.id) {
                try {
                    await cancelTransactionOnBackend(currentCharge.id);
                } catch (cancelError) {
                    console.error('Failed to cancel transaction on backend:', cancelError);
                    // Don't show error to user - cancellation is already handled in UI
                }
            }
        } 
        // Check for insufficient funds errors
        else if (errorString.includes('insufficient') || 
                 errorString.includes('no record of a prior credit') ||
                 errorString.includes('simulation failed')) {
            
            const x402 = currentCharge?.x402_requirements || {};
            const railConfig = x402.rail_config || {};
            const isMainnet = railConfig.network === 'solana-mainnet';
            
            if (isMainnet) {
                setPaymentMessage(
                    '❌ Insufficient funds in wallet. Please add SOL/USDC to your wallet.',
                    'error'
                );
            } else {
                // Devnet - provide helpful faucet link
                const walletAddress = walletPublicKey?.toBase58() || '';
                const shortAddress = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : '';
                setPaymentMessage(
                    `❌ Insufficient funds! Get free devnet SOL at https://faucet.solana.com/ ${shortAddress ? `(Wallet: ${shortAddress})` : ''}`,
                    'error'
                );
            }
        } 
        // Check for network/connection errors
        else if (errorString.includes('network') || errorString.includes('connection') || errorString.includes('timeout')) {
            setPaymentMessage('❌ Network error. Please check your connection and try again.', 'error');
        }
        // Generic error
        else {
            // Try to extract more details from Solana errors
            let detailedError = errorMessage;
            if (error.logs && Array.isArray(error.logs) && error.logs.length > 0) {
                detailedError += `\n\nLogs: ${error.logs.join('\n')}`;
            }
            setPaymentMessage(`❌ Payment failed: ${detailedError}`, 'error');
        }
    } finally {
        elements.payWithWalletBtn.disabled = !walletPublicKey || currentCharge?.status === 'succeeded';
        // Update button text based on wallet connection status
        if (walletPublicKey) {
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">💰</span> Pay with Wallet';
        } else {
            elements.payWithWalletBtn.innerHTML = '<span class="btn-icon">🔌</span> Connect Wallet & Pay';
        }
    }
}

// ==========================================================================
// Transaction Cancellation
// ==========================================================================

async function cancelTransactionOnBackend(transactionId) {
    /**
     * Cancel a transaction on the backend when user cancels from wallet.
     * This ensures the transaction status is updated to 'cancelled' in the database.
     */
    try {
        // Try to cancel via proxy endpoint (if available)
        const response = await fetch(`/api/billing/transactions/${transactionId}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('Transaction cancelled successfully:', result);
            return result;
        } else {
            // If proxy doesn't exist, try direct backend call (may fail without auth)
            console.warn('Cancel proxy endpoint not available, transaction may remain pending');
        }
    } catch (error) {
        console.error('Error cancelling transaction:', error);
        // Don't throw - cancellation is best-effort
    }
}

// ==========================================================================
// UI State Polling (Automatic payment status updates)
// ==========================================================================

/**
 * Start polling the UI state endpoint for automatic updates.
 * This is the Meshpay-owned mechanism that removes the need for
 * sellers to implement their own polling/refresh logic.
 * 
 * @param {string} transactionId - The transaction ID to poll
 * @param {function} onUpdate - Callback when state changes
 * @returns {number} The interval ID (for cleanup)
 */
function startUIStatePolling(transactionId, onUpdate) {
    // Clear any existing polling
    stopUIStatePolling();
    
    console.log('Starting UI state polling for:', transactionId);
    
    currentPollingInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/demo/charges/${transactionId}/ui-state`);
            
            if (!res.ok) {
                console.warn('UI state poll failed:', res.status);
                return;
            }
            
            const state = await res.json();
            console.log('UI state update:', state.status, state.verified, state.content_unlocked);
            
            // Call the update callback
            onUpdate(state);
            
            // Stop polling when we reach a terminal state
            if (state.status === 'succeeded' || state.status === 'failed') {
                console.log('Stopping polling - terminal state reached:', state.status);
                stopUIStatePolling();
            }
        } catch (error) {
            console.error('UI state polling error:', error);
        }
    }, 2500); // Poll every 2.5 seconds
    
    return currentPollingInterval;
}

/**
 * Stop UI state polling and clean up the interval.
 */
function stopUIStatePolling() {
    if (currentPollingInterval) {
        clearInterval(currentPollingInterval);
        currentPollingInterval = null;
        console.log('UI state polling stopped');
    }
}

/**
 * Handle UI state updates from polling.
 * This automatically updates the payment panel and shows content when verified.
 * 
 * @param {object} state - The UI state from the backend
 */
function handleUIStateUpdate(state) {
    // Update payment status display
    updatePaymentStatus(state.status);
    
    // Update the current charge state
    if (currentCharge) {
        currentCharge.status = state.status;
    }
    
    // If content is unlocked (payment verified), show the unlocked state
    if (state.content_unlocked) {
        // Show verification section with auto-verified result
        showVerificationSection();
        showVerificationResult('verified', {
            verified: true,
            status: state.status,
            transaction_id: state.transaction_id,
            amount: state.amount,
            currency: state.currency,
            content_unlocked: state.content_unlocked
        });
        
        // Show the content unlocked section
        showContentUnlocked(state);
        
        // Update payment message
        setPaymentMessage('🎉 Payment verified! Content is now unlocked.', 'success');
        
        // Disable payment buttons since we're done
        elements.payWithWalletBtn.disabled = true;
        elements.startMonitorBtn.disabled = true;
        elements.simulatePaymentBtn.disabled = true;
    } else if (state.status === 'succeeded' && !state.verified) {
        // Payment succeeded but verification failed (rare edge case)
        showVerificationSection();
        showVerificationResult('not-verified', {
            verified: false,
            reason: state.raw?.meshpay_verified_reason || 'verification_failed',
            detail: 'Payment succeeded but verification failed',
            ...state
        });
    } else if (state.status === 'failed') {
        // Payment failed
        setPaymentMessage('❌ Payment failed.', 'error');
        hideContentUnlocked();
    }
    // For 'pending' status, we just update the status display and keep polling
}

/**
 * Show the "Content Unlocked" section with fake paid content.
 * 
 * @param {object} state - The UI state
 */
function showContentUnlocked(state) {
    const section = document.getElementById('content-unlocked-section');
    if (section) {
        section.style.display = 'block';
        
        // Update the content details
        const amountEl = document.getElementById('unlocked-amount');
        const txnEl = document.getElementById('unlocked-txn-id');
        
        if (amountEl) amountEl.textContent = `${state.amount} ${state.currency}`;
        if (txnEl) txnEl.textContent = state.transaction_id;
    }
}

/**
 * Hide the "Content Unlocked" section.
 */
function hideContentUnlocked() {
    const section = document.getElementById('content-unlocked-section');
    if (section) {
        section.style.display = 'none';
    }
}

// ==========================================================================
// Payment Verification (Seller-side verification)
// ==========================================================================

function showVerificationSection() {
    if (elements.verificationSection) {
        elements.verificationSection.style.display = 'block';
        // Reset verification result
        elements.verificationResult.style.display = 'none';
        elements.verifyPaymentBtn.disabled = false;
        elements.verifyPaymentBtn.innerHTML = '<span class="btn-icon">✅</span> Verify Payment';
    }
}

function hideVerificationSection() {
    if (elements.verificationSection) {
        elements.verificationSection.style.display = 'none';
    }
}

async function verifyPayment() {
    if (!currentCharge) {
        showVerificationResult('error', 'No charge to verify');
        return;
    }
    
    // Check if payment was confirmed first
    if (currentCharge.status !== 'succeeded') {
        showVerificationResult('not-verified', {
            verified: false,
            reason: 'status_not_succeeded',
            detail: `Payment status is '${currentCharge.status}'. Please confirm the payment first (use "Simulate Payment" or "Pay with Wallet").`,
            current_status: currentCharge.status
        });
        return;
    }
    
    elements.verifyPaymentBtn.disabled = true;
    elements.verifyPaymentBtn.innerHTML = '<span class="btn-icon">⏳</span> Verifying...';
    
    try {
        // Build verification request with customer_ref if provided
        const verifyRequest = {
            transaction_id: currentCharge.id
        };
        
        // Include customer_ref if it was set in the original charge
        if (currentCharge.customer_ref) {
            verifyRequest.customer_ref = currentCharge.customer_ref;
        }
        
        // Include resource_ref if it was set
        if (currentCharge.resource_ref) {
            verifyRequest.resource_ref = currentCharge.resource_ref;
        }
        
        console.log('Verifying payment:', verifyRequest);
        
        const response = await fetch('/api/charges/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(verifyRequest)
        });
        
        const result = await response.json();
        
        console.log('Verification response:', response.status, result);
        
        if (response.ok && result.verified) {
            showVerificationResult('verified', result);
        } else if (response.status === 404) {
            // Provide more helpful error message
            const detail = result.detail || 'Transaction not found';
            let errorDetail = detail;
            
            // Check if it's an organization mismatch issue
            if (detail.includes('different organization') || detail.includes('API key')) {
                errorDetail = `${detail}\n\n💡 Tip: Make sure you're using the same API key (MESHPAY_API_KEY in .env) that was used to create this charge.`;
            } else {
                errorDetail = `${detail}\n\nMake sure:\n1. The payment was confirmed successfully\n2. You're using the same API key that created the charge\n3. The transaction ID is correct: ${currentCharge.id}`;
            }
            
            showVerificationResult('not-verified', {
                verified: false,
                reason: 'not_found',
                detail: errorDetail,
                transaction_id: currentCharge.id,
                ...result
            });
        } else if (response.status === 409) {
            showVerificationResult('not-verified', {
                verified: false,
                ...result
            });
        } else {
            showVerificationResult('error', result);
        }
        
    } catch (error) {
        console.error('Verification error:', error);
        showVerificationResult('error', {
            error: 'network_error',
            detail: error.message
        });
    } finally {
        elements.verifyPaymentBtn.disabled = false;
        elements.verifyPaymentBtn.innerHTML = '<span class="btn-icon">✅</span> Verify Payment';
    }
}

function showVerificationResult(status, data) {
    elements.verificationResult.style.display = 'block';
    
    let statusIcon, statusText, statusClass;
    
    switch (status) {
        case 'verified':
            statusIcon = '✅';
            statusText = 'Payment Verified - Seller can show content!';
            statusClass = 'verified';
            break;
        case 'not-verified':
            statusIcon = '❌';
            statusText = `Verification Failed: ${data.reason || 'Unknown reason'}`;
            statusClass = 'not-verified';
            break;
        case 'error':
            statusIcon = '⚠️';
            statusText = 'Verification Error';
            statusClass = 'error';
            break;
        default:
            statusIcon = '❓';
            statusText = 'Unknown Status';
            statusClass = '';
    }
    
    elements.verificationStatus.innerHTML = `${statusIcon} ${statusText}`;
    elements.verificationStatus.className = `verification-status ${statusClass}`;
    elements.verificationResponse.innerHTML = syntaxHighlightJSON(JSON.stringify(data, null, 2));
}

// ==========================================================================
// Initialize on DOM ready
// ==========================================================================

document.addEventListener('DOMContentLoaded', init);

