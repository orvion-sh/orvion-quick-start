/**
 * Meshpay Premium Content - Payment Flow
 * 
 * Handles:
 * - Checking premium access status
 * - Wallet connection (Phantom)
 * - Solana devnet USDC payment
 * - Payment verification
 * - UI state management
 */

// ==========================================================================
// State
// ==========================================================================

let currentCharge = null;
let walletPublicKey = null;
let connectedWallet = null;
let config = {};
let pollingInterval = null;

// ==========================================================================
// DOM Elements
// ==========================================================================

const elements = {
    demoEmail: document.getElementById('demo-email'),
    articleContent: document.getElementById('article-content'),
    paywallOverlay: document.getElementById('paywall-overlay'),
    priceAmount: document.getElementById('price-amount'),
    priceCurrency: document.getElementById('price-currency'),
    payBtn: document.getElementById('pay-btn'),
    payBtnText: document.getElementById('pay-btn-text'),
    paymentStatus: document.getElementById('payment-status'),
    unlockedBadge: document.getElementById('unlocked-badge'),
    // Code panel elements
    techDetails: document.getElementById('tech-details'),
    response402: document.getElementById('response-402'),
    response200: document.getElementById('response-200'),
    // Wallet elements
    walletDisconnected: document.getElementById('wallet-disconnected'),
    walletConnected: document.getElementById('wallet-connected'),
    connectWalletBtn: document.getElementById('connect-wallet-btn'),
    disconnectWalletBtn: document.getElementById('disconnect-wallet-btn'),
    walletAddress: document.getElementById('wallet-address'),
};

// ==========================================================================
// Initialization
// ==========================================================================

async function init() {
    await loadConfig();
    setupEventListeners();
    checkWalletConnection();
    await checkPremiumAccess();
}

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        config = await response.json();
        
        if (elements.demoEmail) {
            elements.demoEmail.textContent = config.demo_email || 'demo@meshpay.com';
        }
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

function setupEventListeners() {
    elements.payBtn?.addEventListener('click', handlePayment);
    elements.connectWalletBtn?.addEventListener('click', connectPhantomWallet);
    elements.disconnectWalletBtn?.addEventListener('click', disconnectWallet);
}

// ==========================================================================
// Premium Access Check
// ==========================================================================

async function checkPremiumAccess() {
    // Check if we have a stored transaction ID
    const storedTxnId = sessionStorage.getItem('premium_txn_id');
    
    const headers = {};
    if (storedTxnId) {
        headers['X-Transaction-Id'] = storedTxnId;
    }
    
    try {
        const response = await fetch('/api/premium/check', { headers });
        const data = await response.json();
        
        if (response.status === 200 && data.access === 'granted') {
            // Access granted - show content
            showUnlockedState(data);
        } else if (response.status === 402) {
            // Payment required - show paywall
            currentCharge = data;
            showLockedState(data);
        } else {
            // Error
            console.error('Unexpected response:', data);
            showError('Failed to check access status');
        }
    } catch (error) {
        console.error('Failed to check premium access:', error);
        showError('Connection error. Please try again.');
    }
}

// ==========================================================================
// UI State Management
// ==========================================================================

function showLockedState(chargeData) {
    // Show paywall overlay
    elements.paywallOverlay.style.display = 'flex';
    elements.unlockedBadge.style.display = 'none';
    
    // Blur article content
    elements.articleContent.classList.add('blurred');
    
    // Update price display
    const amount = chargeData.amount || config.premium_amount || '0.01';
    const currency = chargeData.currency || config.premium_currency || 'USDC';
    elements.priceAmount.textContent = `$${amount}`;
    elements.priceCurrency.textContent = currency;
    
    // Update 402 response in code panel
    if (elements.response402) {
        const response402 = {
            error: "Payment Required",
            amount: amount,
            currency: currency,
            x402_requirements: chargeData.x402_requirements ? "{ ... }" : null
        };
        elements.response402.textContent = JSON.stringify(response402, null, 2);
    }
    
    // Update button state based on wallet
    updatePayButtonState();
}

