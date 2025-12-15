/**
 * Orvion x402 Mode Demo - Payment Flow
 * 
 * Handles wallet connection and on-page payment for the x402 protocol flow.
 */

// =============================================================================
// SPL Token Constants and Helpers (inline to avoid CDN dependency issues)
// =============================================================================

const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/**
 * Derives the associated token account address for a wallet and token mint
 */
async function getAssociatedTokenAddress(mint, owner) {
    const [address] = await solanaWeb3.PublicKey.findProgramAddress(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return address;
}

/**
 * Creates an instruction to create an associated token account
 */
function createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint) {
    const SYSVAR_RENT_PUBKEY = new solanaWeb3.PublicKey('SysvarRent111111111111111111111111111111111');
    const keys = [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: associatedToken, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];
    return new solanaWeb3.TransactionInstruction({
        keys,
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        data: new Uint8Array(0), // Use Uint8Array instead of Buffer for browser compatibility
    });
}

/**
 * Creates an instruction to transfer SPL tokens
 */
function createTransferInstruction(source, destination, owner, amount) {
    const keys = [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
    ];
    // Use Uint8Array instead of Buffer for better browser compatibility
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer instruction = 3
    // Write amount as little-endian 64-bit integer
    const amountBigInt = BigInt(amount);
    for (let i = 0; i < 8; i++) {
        data[1 + i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xff));
    }
    return new solanaWeb3.TransactionInstruction({
        keys,
        programId: TOKEN_PROGRAM_ID,
        data,
    });
}

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
    txHash: document.getElementById('tx-hash'),
    txHashRow: document.getElementById('tx-hash-row'),
    txHashLink: document.getElementById('tx-hash-link'),
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
    
    // Code tab switching
    document.querySelectorAll('.code-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const lang = tab.dataset.lang;
            
            // Update tabs
            document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update panels
            document.querySelectorAll('.code-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${lang}-code`)?.classList.add('active');
        });
    });
}

// =============================================================================
// Payment Verification
// =============================================================================

