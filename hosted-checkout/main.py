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
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, RedirectResponse
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
# Option 1: Simple Protected Route (No Routing Flow)
# =============================================================================

@app.get("/api/premium")
@require_payment(
    amount="0.001",
    currency="USDC",
    name="Premium Content",
    description="Access to premium content - simple charge",
    hosted_checkout=True,
    # No routing flow - uses default receiver config directly
)
async def premium_api(request: Request):
    """
    Simple payment-protected endpoint.
    
    - Uses default receiver config for payment
    - Does NOT execute routing flow
    - Good for: Simple single-price endpoints
    """
    payment = getattr(request.state, "payment", None)

    return {
        "access": "granted",
        "message": "Welcome to premium content!",
        "mode": "simple_charge",
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


# =============================================================================
# Option 2: Protected Route with Routing Flow
# =============================================================================

@app.get("/api/flow")
@require_payment(
    amount="0.0015",
    currency="USDC",
    name="Flow-Routed Content",
    description="Access to content - uses routing flow for payment config",
    hosted_checkout=True,
    # This triggers routing flow with 'api_request_entry' node
)
async def flow_api(request: Request):
    """
    Payment-protected endpoint that uses ROUTING FLOW.
    
    - Executes active routing flow with 'api_request_entry' node
    - Routing flow determines: receiver config, conditions, etc.
    - Good for: Dynamic pricing, A/B testing, conditional routing
    """
    payment = getattr(request.state, "payment", None)

    return {
        "access": "granted",
        "message": "Welcome! Payment was routed through your flow.",
        "mode": "routing_flow",
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


# =============================================================================
# List Protected Routes (for dropdown)
# =============================================================================

@app.get("/api/routes")
async def list_routes():
    """
    List all protected routes from Orvion.
    Used by the demo UI to show available routes with their amounts.
    """
    if not orvion_client:
        return {"routes": [], "error": "Orvion client not configured"}
    
    try:
        # Fetch protected routes from Orvion API
        routes = await orvion_client._request("GET", "/v1/protected-routes/routes")
        
        # Return simplified route list
        result = []
        for route in routes if isinstance(routes, list) else []:
            result.append({
                "id": route.get("id"),
                "route_pattern": route.get("route_pattern"),
                "method": route.get("method"),
                "amount": route.get("amount"),
                "currency": route.get("currency"),
                "name": route.get("name"),
                "description": route.get("description"),
                "status": route.get("status", "active"),
                "receiver_config_id": route.get("receiver_config_id"),
            })
        
        return {"routes": result}
    except Exception as e:
        return {"routes": [], "error": str(e)}


# =============================================================================
# Checkout with Protected Route
# =============================================================================

@app.get("/api/checkout")
async def checkout_with_route(
    request: Request,
    route_id: str,
):
    """
    Create a charge using a protected route and redirect to checkout.
    
    Query params:
    - route_id: The protected route ID (e.g., 'route_abc123')
    
    The route's amount, currency, and receiver_config_id are used automatically.
    """
    if not orvion_client:
        raise HTTPException(status_code=500, detail="Orvion client not configured")
    
    try:
        # Fetch the route to get its amount, currency, and receiver_config_id
        routes = await orvion_client._request("GET", "/v1/protected-routes/routes")
        
        # Find the route by ID
        route = None
        if isinstance(routes, list):
            route = next((r for r in routes if r.get("id") == route_id), None)
        
        if not route:
            raise HTTPException(
                status_code=404,
                detail=f"Protected route '{route_id}' not found"
            )
        
        # Check if route is active
        route_status = route.get("status", "active")
        if route_status != "active":
            raise HTTPException(
                status_code=400,
                detail=f"Protected route '{route_id}' is not active (status: {route_status})"
            )
        
        # Extract route configuration
        amount = route.get("amount")
        currency = route.get("currency", "USDC")
        receiver_config_id = route.get("receiver_config_id")
        
        if not amount:
            raise HTTPException(
                status_code=400,
                detail=f"Protected route '{route_id}' has no amount configured"
            )
        
        # Build return URL
        base_url = str(request.base_url).rstrip("/")
        return_url = f"{base_url}/premium"
        
        # Create charge payload
        charge_payload = {
            "amount": str(amount),
            "currency": currency,
            "customer_ref": "demo-user",
            "return_url": return_url,
        }
        
        # Add receiver_config_id if the route has one
        if receiver_config_id:
            charge_payload["receiver_config_id"] = receiver_config_id
        
        # Create charge
        charge = await orvion_client._request(
            "POST",
            "/v1/charges",
            json=charge_payload
        )
        
        checkout_url = charge.get("checkout_url")
        if not checkout_url:
            raise HTTPException(
                status_code=500,
                detail="No checkout URL returned. Check route configuration."
            )
        
        # Redirect to checkout
        return RedirectResponse(url=checkout_url, status_code=302)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create charge: {str(e)}")


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
    """Success page after /api/premium payment"""
    return FileResponse("static/premium.html")


@app.get("/flow")
async def serve_flow_success():
    """Success page after /api/flow payment"""
    return FileResponse("static/premium.html")


# =============================================================================
# Run Server
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5002)