function showUnlockedState(data) {
    // Hide paywall
    elements.paywallOverlay.style.display = 'none';
    
    // Remove blur from content
    elements.articleContent.classList.remove('blurred');
    
    // Show unlocked badge
    elements.unlockedBadge.style.display = 'flex';
    
    // Update 200 response in code panel
    if (elements.response200) {
        const response200 = {
            verified: true,
            transaction_id: data.transaction_id || "...",
            amount: data.amount || "0.01"
        };
        elements.response200.textContent = JSON.stringify(response200, null, 2);
    }
    
    // Open tech details section to show success
    if (elements.techDetails) {
        elements.techDetails.open = true;
    }
    
    // Stop any polling
    stopPolling();
}

function showError(message) {
    setPaymentStatus(message, 'error');
}

function setPaymentStatus(message, type = 'info') {
    if (!elements.paymentStatus) return;
    
    elements.paymentStatus.textContent = message;
    elements.paymentStatus.className = `payment-status ${type}`;
    elements.paymentStatus.style.display = message ? 'block' : 'none';
}

function updatePayButtonState() {
    if (!elements.payBtn || !elements.payBtnText) return;
    
    if (walletPublicKey) {
        elements.payBtnText.textContent = 'Pay Now';
        elements.payBtn.classList.add('wallet-connected');
    } else {
        elements.payBtnText.textContent = 'Connect Wallet & Pay';
        elements.payBtn.classList.remove('wallet-connected');
    }
}

// ==========================================================================
// Wallet Connection
// ==========================================================================

function getPhantomProvider() {
    if ('phantom' in window) {
        const provider = window.phantom?.solana;
        if (provider?.isPhantom) {
            return provider;
        }
    }
    return null;
}

function checkWalletConnection() {
    const provider = getPhantomProvider();
    
    if (!provider) {
        if (elements.connectWalletBtn) {
            elements.connectWalletBtn.innerHTML = '⬇️ Install Phantom';
            elements.connectWalletBtn.onclick = () => {
                window.open('https://phantom.app/', '_blank');
            };
        }
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
            updateWalletUI(publicKey);
        } else {
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
        elements.connectWalletBtn.disabled = true;
        elements.connectWalletBtn.textContent = 'Connecting...';
        
        const resp = await provider.connect();
        walletPublicKey = resp.publicKey;
        connectedWallet = provider;
        
        updateWalletUI(walletPublicKey);
        console.log('Connected to Phantom:', walletPublicKey.toBase58());
        
        return true;
    } catch (err) {
        console.error('Failed to connect wallet:', err);
        elements.connectWalletBtn.disabled = false;
        elements.connectWalletBtn.innerHTML = `
            <img src="https://phantom.app/img/phantom-icon-purple.svg" alt="Phantom" class="wallet-icon" onerror="this.style.display='none'">
            Connect Wallet
        `;
        return false;
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
        
        // Truncate address
        const address = publicKey.toBase58();
        const truncated = address.slice(0, 4) + '...' + address.slice(-4);
        elements.walletAddress.textContent = truncated;
        elements.walletAddress.title = address;
    } else {
        walletPublicKey = null;
        connectedWallet = null;
        
        // Show disconnected state
        elements.walletDisconnected.style.display = 'flex';
        elements.walletConnected.style.display = 'none';
        
        // Reset button
        if (elements.connectWalletBtn) {
            elements.connectWalletBtn.disabled = false;
            elements.connectWalletBtn.innerHTML = `
                <img src="https://phantom.app/img/phantom-icon-purple.svg" alt="Phantom" class="wallet-icon" onerror="this.style.display='none'">
                Connect Wallet
            `;
        }
    }
    
    updatePayButtonState();
}

// ==========================================================================
// Payment Flow
// ==========================================================================