async function checkExistingPayment() {
    // Check URL params for returning from payment
    const urlParams = new URLSearchParams(window.location.search);
    const chargeId = urlParams.get('charge_id');
    const status = urlParams.get('status');
    const txHash = urlParams.get('tx_hash');
    const amount = urlParams.get('amount');
    
    if (chargeId && status === 'succeeded') {
        sessionStorage.setItem('premium_txn_id', chargeId);
        if (txHash) sessionStorage.setItem('premium_tx_hash', txHash);
        if (amount) sessionStorage.setItem('premium_amount', amount);
        window.history.replaceState({}, document.title, '/');
        showUnlockedState({ 
            transaction_id: chargeId, 
            amount: amount || '0.01',
            tx_hash: txHash 
        });
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
                // Include stored tx_hash if available
                data.tx_hash = data.tx_hash || sessionStorage.getItem('premium_tx_hash');
                showUnlockedState(data);
                return;
            } else {
                sessionStorage.removeItem('premium_txn_id');
                sessionStorage.removeItem('premium_tx_hash');
                sessionStorage.removeItem('premium_amount');
            }
        } catch (error) {
            console.error('Failed to verify stored transaction:', error);
            sessionStorage.removeItem('premium_txn_id');
            sessionStorage.removeItem('premium_tx_hash');
            sessionStorage.removeItem('premium_amount');
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
    
    // Display TX hash if available
    const txHash = data.tx_hash || sessionStorage.getItem('premium_tx_hash');
    if (txHash && elements.txHash) {
        const shortHash = txHash.length > 20 ? txHash.slice(0, 8) + '...' + txHash.slice(-8) : txHash;
        elements.txHash.textContent = shortHash;
        if (elements.txHashLink) {
            elements.txHashLink.href = `https://solscan.io/tx/${txHash}?cluster=devnet`;
            elements.txHashLink.style.display = 'inline';
        }
        if (elements.txHashRow) elements.txHashRow.style.display = 'list-item';
    } else if (elements.txHashRow) {
        elements.txHashRow.style.display = 'none';
    }
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
        
        // Official USDC on Solana devnet (Circle)
        const tokenMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
        
        setPaymentStatus('Checking wallet balance...', 'info');
        
        // Check if wallet has enough SOL for transaction fees
        const solBalance = await connection.getBalance(fromAddress);
        const minSolForFees = 0.01 * solanaWeb3.LAMPORTS_PER_SOL; // ~0.01 SOL for fees
        if (solBalance < minSolForFees) {
            setPaymentStatus('Not enough SOL for transaction fees. Get devnet SOL from faucet.solana.com', 'error');
            elements.payBtn.disabled = false;
            elements.payBtnText.textContent = walletPublicKey ? 'Pay Now' : 'Connect Wallet & Pay';
            return;
        }
        
        // Get/create token accounts using inline helpers
        const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress);
        const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toAddress);
        
        // Check if sender's token account exists
        const fromAccountInfo = await connection.getAccountInfo(fromTokenAccount);
        if (!fromAccountInfo) {
            setPaymentStatus('No USDC found in wallet. Get devnet USDC from a faucet first.', 'error');
            elements.payBtn.disabled = false;
            elements.payBtnText.textContent = walletPublicKey ? 'Pay Now' : 'Connect Wallet & Pay';
            return;
        }
        
        // Check if recipient token account exists
        const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
        
        const transaction = new Transaction();
        
        // Create recipient token account if needed
        if (!toAccountInfo) {
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    fromAddress, toTokenAccount, toAddress, tokenMint
                )
            );
        }
        
        // Add transfer instruction (0.01 USDC = 10000 micro-units with 6 decimals)
        const amount = Math.round(parseFloat(currentCharge.amount) * 1_000_000);
        
        setPaymentStatus('Please approve in your wallet...', 'info');
        transaction.add(
            createTransferInstruction(
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
                transaction_id: currentCharge.charge_id,
                tx_hash: signature,
            }),
        });
        
        if (!confirmResponse.ok) {
            throw new Error('Payment confirmation failed');
        }
        
        const confirmData = await confirmResponse.json();
        
        // Store transaction ID
        const transactionId = confirmData.transaction_id || currentCharge.charge_id;
        sessionStorage.setItem('premium_txn_id', transactionId);
        sessionStorage.setItem('premium_tx_hash', signature);
        sessionStorage.setItem('premium_amount', currentCharge.amount);
        
        setPaymentStatus('Payment successful! Redirecting...', 'success');
        
        // Redirect to premium page with payment details
        const premiumUrl = new URL('/premium', window.location.origin);
        premiumUrl.searchParams.set('charge_id', transactionId);
        premiumUrl.searchParams.set('tx_hash', signature);
        premiumUrl.searchParams.set('amount', currentCharge.amount);
        premiumUrl.searchParams.set('status', 'succeeded');
        
        currentCharge = null;
        
        // Short delay to show success message, then redirect
        setTimeout(() => {
            window.location.href = premiumUrl.toString();
        }, 1000);
        
    } catch (error) {
        console.error('Payment failed:', error);
        
        // Parse common Phantom/Solana wallet errors
        let errorMessage = 'Payment failed';
        const errorString = error?.message || error?.toString() || '';
        
        if (errorString.includes('User rejected') || errorString.includes('user rejected')) {
            errorMessage = 'Transaction cancelled by user';
        } else if (errorString.includes('insufficient') || errorString.includes('Insufficient')) {
            errorMessage = 'Insufficient funds. Make sure you have enough SOL for fees and USDC for payment.';
        } else if (errorString.includes('0x1') || errorString.includes('InsufficientFunds')) {
            errorMessage = 'Insufficient token balance. Get devnet USDC from a faucet.';
        } else if (errorString.includes('Unexpected error')) {
            // This is often a simulation failure or wallet internal error
            errorMessage = 'Transaction failed. Please ensure you have:\n• Devnet SOL for fees (get from faucet.solana.com)\n• Devnet USDC (for payment)';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        setPaymentStatus(errorMessage, 'error');
        elements.payBtn.disabled = false;
        elements.payBtnText.textContent = walletPublicKey ? 'Pay Now' : 'Connect Wallet & Pay';
    }
}

// =============================================================================
// Initialize on DOM ready
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
