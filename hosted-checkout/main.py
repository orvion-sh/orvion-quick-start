"""
Orvion Hosted Checkout Demo

This demo showcases the hosted checkout flow:
- Server redirects unpaid users to pay.orvion.sh
- User completes payment on Orvion's hosted page
- User is automatically redirected back to your app

Best for: Web applications, zero frontend integration

Usage:
    pip install -r requirements.txt
    cp .env.example .env  # Add your ORVION_API_KEY
    python main.py

Then visit: http://localhost:5002
"""

import os
import sys
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
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


# =============================================================================
# JSON Serialization Fix for Decimal Types
# =============================================================================

def _custom_jsonable_encoder(obj, **kwargs):
    """Custom JSON encoder that handles Decimal types."""
    # Use FastAPI's default encoder but add Decimal support
    custom_encoder = {Decimal: str}
    if "custom_encoder" in kwargs:
        kwargs["custom_encoder"].update(custom_encoder)
    else:
        kwargs["custom_encoder"] = custom_encoder
    return jsonable_encoder(obj, **kwargs)


# Patch FastAPI's jsonable_encoder to handle Decimal types globally
import fastapi.encoders
fastapi.encoders.jsonable_encoder = _custom_jsonable_encoder

# Create single client instance
orvion_client: Optional[OrvionClient] = None
if ORVION_API_KEY:
    orvion_client = OrvionClient(api_key=ORVION_API_KEY, base_url=BACKEND_URL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize Orvion client on startup."""
    global orvion_client

    if orvion_client:
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
    title="Orvion Hosted Checkout Demo",
    description="Hosted checkout payment flow demo",
    version="1.0.0",
    lifespan=lifespan,
)

# Add Orvion middleware and payment router
if orvion_client:
    app.add_middleware(OrvionMiddleware, client=orvion_client, register_on_first_request=False)
    app.include_router(create_payment_router(orvion_client), prefix="/api/payments", tags=["payments"])


# =============================================================================
# Protected Endpoint with Hosted Checkout
# =============================================================================

@app.get("/api/premium")
@require_payment(
    amount="0.001",  # Reduced for mainnet testing
    currency="USDC",
    name="Premium Content",
    description="Access to premium content",
    hosted_checkout=True,  # <-- This is all you need!
    # return_url is auto-derived: /api/premium → /premium
)
async def premium_api(request: Request):
    """
    Payment-protected endpoint using hosted checkout.

    Without payment: Redirects to pay.orvion.sh
    After payment: Returns the premium content
    """
    payment = getattr(request.state, "payment", None)

    return {
        "access": "granted",
        "message": "Welcome to premium content!",
        "mode": "hosted_checkout",
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
    return {"status": "healthy", "demo": "hosted-checkout"}


@app.get("/api/config")
async def get_config():
    return {"version": "1.0.0", "mode": "hosted_checkout"}


# =============================================================================
# Static Files & Pages
# =============================================================================

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    """Landing page"""
    return FileResponse("static/index.html")


@app.get("/premium")
async def serve_premium():
    """Premium content page (user lands here after payment)"""
    return FileResponse("static/premium.html")


# =============================================================================
# Run Server
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5002)
