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

/**
 * Creates a checked transfer instruction (includes mint and decimals)
 */
function createTransferCheckedInstruction(source, mint, destination, owner, amount, decimals) {
    const keys = [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
    ];
    // Instruction layout: u8 instruction (12), u64 amount, u8 decimals
    const data = new Uint8Array(1 + 8 + 1);
    data[0] = 12; // TransferChecked
    const amountBigInt = BigInt(amount);
    for (let i = 0; i < 8; i++) {
        data[1 + i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xff));
    }
    data[9] = decimals;

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
    if ('phantom' in window && window.phantom?.solana?.isPhantom) {
        return window.phantom.solana;
    }
    if ('solana' in window && window.solana?.isPhantom) {
        return window.solana;
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
    // Check if we already have a charge
    if (!currentCharge) {
        elements.payBtnText.textContent = 'Creating charge...';
        setPaymentStatus('Creating payment charge...', 'info');

        const chargeCreated = await createCharge();
        if (!chargeCreated) {
            elements.payBtn.disabled = false;
            elements.payBtnText.textContent = 'Pay Now';
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

// Solana Constants (allow overrides from window for custom RPC and limits)
const SOLANA_DEVNET_RPC =
    (typeof window !== 'undefined' && (window.PAYAI_SOLANA_RPC_URL || window.SOLANA_RPC_URL)) ||
    'https://api.devnet.solana.com';
const MAX_PAYMENT_AMOUNT_USDC =
    typeof window !== 'undefined' && window.PAYAI_MAX_PAYMENT_USDC
        ? parseFloat(window.PAYAI_MAX_PAYMENT_USDC)
        : null; // e.g., set window.PAYAI_MAX_PAYMENT_USDC = 0.05 to cap payments
const USDC_DEVNET_MINT = new solanaWeb3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

async function processPayment() {
    const x402 = currentCharge.x402_requirements || {};
    const railConfig = x402.rail_config || {};
    const feePayerAddress =
        // Manual override (e.g., facilitator-provided fee payer)
        (typeof window !== 'undefined' && window.PAYAI_FEE_PAYER) ||
        // Try top-level extra if the backend included it
        (x402.extra && (x402.extra.feePayer || x402.extra.fee_payer)) ||
        // Try rail_config.extra
        (railConfig.extra && (railConfig.extra.feePayer || railConfig.extra.fee_payer)) ||
        null;

    if (!walletPublicKey || !connectedWallet) {
        setPaymentStatus('Connecting wallet...', 'info');
        elements.payBtn.disabled = true;
        const connected = await connectPhantomWallet();
        if (!connected) {
            setPaymentStatus('Wallet connection required', 'error');
            elements.payBtn.disabled = false;
            elements.payBtnText.textContent = 'Pay Now';
            return;
        }
    }

    elements.payBtn.disabled = true;
    elements.payBtnText.textContent = 'Processing...';
    setPaymentStatus('Building transaction...', 'info');

    try {
        const connection = new solanaWeb3.Connection(SOLANA_DEVNET_RPC, 'confirmed');
        const merchantAddress = new solanaWeb3.PublicKey(railConfig.pay_to_address);
        const feePayerKey = feePayerAddress ? new solanaWeb3.PublicKey(feePayerAddress) : walletPublicKey;
        const amount = parseFloat(currentCharge.amount);
        if (MAX_PAYMENT_AMOUNT_USDC !== null && amount > MAX_PAYMENT_AMOUNT_USDC) {
            throw new Error(`Payment exceeds allowed maximum (${MAX_PAYMENT_AMOUNT_USDC} USDC)`);
        }
        const usdcAmount = Math.floor(amount * 1000000); // 6 decimals

        // 1. Get/Derive ATAs
        setPaymentStatus('Deriving token accounts...', 'info');
        const sourceATA = await getAssociatedTokenAddress(USDC_DEVNET_MINT, walletPublicKey);
        const destATA = await getAssociatedTokenAddress(USDC_DEVNET_MINT, merchantAddress);

        // Pre-Flight Check: Ensure Source has Account
        const sourceAccount = await connection.getAccountInfo(sourceATA);
        if (!sourceAccount) {
            throw new Error('Your wallet has no USDC (Devnet) account. Please get Devnet USDC first.');
        }

        // 2. Build Versioned Transaction with required compute budget + checked transfer
        const instructions = [];

        // Compute budget tweaks (helps facilitator verification expectations)
        instructions.push(
            solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
        );
        instructions.push(
            solanaWeb3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })
        );

        // Check Destination Account - Create if missing
        const destAccount = await connection.getAccountInfo(destATA);
        if (!destAccount) {
            throw new Error('Merchant USDC associated token account is missing. Please ask the merchant to create their USDC ATA first.');
        }

        // Add TransferChecked Instruction (instruction 12, includes decimals)
        instructions.push(
            createTransferCheckedInstruction(
                sourceATA,
                USDC_DEVNET_MINT,
                destATA,
                walletPublicKey,
                usdcAmount,
                6 // USDC decimals
            )
        );

        // Compile to v0 message and VersionedTransaction
        const { blockhash } = await connection.getLatestBlockhash();
        const messageV0 = new solanaWeb3.TransactionMessage({
            payerKey: feePayerKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const transaction = new solanaWeb3.VersionedTransaction(messageV0);

        setPaymentStatus('Please sign the transaction in your wallet...', 'info');

        // 3. Sign
        const signedTx = await connectedWallet.signTransaction(transaction);

        // 4. Serialize (VersionedTransaction)
        const serializedTx = signedTx.serialize();
        const txBase64 = Buffer.from(serializedTx).toString('base64'); // PayAI expects base64-encoded partial transaction
        const txBase58 = bs58.encode(serializedTx); // Keep for debugging/backward compatibility if needed

        setPaymentStatus('Verifying payment with facilitator...', 'info');

        // 5. Send Payload
        // We wrap it in a structure that our backend will wrap into "payload" object.
        // Backend wrapper: if dict, wraps it.
        const paymentPayload = {
            transaction: txBase64,
            encoding: 'base64',
            legacyTransaction: txBase58, // Optional helper field; backend will prefer base64
        };

        const processResponse = await fetch('/api/payments/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction_id: currentCharge.charge_id,
                payment_signature: JSON.stringify(paymentPayload),
            }),
        });

        if (!processResponse.ok) {
            const errorData = await processResponse.json();
            throw new Error(errorData.error || 'Payment failed');
        }

        const processData = await processResponse.json();
        // ... rest of success handling handled by existing code?
        // Wait, I am replacing the function, so I need to include success handling.

        if (processData.status === 'succeeded' || processData.tx_hash) {
            setPaymentStatus('Payment Confirmed!', 'success');
            sessionStorage.setItem('premium_txn_id', processData.id);
            location.reload();
        } else {
            setPaymentStatus('Payment submitted but not confirmed yet.', 'warning');
        }

    } catch (error) {
        console.error('Payment Error:', error);
        setPaymentStatus(`Payment failed: ${error.message}`, 'error');
        elements.payBtn.disabled = false;
        elements.payBtnText.textContent = 'Pay Now';
    }
}





// Helper function for demo delays
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Initialize on DOM ready
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
