# Orvion Payment Demos

Orvion enables x402 payment-protected APIs with Solana payments. These demos showcase two integration patterns for adding payments to your application.

## Quickstart

```bash
git clone https://github.com/orvion-sh/quick-start.git
cd quick-start/x402-mode
cp .env.example .env
# Edit .env with your API key from orvion.sh/dashboard
pip install -r requirements.txt
python main.py
```

Then visit `http://localhost:5001` and test the payment flow!

## Demo Options

| Demo | Description | Best For | Port |
|------|-------------|----------|------|
| [**x402-mode/**](./x402-mode/) | Native HTTP 402 protocol | APIs, AI agents, custom UX | 5001 |
| [**hosted-checkout/**](./hosted-checkout/) | Redirect to pay.orvion.sh | Web apps, quick integration | 5002 |

### x402 Mode (Native Protocol)
```
Client → Server → HTTP 402 + requirements
Client → Connects wallet, sends payment on-chain
Client → Server → Retry with tx_id → Access granted
```
- ✅ Full control over payment UX
- ✅ AI agents can handle programmatically
- ✅ Best for API monetization

### Hosted Checkout
```
Client → Server → Redirect to pay.orvion.sh
User → Completes payment on hosted page
pay.orvion.sh → Redirects back to your app
```
- ✅ Zero wallet integration code
- ✅ Orvion handles all payment UI
- ✅ Best for web applications

## Setup Instructions

### 1. Create an Orvion Account

1. Go to [orvion.sh/dashboard](https://orvion.sh/dashboard)
2. Sign up for a free account
3. Create an API key in your dashboard
4. Copy the API key

### 2. Configure the Demo

```bash
# Choose a demo
cd x402-mode          # or hosted-checkout

# Copy environment template
cp .env.example .env

# Edit .env and add your API key
# ORVION_API_KEY=your_api_key_here
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- FastAPI and Uvicorn (web framework)
- The Orvion SDK (`orvion>=0.2.0,<1.0.0`) from PyPI

### 4. Run the Demo

```bash
python main.py
```

- x402-mode runs on `http://localhost:5001`
- hosted-checkout runs on `http://localhost:5002`

### 5. Get Devnet Funds

Both demos use **Solana Devnet** - no real money is transferred.

Get free devnet SOL/USDC at: [faucet.solana.com](https://faucet.solana.com/)

## Server-Side Code

Both demos use the same `@require_payment` decorator - just one parameter different!

```python
from orvion.fastapi import OrvionMiddleware, require_payment

# Add middleware (same for both)
app.add_middleware(OrvionMiddleware, api_key=os.environ["ORVION_API_KEY"])

# x402 Mode (default)
@app.get("/api/premium")
@require_payment(amount="0.01", currency="USDC")
async def premium(request):
    return {"content": "Premium!"}

# Hosted Checkout Mode
@app.get("/api/premium")
@require_payment(amount="0.01", currency="USDC", hosted_checkout=True)
async def premium(request):
    return {"content": "Premium!"}
```

## Documentation

- [Orvion Docs](https://docs.orvion.sh)
- [Python SDK Documentation](https://docs.orvion.sh/sdk/python)
- [API Reference](https://docs.orvion.sh/api)

## License

MIT
