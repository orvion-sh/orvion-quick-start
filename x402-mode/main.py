"""
Orvion x402 Mode Demo

This demo showcases the native HTTP 402 Payment Required flow:
- Server returns HTTP 402 with payment requirements
- Client connects wallet and pays directly on-page
- Payment is verified on-chain

Best for: API monetization, AI agents, custom wallet UX

Usage:
    pip install -r requirements.txt
    cp .env.example .env  # Add your ORVION_API_KEY
    python main.py

Then visit: http://localhost:5001
"""

import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Add SDK to path for local development (remove in production)
sdk_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "sdk", "python")
if sdk_path not in sys.path:
    sys.path.insert(0, sdk_path)

from orvion import OrvionClient
from orvion.fastapi import (
    OrvionMiddleware,
    create_payment_router,
    require_payment,
    sync_routes,
)

# Load environment variables
load_dotenv()

ORVION_API_KEY = os.getenv("ORVION_API_KEY", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

orvion_client: Optional[OrvionClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize Orvion client on startup."""
    global orvion_client

    if ORVION_API_KEY:
        orvion_client = OrvionClient(api_key=ORVION_API_KEY, base_url=BACKEND_URL)

        health = await orvion_client.health_check()
        if health.api_key_valid:
            print(f"✓ API Key verified - Organization: {health.organization_id}")
        else:
            print("⚠ API Key verification failed")

        try:
            registered_count = await sync_routes(app, orvion_client)
            print(f"✓ Registered {registered_count} protected route(s)")
        except Exception as e:
            print(f"⚠ Route registration failed: {e}")
    else:
        print("⚠ No ORVION_API_KEY set")

    yield

    if orvion_client:
        await orvion_client.close()


app = FastAPI(
    title="Orvion x402 Mode Demo",
    description="Native HTTP 402 payment flow demo",
    version="1.0.0",
    lifespan=lifespan,
)

# Add Orvion middleware
if ORVION_API_KEY:
    app.add_middleware(
        OrvionMiddleware,
        api_key=ORVION_API_KEY,
        base_url=BACKEND_URL,
        register_on_first_request=False,
    )

    # Add payment router for wallet payment confirmation
    _router_client = OrvionClient(api_key=ORVION_API_KEY, base_url=BACKEND_URL)
    app.include_router(
        create_payment_router(_router_client),
        prefix="/api/payments",
        tags=["payments"],
    )


# =============================================================================
# Protected Endpoint - The Star of the Show!
# =============================================================================

@app.get("/api/premium")
@require_payment(
    amount="0.01",
    currency="USDC",
    name="Premium Article",
    description="Access to premium article content",
)
async def premium_api(request: Request):
    """
    Payment-protected endpoint using x402 protocol.

    Without payment: Returns HTTP 402 with payment requirements
    With payment: Returns the premium content
    """
    payment = getattr(request.state, "payment", None)

    return {
        "access": "granted",
        "message": "Welcome to premium content!",
        "article": {
            "title": "The Future of Micropayments",
            "content": "Full article content here...",
        },
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


# =============================================================================
# Health & Config
# =============================================================================

@app.get("/health")
async def health():
    return {"status": "healthy", "demo": "x402-mode"}


@app.get("/api/config")
async def get_config():
    return {"version": "1.0.0", "mode": "x402"}


# =============================================================================
# Static Files
# =============================================================================

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


# =============================================================================
# Run Server
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
