# Orvion x402 Mode Demo

This demo showcases the **native HTTP 402 Payment Required** flow, where:

1. Server returns HTTP 402 with payment requirements
2. Client connects wallet and pays directly on-page
3. Payment is verified on-chain, access granted

## Best For

- ✅ **API monetization** - Charge per-request without subscriptions
- ✅ **AI agents** - Programmatic handling of 402 responses
- ✅ **Custom wallet UX** - Build your own payment interface

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Install Orvion SDK (from source - required until PyPI release)
pip install -e ../../sdk/python

# 3. Configure environment
cp .env.example .env
# Edit .env and add your ORVION_API_KEY

# 4. Run the demo
python main.py
```

Then visit: **http://localhost:5001**

## How It Works

### Server Code (3 lines!)

```python
from orvion.fastapi import OrvionMiddleware, require_payment

app.add_middleware(OrvionMiddleware, api_key=os.environ["ORVION_API_KEY"])

@app.get("/api/premium")
@require_payment(amount="0.01", currency="USDC")
async def premium(request):
    return {"content": "Premium data!"}
```

### Payment Flow

```
┌─────────────┐     GET /api/premium      ┌─────────────┐
│   Client    │ ──────────────────────────▶│   Server    │
│  (Browser)  │                            │  (FastAPI)  │
└─────────────┘                            └─────────────┘
       │                                          │
       │◀──────── HTTP 402 + requirements ────────│
       │                                          │
       │  Connect Wallet, Send Payment            │
       │  (Solana USDC transfer)                  │
       ▼                                          │
┌─────────────┐                                   │
│   Solana    │                                   │
│   Network   │                                   │
└─────────────┘                                   │
       │                                          │
       │  Transaction confirmed                   │
       ▼                                          │
┌─────────────┐  GET /api/premium + tx_id  ┌─────────────┐
│   Client    │ ──────────────────────────▶│   Server    │
└─────────────┘                            └─────────────┘
       │                                          │
       │◀──────────── HTTP 200 + content ─────────│
```

## Files

```
x402-mode/
├── main.py           # FastAPI server with @require_payment
├── requirements.txt  # Python dependencies
├── .env.example      # Environment template
├── README.md         # This file
└── static/
    ├── index.html    # Demo UI
    ├── style.css     # Styling
    └── app.js        # Wallet connection & payment
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ORVION_API_KEY` | Your Orvion API key | Required |
| `BACKEND_URL` | Orvion backend URL | `http://localhost:8000` |

## Network & Verification

This demo uses **Solana Devnet** - no real money is transferred.

### Payment Verification

Payments are verified using the **Solana Community Facilitator**, which:
- Verifies transactions directly via Solana RPC
- Validates amount, recipient, and token (USDC)
- Extracts payer address from transaction
- No third-party API keys required

For faster transaction indexing, configure a premium RPC (Helius, QuickNode):

```env
# In docker/.env or backend/.env
SOLANA_DEVNET_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

### Get Devnet Tokens

- **SOL**: https://faucet.solana.com/
- **USDC**: Use the USDC devnet faucet or mint directly

## See Also

- [Hosted Checkout Demo](../hosted-checkout/) - Zero-code payment page
- [Orvion Documentation](https://docs.orvion.sh)
