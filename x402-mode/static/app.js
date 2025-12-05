/**
 * Orvion x402 Mode Demo - Payment Flow
 * 
 * Handles wallet connection and on-page payment for the x402 protocol flow.
 */

// =============================================================================
// State
// =============================================================================

let currentCharge = null;
let walletPublicKey = null;
let connectedWallet = null;

// =============================================================================
// DOM Elements
// =============================================================================

const elements = {
    priceAmount: document.getElementById('price-amount'),
    priceCurrency: document.getElementById('price-currency'),
    payBtn: document.getElementById('pay-btn'),
    payBtnText: document.getElementById('pay-btn-text'),
    paymentStatus: document.getElementById('payment-status'),
    successBanner: document.getElementById('success-banner'),
    unlockedContent: document.getElementById('unlocked-content'),
    demoCard: document.getElementById('demo-card'),
    txnId: document.getElementById('txn-id'),
    paidAmount: document.getElementById('paid-amount'),
    walletDisconnected: document.getElementById('wallet-disconnected'),
    walletConnected: document.getElementById('wallet-connected'),
    connectWalletBtn: document.getElementById('connect-wallet-btn'),
    disconnectWalletBtn: document.getElementById('disconnect-wallet-btn'),
    walletAddress: document.getElementById('wallet-address'),
};

// =============================================================================
// Initialization
// =============================================================================

async function init() {
    setupEventListeners();
    checkWalletConnection();
    await checkExistingPayment();
}

function setupEventListeners() {
    elements.payBtn?.addEventListener('click', handlePayment);
    elements.connectWalletBtn?.addEventListener('click', connectPhantomWallet);
    elements.disconnectWalletBtn?.addEventListener('click', disconnectWallet);
}

// =============================================================================
// Payment Verification
// =============================================================================

async function checkExistingPayment() {
    // Check URL params for returning from payment
    const urlParams = new URLSearchParams(window.location.search);
    const chargeId = urlParams.get('charge_id');
    const status = urlParams.get('status');
    
    if (chargeId && status === 'succeeded') {
        sessionStorage.setItem('premium_txn_id', chargeId);
        window.history.replaceState({}, document.title, '/');
        showUnlockedState({ transaction_id: chargeId, amount: '0.01' });
        return;
    }
    
    // Check stored transaction
    const storedTxnId = sessionStorage.getItem('premium_txn_id');
    if (storedTxnId) {
        try {
            const response = await fetch('/api/premium', {
                headers: { 'X-Transaction-Id': storedTxnId }
            });
            const data = await response.json();
            
            if (response.status === 200 && data.access === 'granted') {
                showUnlockedState(data);
                return;
            } else {
                sessionStorage.removeItem('premium_txn_id');
            }
        } catch (error) {
            console.error('Failed to verify stored transaction:', error);
            sessionStorage.removeItem('premium_txn_id');
        }
    }
    
    showLockedState();
}

// =============================================================================
// UI State Management
// =============================================================================

function showLockedState() {
    if (elements.demoCard) elements.demoCard.style.display = 'block';
    if (elements.successBanner) elements.successBanner.classList.add('hidden');
    if (elements.unlockedContent) elements.unlockedContent.style.display = 'none';
    updatePayButtonState();
}

function showUnlockedState(data) {
    if (elements.demoCard) elements.demoCard.style.display = 'none';
    if (elements.successBanner) elements.successBanner.classList.remove('hidden');
    if (elements.unlockedContent) elements.unlockedContent.style.display = 'block';
    if (elements.txnId) elements.txnId.textContent = data.transaction_id || data.payment?.transaction_id || '-';
    if (elements.paidAmount) elements.paidAmount.textContent = data.amount || data.payment?.amount || '0.01';
}

function setPaymentStatus(message, type = 'info') {
    if (!elements.paymentStatus) return;
    elements.paymentStatus.textContent = message;
    elements.paymentStatus.className = `payment-status-box ${type}`;
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

// =============================================================================
// Wallet Connection
// =============================================================================

function getPhantomProvider() {
    if ('phantom' in window) {
        const provider = window.phantom?.solana;
        if (provider?.isPhantom) return provider;
    }
    return null;
}

function checkWalletConnection() {
    const provider = getPhantomProvider();
    
    if (!provider) {
        if (elements.connectWalletBtn) {
            elements.connectWalletBtn.innerHTML = '⬇️ Install Phantom';
            elements.connectWalletBtn.onclick = () => window.open('https://phantom.app/', '_blank');
        }
        return;
    }
    
    provider.on('connect', (publicKey) => updateWalletUI(publicKey));
    provider.on('disconnect', () => updateWalletUI(null));
    provider.on('accountChanged', (publicKey) => updateWalletUI(publicKey));
    
    if (provider.isConnected && provider.publicKey) {
        updateWalletUI(provider.publicKey);
    }
}

async function connectPhantomWallet() {
    const provider = getPhantomProvider();
    if (!provider) {
        window.open('https://phantom.app/', '_blank');
        return false;
    }
    
    try {
        if (elements.connectWalletBtn) {
            elements.connectWalletBtn.disabled = true;
            elements.connectWalletBtn.textContent = 'Connecting...';
        }
        
        const resp = await provider.connect();
        walletPublicKey = resp.publicKey;
        connectedWallet = provider;
        updateWalletUI(walletPublicKey);
        return true;
    } catch (error) {
        console.error('Failed to connect wallet:', error);
        if (elements.connectWalletBtn) {
            elements.connectWalletBtn.disabled = false;
            elements.connectWalletBtn.innerHTML = '<img src="https://phantom.app/img/phantom-icon-purple.svg" alt="Phantom" class="wallet-icon" onerror="this.style.display=\'none\'"> Connect Wallet';
        }
        return false;
    }
}

async function disconnectWallet() {
    const provider = getPhantomProvider();
    if (provider) {
        await provider.disconnect();
    }
    walletPublicKey = null;
    connectedWallet = null;
    updateWalletUI(null);
}

function updateWalletUI(publicKey) {
    walletPublicKey = publicKey;
    
    if (publicKey) {
        const address = publicKey.toBase58();
        const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
        
        if (elements.walletDisconnected) elements.walletDisconnected.style.display = 'none';
        if (elements.walletConnected) elements.walletConnected.style.display = 'flex';
        if (elements.walletAddress) elements.walletAddress.textContent = shortAddress;
    } else {
        if (elements.walletDisconnected) elements.walletDisconnected.style.display = 'block';
        if (elements.walletConnected) elements.walletConnected.style.display = 'none';
    }
    
    updatePayButtonState();
}

// =============================================================================
// Payment Flow
// =============================================================================

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
    
    // Create charge if needed
    if (!currentCharge) {
        setPaymentStatus('Creating payment...', 'info');
        elements.payBtn.disabled = true;
        
        const chargeCreated = await createCharge();
        if (!chargeCreated) {
            elements.payBtn.disabled = false;
            return;
        }
    }
    
    await processPayment();
}

