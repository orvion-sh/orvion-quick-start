# Orvion Hosted Checkout Demo

This demo showcases the **hosted checkout** flow, where:

1. Server redirects unpaid users to pay.orvion.sh
2. User completes payment on Orvion's hosted page
3. User is automatically redirected back to your app

## Best For

- ✅ **Web applications** - No wallet UI to build
- ✅ **Quick integration** - Just add one parameter
- ✅ **Zero frontend code** - Orvion handles everything

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env and add your ORVION_API_KEY from orvion.sh/dashboard

# 3. Run the demo
python main.py
```

Then visit: **http://localhost:5002**

## How It Works

### Server Code (Just add `hosted_checkout=True`!)

```python
from orvion.fastapi import OrvionMiddleware, require_payment

app.add_middleware(OrvionMiddleware, api_key=os.environ["ORVION_API_KEY"])

@app.get("/api/premium")
@require_payment(
    amount="0.01",
    currency="USDC",
    hosted_checkout=True,  # <-- This is all you need!
)
async def premium(request):
    return {"content": "Premium data!"}
```

### Payment Flow

```
┌─────────────┐     GET /api/premium      ┌─────────────┐
│    User     │ ──────────────────────────▶│   Server    │
│  (Browser)  │                            │  (FastAPI)  │
└─────────────┘                            └─────────────┘
       │                                          │
       │◀─────── 302 Redirect to pay.orvion.sh ───│
       │                                          │
       ▼                                          │
┌─────────────┐                                   │
│ pay.orvion  │  User connects wallet             │
│    .sh      │  and completes payment            │
└─────────────┘                                   │
       │                                          │
       │  302 Redirect back to /premium?charge_id=xxx
       ▼                                          │
┌─────────────┐                                   │
│    User     │  Lands on success page            │
│  (Browser)  │  with unlocked content            │
└─────────────┘                                   │
```

### Automatic URL Convention

The SDK automatically derives the return URL:
- `/api/premium` → redirects back to `/premium`
- `/api/content` → redirects back to `/content`

Just create a frontend page at the derived path!

## Files

```
hosted-checkout/
├── main.py           # FastAPI server with hosted_checkout=True
├── requirements.txt  # Python dependencies
├── .env.example      # Environment template
├── README.md         # This file
└── static/
    ├── index.html    # Landing page
    ├── premium.html  # Success page (user lands here after payment)
    └── style.css     # Styling
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ORVION_API_KEY` | Your Orvion API key | Required |
| `BACKEND_URL` | Orvion backend URL | `http://localhost:8000` |

## Network

This demo uses **Solana Devnet** - no real money is transferred.

Get free devnet SOL at: https://faucet.solana.com/

## See Also

- [x402 Mode Demo](../x402-mode/) - Native HTTP 402 flow
- [Orvion Documentation](https://docs.orvion.sh)
