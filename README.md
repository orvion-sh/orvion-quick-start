# Meshpay x402 Demo

A demo showcasing x402 payment-protected APIs using the Meshpay Python SDK. Features a `/premium` endpoint that requires payment via Phantom wallet on Solana devnet.

## Features

- **x402 Payment Flow** - Experience HTTP 402 Payment Required in action
- **Blur Paywall** - Premium content is blurred until payment is made
- **Phantom Wallet** - Pay with Solana devnet USDC via Phantom
- **Instant Verification** - Content unlocks automatically after payment

## Architecture

```
Browser (localhost:5001)
    │
    ├── GET /           → Landing page
    │
    └── GET /premium    → Premium article (payment-protected)
            │
            ├── GET /api/premium/check
            │       └── Returns 402 + charge info OR 200 + access granted
            │
            └── POST /api/premium/verify
                    └── Verifies payment and grants access
```

## Quick Start

### 1. Start the Backend

The demo requires the Meshpay backend running on port 8000:

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

### 2. Configure Environment

```bash
cd demo
cp .env.example .env
```

Edit `.env` with your API key:

```env
MESHPAY_API_KEY=your_api_key_here
BACKEND_URL=http://localhost:8000
DEMO_CUSTOMER_EMAIL=ekinburakozturk+demo@gmail.com
```

### 3. Start the Demo

```bash
cd demo
pip install -r requirements.txt
python main.py
```

### 4. Open the Demo

Navigate to [http://localhost:5001](http://localhost:5001)

1. Click **"Try Premium Content"** to go to the premium article
2. You'll see blurred content with a paywall overlay
3. Connect your Phantom wallet (Solana devnet)
4. Click **"Pay Now"** to make the $0.01 USDC payment
5. Content unlocks automatically after verification

## Demo Flow

### Landing Page (`/`)

Minimal page with:
- Meshpay logo and tagline
- "Try Premium Content" CTA button
- Demo account info

### Premium Page (`/premium`)

**Locked State:**
- Article content is blurred
- Paywall overlay shows price ($0.01 USDC)
- Phantom wallet connect button

**Unlocked State:**
- Full article content visible
- "Payment Verified" badge
- Technical details panel (collapsible)

## Getting Devnet SOL

This demo uses Solana devnet. To pay:

1. Install [Phantom Wallet](https://phantom.app/)
2. Switch to Devnet in Settings → Developer Settings
3. Get free SOL at [faucet.solana.com](https://faucet.solana.com/)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/premium` | GET | Premium article page |
| `/api/config` | GET | Public configuration |
| `/api/premium/check` | GET | Check access (returns 402 or 200) |
| `/api/premium/verify` | POST | Verify payment |
| `/api/facilitator/confirm` | POST | Confirm wallet payment |

## Files

```
demo/
├── main.py              # FastAPI server with SDK integration
├── requirements.txt     # Python dependencies
├── .env.example         # Environment template
├── static/
│   ├── index.html       # Landing page
│   ├── premium.html     # Premium article page
│   ├── premium.js       # Payment flow logic
│   └── style.css        # Light theme styles
└── README.md
```

## License

Internal tool - Meshpay