async function createCharge() {
    try {
        const response = await fetch('/api/premium');
        const data = await response.json();
        
        if (response.status === 200 && data.access === 'granted') {
            sessionStorage.setItem('premium_txn_id', data.payment?.transaction_id);
            showUnlockedState(data);
            setPaymentStatus('', '');
            return false;
        }
        
        if (response.status === 402) {
            currentCharge = data;
            return true;
        }
        
        setPaymentStatus(data.error || 'Failed to create charge', 'error');
        return false;
    } catch (error) {
        console.error('Failed to create charge:', error);
        setPaymentStatus('Failed to create charge', 'error');
        return false;
    }
}

async function processPayment() {
    const x402 = currentCharge.x402_requirements || {};
    const railConfig = x402.rail_config || {};
    
    if (!railConfig.pay_to_address) {
        setPaymentStatus('No payment address available', 'error');
        return;
    }
    
    elements.payBtn.disabled = true;
    elements.payBtnText.textContent = 'Processing...';
    setPaymentStatus('Creating transaction...', 'info');
    
    try {
        const { Connection, PublicKey, Transaction } = solanaWeb3;
        
        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const toAddress = new PublicKey(railConfig.pay_to_address);
        const fromAddress = walletPublicKey;
        
        // USDC on devnet
        const tokenMint = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
        
        setPaymentStatus('Please approve in your wallet...', 'info');
        
        // Get/create token accounts
        const fromTokenAccount = await splToken.getAssociatedTokenAddress(tokenMint, fromAddress);
        const toTokenAccount = await splToken.getAssociatedTokenAddress(tokenMint, toAddress);
        
        // Check if recipient token account exists
        const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
        
        const transaction = new Transaction();
        
        // Create recipient token account if needed
        if (!toAccountInfo) {
            transaction.add(
                splToken.createAssociatedTokenAccountInstruction(
                    fromAddress, toTokenAccount, toAddress, tokenMint
                )
            );
        }
        
        // Add transfer instruction (0.01 USDC = 10000 micro-units with 6 decimals)
        const amount = Math.round(parseFloat(currentCharge.amount) * 1_000_000);
        transaction.add(
            splToken.createTransferInstruction(
                fromTokenAccount, toTokenAccount, fromAddress, amount
            )
        );
        
        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromAddress;
        
        // Sign and send
        setPaymentStatus('Signing transaction...', 'info');
        const signed = await connectedWallet.signTransaction(transaction);
        
        setPaymentStatus('Sending to network...', 'info');
        const signature = await connection.sendRawTransaction(signed.serialize());
        
        setPaymentStatus('Confirming on-chain...', 'info');
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');
        
        // Confirm payment with backend
        setPaymentStatus('Verifying payment...', 'info');
        const confirmResponse = await fetch('/api/payments/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                charge_id: currentCharge.charge_id,
                transaction_hash: signature,
            }),
        });
        
        if (!confirmResponse.ok) {
            throw new Error('Payment confirmation failed');
        }
        
        const confirmData = await confirmResponse.json();
        
        // Store and show success
        sessionStorage.setItem('premium_txn_id', confirmData.transaction_id || currentCharge.charge_id);
        showUnlockedState({
            transaction_id: confirmData.transaction_id || currentCharge.charge_id,
            amount: currentCharge.amount,
        });
        setPaymentStatus('Payment successful!', 'success');
        currentCharge = null;
        
    } catch (error) {
        console.error('Payment failed:', error);
        setPaymentStatus(error.message || 'Payment failed', 'error');
        elements.payBtn.disabled = false;
        elements.payBtnText.textContent = walletPublicKey ? 'Pay Now' : 'Connect Wallet & Pay';
    }
}

// =============================================================================
// Initialize on DOM ready
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