async function handlePayment() {
    // Connect wallet if not connected
    if (!walletPublicKey || !connectedWallet) {
        setPaymentStatus('Connecting wallet...', 'info');
        elements.payBtn.disabled = true;
        
        const connected = await connectPhantomWallet();
        if (!connected) {
            setPaymentStatus('Wallet connection cancelled', 'error');
            elements.payBtn.disabled = false;
            return;
        }
    }
    
    if (!currentCharge) {
        setPaymentStatus('No charge available. Refreshing...', 'info');
        await checkPremiumAccess();
        return;
    }
    
    await processPayment();
}

async function processPayment() {
    const x402 = currentCharge.x402_requirements || {};
    const railConfig = x402.rail_config || {};
    
    if (!railConfig.pay_to_address) {
        setPaymentStatus('No payment address available', 'error');
        return;
    }
    
    if (!railConfig.network?.includes('solana')) {
        setPaymentStatus('Only Solana payments supported', 'error');
        return;
    }
    
    elements.payBtn.disabled = true;
    elements.payBtnText.textContent = 'Processing...';
    setPaymentStatus('Creating transaction...', 'info');
    
    try {
        const { Connection, PublicKey, Transaction } = solanaWeb3;
        
        // Determine network (always devnet for demo)
        const isMainnet = railConfig.network === 'solana-mainnet';
        const rpcUrl = isMainnet 
            ? 'https://api.mainnet-beta.solana.com'
            : 'https://api.devnet.solana.com';
        
        const connection = new Connection(rpcUrl, 'confirmed');
        
        const fromPubkey = walletPublicKey;
        const toPubkey = new PublicKey(railConfig.pay_to_address);
        
        const amount = parseFloat(x402.amount || currentCharge.amount);
        const amountInSmallestUnit = Math.floor(amount * 1_000_000);
        
        setPaymentStatus(`Preparing ${amount} USDC transfer...`, 'info');
        
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        
        const transaction = new Transaction({
            feePayer: fromPubkey,
            blockhash,
            lastValidBlockHeight
        });
        
        const splTokenLib = window.splToken;
        
        if (!splTokenLib || !splTokenLib.getAssociatedTokenAddress) {
            // Fallback: memo transaction for demo
            console.warn('SPL Token not loaded, using memo transaction');
            const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
            const memoText = `Meshpay: ${currentCharge.charge_id}, Amount: ${amount} USDC`;
            const memoData = new TextEncoder().encode(memoText);
            
            transaction.add({
                keys: [{ pubkey: fromPubkey, isSigner: true, isWritable: false }],
                programId: memoProgram,
                data: memoData
            });
        } else {
            // Real USDC transfer
            const USDC_MINT = isMainnet 
                ? new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
                : new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
            
            const sourceTokenAccount = await splTokenLib.getAssociatedTokenAddress(
                USDC_MINT, fromPubkey, false
            );
            
            const destinationTokenAccount = await splTokenLib.getAssociatedTokenAddress(
                USDC_MINT, toPubkey, false
            );
            
            // Check/create token accounts
            let sourceAccountInfo = await connection.getAccountInfo(sourceTokenAccount).catch(() => null);
            if (!sourceAccountInfo) {
                transaction.add(
                    splTokenLib.createAssociatedTokenAccountInstruction(
                        fromPubkey, sourceTokenAccount, fromPubkey, USDC_MINT
                    )
                );
            }
            
            let destAccountInfo = await connection.getAccountInfo(destinationTokenAccount).catch(() => null);
            if (!destAccountInfo) {
                transaction.add(
                    splTokenLib.createAssociatedTokenAccountInstruction(
                        fromPubkey, destinationTokenAccount, toPubkey, USDC_MINT
                    )
                );
            }
            
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
        
        setPaymentStatus('Please approve in your wallet...', 'info');
        
        const signedTransaction = await connectedWallet.signTransaction(transaction);
        
        setPaymentStatus('Sending transaction...', 'info');
        
        const signature = await connection.sendRawTransaction(
            signedTransaction.serialize(),
            { skipPreflight: false, preflightCommitment: 'confirmed' }
        );
        
        setPaymentStatus(`Confirming: ${signature.slice(0, 8)}...`, 'info');
        
        const confirmation = await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        if (confirmation.value.err) {
            throw new Error('Transaction failed on-chain');
        }
        
        setPaymentStatus('Transaction confirmed! Waiting for RPC to index...', 'success');
        
        // Wait a moment for RPC to index the transaction before verification
        // This helps avoid "transaction not found" errors
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        setPaymentStatus('Transaction confirmed! Verifying...', 'success');
        
        // Validate charge_id exists - check both charge_id and id fields
        const transactionId = currentCharge?.charge_id || currentCharge?.id;
        if (!currentCharge || !transactionId) {
            console.error('Missing charge_id or id:', currentCharge);
            setPaymentStatus('Error: Missing charge ID. Please refresh and try again.', 'error');
            return;
        }
        
        // Validate signature exists
        if (!signature || typeof signature !== 'string' || signature.length === 0) {
            console.error('Invalid signature:', signature);
            setPaymentStatus('Error: Invalid transaction signature.', 'error');
            return;
        }
        
        // Notify backend
        const requestBody = {
            transaction_id: String(transactionId),
            tx_hash: String(signature)
        };
        
        let confirmResponse;
        try {
            confirmResponse = await fetch('/api/facilitator/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
        } catch (fetchError) {
            console.error('Fetch error:', fetchError);
            setPaymentStatus(`Network error: ${fetchError.message}`, 'error');
            return;
        }
        
        if (confirmResponse.ok) {
            // Store transaction ID for future visits
            sessionStorage.setItem('premium_txn_id', transactionId);
            
            // Start polling for verification
            startPolling(transactionId);
        } else {
            // Log error for debugging
            try {
                const errorData = await confirmResponse.clone().json();
                console.error('Confirm payment error:', errorData);
            } catch (e) {
                console.error('Confirm payment error:', await confirmResponse.clone().text());
            }
            setPaymentStatus(`Payment sent! Waiting for verification...`, 'info');
            startPolling(transactionId);
        }
        
    } catch (error) {
        console.error('Payment error:', error);
        handlePaymentError(error);
    } finally {
        elements.payBtn.disabled = false;
        updatePayButtonState();
    }
}

function handlePaymentError(error) {
    const errorMessage = error.message || String(error);
    const errorString = errorMessage.toLowerCase();
    
    if (errorString.includes('user rejected') || errorString.includes('user cancelled')) {
        setPaymentStatus('Transaction cancelled', 'error');
    } else if (errorString.includes('insufficient') || errorString.includes('no record')) {
        setPaymentStatus('Insufficient funds. Get devnet SOL at faucet.solana.com', 'error');
    } else if (errorString.includes('network') || errorString.includes('timeout')) {
        setPaymentStatus('Network error. Please try again.', 'error');
    } else {
        setPaymentStatus(`Payment failed: ${errorMessage}`, 'error');
    }
}

// ==========================================================================
// Polling for Payment Verification
// ==========================================================================

function startPolling(transactionId) {
    stopPolling();
    
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60 seconds max
    
    pollingInterval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
            stopPolling();
            setPaymentStatus('Verification timeout. Please refresh.', 'error');
            return;
        }
        
        try {
            const response = await fetch(`/api/demo/charges/${transactionId}/ui-state`);
            
            if (!response.ok) return;
            
            const state = await response.json();
            
            if (state.content_unlocked) {
                stopPolling();
                sessionStorage.setItem('premium_txn_id', transactionId);
                showUnlockedState({
                    transaction_id: state.transaction_id,
                    amount: state.amount,
                    currency: state.currency,
                    verified: true,
                    customer_ref: config.demo_email,
                });
                setPaymentStatus('', '');
            } else if (state.status === 'failed') {
                stopPolling();
                setPaymentStatus('Payment verification failed', 'error');
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, 2000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// ==========================================================================
// Initialize
// ==========================================================================

document.addEventListener('DOMContentLoaded', init);
