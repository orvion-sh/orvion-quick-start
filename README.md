# Orvion Payment Demos

This folder contains two standalone demos showcasing different payment flows with the Orvion SDK.

## Demo Options

| Demo | Description | Best For | Port |
|------|-------------|----------|------|
| [**x402-mode/**](./x402-mode/) | Native HTTP 402 protocol | APIs, AI agents, custom UX | 5001 |
| [**hosted-checkout/**](./hosted-checkout/) | Redirect to pay.orvion.sh | Web apps, quick integration | 5002 |

## Quick Comparison

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

## Running the Demos

### Prerequisites
- Python 3.9+
- [Phantom Wallet](https://phantom.app/) (for x402 mode)
- Free devnet SOL from [faucet.solana.com](https://faucet.solana.com/)

### x402 Mode Demo
```bash
cd x402-mode
pip install -r requirements.txt
pip install -e ../../sdk/python  # Install SDK from source (required until PyPI release)
cp .env.example .env             # Add your ORVION_API_KEY
python main.py                   # http://localhost:5001
```

### Hosted Checkout Demo
```bash
cd hosted-checkout
pip install -r requirements.txt
pip install -e ../../sdk/python  # Install SDK from source (required until PyPI release)
cp .env.example .env             # Add your ORVION_API_KEY
python main.py                   # http://localhost:5002
```

> **Note:** The Orvion SDK is not yet published to PyPI. You must install it from source using `pip install -e ../../sdk/python`. Once published, you'll be able to use `pip install orvion`.

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

## Network

Both demos use **Solana Devnet** - no real money is transferred.

Get free devnet SOL/USDC at: https://faucet.solana.com/

## Documentation

- [Orvion Docs](https://docs.orvion.sh)
- [Python SDK](../../sdk/python/)
- [Node.js SDK](../../sdk/nodejs/)


Each Demo is Self-Contained

Users can download just one folder and run it:

x402 Mode (Port 5001):

    cd x402-mode
    pip install -r requirements.txt
    pip install -e ../../sdk/python  # Install from source (required)
    cp .env.example .env
    python main.py

Hosted Checkout (Port 5002):

    cd hosted-checkout
    pip install -r requirements.txt
    pip install -e ../../sdk/python  # Install from source (required)
    cp .env.example .env
    python main.py
