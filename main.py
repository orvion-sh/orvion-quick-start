"""
Meshpay x402 Demo - Payment-Protected Content

A demo server showcasing x402 payment-protected APIs using the Meshpay Python SDK.
Features a /premium endpoint that requires payment via Phantom wallet on Solana devnet.

This demo showcases two approaches:
1. @require_payment decorator (recommended) - Auto-registers routes, handles 402 flow
2. Manual charge creation - For custom payment flows
"""

import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Header
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# Add SDK to path for local development
sdk_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sdk", "python")
if sdk_path not in sys.path:
    sys.path.insert(0, sdk_path)

from orvion import OrvionClient, OrvionAPIError
from orvion.fastapi import OrvionMiddleware, require_payment, sync_routes

# Load environment variables
load_dotenv()

ORVION_API_KEY = os.getenv("ORVION_API_KEY") or os.getenv("MESHPAY_API_KEY") or ""
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
DEMO_CUSTOMER_EMAIL = os.getenv("DEMO_CUSTOMER_EMAIL", "ekinburakozturk+demo@gmail.com")

# Premium content configuration (used by manual approach)
PREMIUM_AMOUNT = "0.01"
PREMIUM_CURRENCY = "USDC"
PREMIUM_RESOURCE_REF = "demo:premium-article"

# Initialize Orvion client (global for manual routes)
orvion_client: Optional[OrvionClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown."""
    global orvion_client
    
    # Startup
    if ORVION_API_KEY:
        orvion_client = OrvionClient(
            api_key=ORVION_API_KEY,
            base_url=BACKEND_URL,
        )
        
        # Verify API key organization before registering routes
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                health_response = await client.get(
                    f"{BACKEND_URL}/v1/health",
                    headers={"Authorization": f"Bearer {ORVION_API_KEY}"},
                )
                if health_response.status_code == 200:
                    health_data = health_response.json()
                    org_id = health_data.get("organization_id")
                    print(f"✓ API Key verified - Organization ID: {org_id}")
                    print(f"  Make sure this matches your dashboard organization!")
                else:
                    print(f"⚠ API Key verification failed: HTTP {health_response.status_code}")
        except Exception as e:
            print(f"⚠ Could not verify API key: {e}")
        
        # Register all protected routes on startup
        try:
            registered_count = await sync_routes(app, orvion_client)
            if registered_count > 0:
                print(f"✓ Registered {registered_count} protected route(s) on startup")
                print(f"  Check your dashboard to see the routes!")
            else:
                print("⚠ No routes were registered. Check that endpoints have @require_payment decorator.")
        except Exception as e:
            print(f"⚠ Error: Failed to register routes on startup: {e}")
            print(f"  Error type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            print("  Routes will still be registered on first request")
    
    yield
    
    # Shutdown
    if orvion_client:
        await orvion_client.close()


app = FastAPI(
    title="Meshpay x402 Demo",
    description="Demo for x402 payment-protected APIs",
    version="2.0.0",
    lifespan=lifespan,
)

# Add Orvion middleware for @require_payment decorator support
# Set register_on_first_request=False since we're registering in lifespan
if ORVION_API_KEY:
    app.add_middleware(
        OrvionMiddleware,
        api_key=ORVION_API_KEY,
        base_url=BACKEND_URL,
        register_on_first_request=False,  # Already registered in lifespan
    )


# ==========================================================================
# Health & Config Endpoints
# ==========================================================================

@app.get("/health")
async def health():
    """Demo server health check"""
    return {"status": "healthy", "service": "meshpay-x402-demo"}


@app.get("/api/config")
async def get_config():
    """Returns public configuration (no secrets)."""
    return {
        "backend_url": BACKEND_URL,
        "demo_email": DEMO_CUSTOMER_EMAIL,
        "premium_amount": PREMIUM_AMOUNT,
        "premium_currency": PREMIUM_CURRENCY,
    }


@app.get("/api/test-connection")
async def test_connection():
    """Test connectivity and API key validity."""
    result = {
        "demo_server": "ok",
        "backend": {
            "reachable": False,
            "health_status": None,
            "api_key_valid": None,
        }
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            health_response = await client.get(f"{BACKEND_URL}/health")
            result["backend"]["reachable"] = True
            result["backend"]["health_status"] = health_response.status_code
            
            if health_response.status_code != 200:
                result["backend"]["error"] = f"Health check returned {health_response.status_code}"
                return JSONResponse(content=result, status_code=200)
                
        except httpx.ConnectError:
            result["backend"]["error"] = "Connection refused - Is backend running on port 8000?"
            return JSONResponse(content=result, status_code=200)
        except httpx.TimeoutException:
            result["backend"]["error"] = "Connection timeout - Backend not responding"
            return JSONResponse(content=result, status_code=200)
        except Exception as e:
            result["backend"]["error"] = f"Connection error: {str(e)}"
            return JSONResponse(content=result, status_code=200)
        
        # Test API key and get organization info
        try:
            headers = {
                "Authorization": f"Bearer {ORVION_API_KEY}",
                "Content-Type": "application/json",
            }
            
            # Use the health endpoint which requires API key and returns org info
            health_response = await client.get(
                f"{BACKEND_URL}/v1/health",
                headers=headers,
            )
            
            if health_response.status_code == 200:
                health_data = health_response.json()
                result["backend"]["api_key_valid"] = True
                result["backend"]["organization_id"] = health_data.get("organization_id")
                result["backend"]["environment"] = health_data.get("environment")
            elif health_response.status_code == 401:
                result["backend"]["api_key_valid"] = False
                result["backend"]["error"] = "401 Unauthorized - Check ORVION_API_KEY in .env"
            else:
                result["backend"]["api_key_valid"] = None
                result["backend"]["error"] = f"Unexpected status {health_response.status_code}"
                
        except Exception as e:
            result["backend"]["api_key_valid"] = None
            result["backend"]["api_key_error"] = f"Could not verify API key: {str(e)}"
    
    return JSONResponse(content=result, status_code=200)


# ==========================================================================
# Premium Content Endpoints (x402 Protected)
# ==========================================================================

@app.get("/premium")
async def premium_page():
    """Serve the premium content page (handles payment state client-side)."""
    return FileResponse("static/premium.html")


# --------------------------------------------------------------------------
# NEW: Decorator-based approach (recommended)
# --------------------------------------------------------------------------
# Path (/api/premium) and method (GET) are automatically inferred from the route.
# The route is auto-registered in Meshpay on first access.
# Dashboard configuration takes precedence after initial registration.

@app.get("/api/premium")
@require_payment(
    amount="0.01",
    currency="USDC",
    name="Premium Article Demo",
    description="Demo premium article access",
)
async def premium_api(request: Request):
    """
    Premium content endpoint using @require_payment decorator.
    
    This endpoint automatically:
    - Auto-registers the route in Meshpay (first request only)
    - Returns 402 with charge info if no payment
    - Verifies payment and grants access if X-Transaction-Id header present
    - Attaches payment info to request.state.payment
    """
    # Access payment info from request.state
    payment = getattr(request.state, "payment", None)
    
    return {
        "access": "granted",
        "message": "Welcome to premium content!",
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


# --------------------------------------------------------------------------
# NEW: Hosted Checkout approach (redirect to pay.orvion.sh)
# --------------------------------------------------------------------------
# Instead of returning 402, this approach redirects unpaid users to Orvion's
# hosted checkout page. After payment, users are redirected back to this page.

@app.get("/premium-hosted")
async def premium_hosted_page():
    """Serve the hosted checkout premium content page."""
    return FileResponse("static/premium-hosted.html")


@app.get("/api/premium/hosted")
@require_payment(
    amount="0.01",
    currency="USDC",
    name="Premium Article Demo",
    description="Demo premium article access",
    hosted_checkout=True,  # Redirect to pay.orvion.sh instead of returning 402
    return_url="http://localhost:5001/premium",  # Redirect back to premium page after payment
)
async def premium_hosted_api(request: Request):
    """
    Premium content endpoint using hosted checkout mode.
    Redirects to pay.orvion.sh for payment, then back to /premium page.
    
    This endpoint automatically:
    - Auto-registers the route in Orvion (first request only)
    - Redirects to pay.orvion.sh if no payment
    - After payment, user is redirected back to /premium with ?charge_id=xxx
    - Verifies payment and grants access
    - Attaches payment info to request.state.payment
    
    Note: This endpoint will redirect to pay.orvion.sh if no payment is found.
    The redirect happens automatically via the decorator.
    """
    # Access payment info from request.state
    payment = getattr(request.state, "payment", None)
    
    # If payment is verified, redirect to premium page with success
    if payment:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(
            url=f"/premium?charge_id={payment.transaction_id}&status=succeeded",
            status_code=302
        )
    
    # This shouldn't be reached if hosted_checkout=True is working correctly
    # The decorator should redirect to pay.orvion.sh before reaching here
    # But fallback in case something goes wrong
    return {
        "access": "granted",
        "message": "Welcome to hosted checkout premium content!",
        "mode": "hosted_checkout",
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


@app.get("/api/premium-hosted")
@require_payment(
    amount="0.01",
    currency="USDC",
    name="Premium Hosted Demo",
    description="Demo premium content with hosted checkout",
    hosted_checkout=True,  # Redirect to pay.orvion.sh instead of returning 402
)
async def premium_hosted_api(request: Request):
    """
    Premium content endpoint using hosted checkout mode.
    
    This endpoint automatically:
    - Auto-registers the route in Orvion (first request only)
    - Redirects to pay.orvion.sh if no payment
    - After payment, user is redirected back with ?charge_id=xxx
    - Verifies payment and grants access
    - Attaches payment info to request.state.payment
    """
    # Access payment info from request.state
    payment = getattr(request.state, "payment", None)
    
    return {
        "access": "granted",
        "message": "Welcome to hosted checkout premium content!",
        "mode": "hosted_checkout",
        "payment": {
            "transaction_id": payment.transaction_id if payment else None,
            "amount": payment.amount if payment else None,
            "currency": payment.currency if payment else None,
        } if payment else None,
    }


# --------------------------------------------------------------------------
# Manual approach (for custom flows or backward compatibility)
# --------------------------------------------------------------------------

@app.get("/api/premium/check")
async def check_premium_access(
    request: Request,
    x_transaction_id: Optional[str] = Header(None, alias="X-Transaction-Id"),
    charge_id: Optional[str] = None,  # Query parameter for hosted checkout return
):
    """
    Check if user has access to premium content (manual approach).
    
    Supports both:
    - 402 mode: Uses X-Transaction-Id header
    - Hosted checkout: Uses charge_id query parameter
    
    Returns:
    - 402 with charge info if no valid transaction
    - 200 with content access if payment verified
    """
    if not orvion_client:
        return JSONResponse(
            content={"error": "Server misconfigured", "detail": "Meshpay client not initialized"},
            status_code=500,
        )
    
    # Check query parameter first (for hosted checkout return)
    transaction_id = charge_id or x_transaction_id
    
    # If transaction ID provided, verify it
    if transaction_id:
        try:
            result = await orvion_client.verify_charge(
                transaction_id=transaction_id,
                resource_ref=PREMIUM_RESOURCE_REF,
            )
            
            if result.verified:
                return JSONResponse(
                    content={
                        "access": "granted",
                        "transaction_id": result.transaction_id,
                        "amount": result.amount,
                        "currency": result.currency,
                        "customer_ref": result.customer_ref,
                        "verified": True,
                    },
                    status_code=200,
                )
            else:
                # Verification failed - create new charge
                pass
        except OrvionAPIError:
            # Transaction not found or invalid - create new charge
            pass
    
    # No valid transaction - create a charge and return 402
    try:
        charge = await orvion_client.create_charge(
            amount=PREMIUM_AMOUNT,
            currency=PREMIUM_CURRENCY,
            customer_ref=DEMO_CUSTOMER_EMAIL,
            resource_ref=PREMIUM_RESOURCE_REF,
            description="Premium Article Access",
        )
        
        return JSONResponse(
            content={
                "error": "Payment Required",
                "charge_id": charge.id,
                "amount": charge.amount,
                "currency": charge.currency,
                "x402_requirements": charge.x402_requirements,
                "description": "Premium Article Access",
            },
            status_code=402,
        )
    except OrvionAPIError as e:
        return JSONResponse(
            content={"error": "Failed to create charge", "detail": str(e)},
            status_code=500,
        )


@app.post("/api/premium/verify")
async def verify_premium_payment(request: Request):
    """
    Verify a payment for premium content.
    Called after wallet payment to confirm access.
    """
    if not orvion_client:
        return JSONResponse(
            content={"error": "Server misconfigured"},
            status_code=500,
        )
    
    try:
        body = await request.json()
        transaction_id = body.get("transaction_id")
        
        if not transaction_id:
            return JSONResponse(
                content={"error": "Missing transaction_id"},
                status_code=400,
            )
        
        result = await orvion_client.verify_charge(
            transaction_id=transaction_id,
            resource_ref=PREMIUM_RESOURCE_REF,
        )
        
        if result.verified:
            return JSONResponse(
                content={
                    "verified": True,
                    "transaction_id": result.transaction_id,
                    "amount": result.amount,
                    "currency": result.currency,
                    "customer_ref": result.customer_ref,
                },
                status_code=200,
            )
        else:
            return JSONResponse(
                content={
                    "verified": False,
                    "reason": result.reason or "Payment not completed",
                },
                status_code=402,
            )
    except OrvionAPIError as e:
        return JSONResponse(
            content={"error": "Verification failed", "detail": str(e)},
            status_code=500,
        )
    except Exception as e:
        return JSONResponse(
            content={"error": "Invalid request", "detail": str(e)},
            status_code=400,
        )


# ==========================================================================
# Proxy Endpoints (for payment confirmation)
# ==========================================================================

@app.post("/api/facilitator/confirm")
async def proxy_facilitator_confirm(request: Request):
    """Proxy to manually confirm a payment (for wallet payments)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json", "detail": "Request body must be valid JSON"},
            status_code=400,
        )
    
    # Validate request body
    if not isinstance(body, dict):
        return JSONResponse(
            content={"error": "invalid_body", "detail": "Request body must be a JSON object"},
            status_code=400,
        )
    
    if "transaction_id" not in body or not body.get("transaction_id"):
        return JSONResponse(
            content={"error": "missing_transaction_id", "detail": "transaction_id is required"},
            status_code=400,
        )
    
    if "tx_hash" not in body or not body.get("tx_hash"):
        return JSONResponse(
            content={"error": "missing_tx_hash", "detail": "tx_hash is required"},
            status_code=400,
        )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {ORVION_API_KEY}",
                "Content-Type": "application/json",
            }
            
            response = await client.post(
                f"{BACKEND_URL}/v1/facilitator/confirm",
                json=body,
                headers=headers,
            )
            
            try:
                response_data = response.json()
            except Exception:
                response_data = {"error": "Invalid JSON response from backend"}
            
            return JSONResponse(content=response_data, status_code=response.status_code)
            
        except httpx.ConnectError:
            return JSONResponse(
                content={"error": "backend_unreachable", "detail": "Connection to backend failed"},
                status_code=502,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


@app.get("/api/demo/charges/{transaction_id}/ui-state")
async def proxy_demo_ui_state(transaction_id: str):
    """Proxy to get UI state for a charge transaction."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {ORVION_API_KEY}",
            }
            
            response = await client.get(
                f"{BACKEND_URL}/v1/demo/charges/{transaction_id}/ui-state",
                headers=headers,
            )
            
            try:
                response_data = response.json()
            except Exception:
                response_data = {"error": "Invalid JSON response from backend"}
            
            return JSONResponse(content=response_data, status_code=response.status_code)
            
        except httpx.ConnectError:
            return JSONResponse(
                content={"error": "backend_unreachable", "detail": "Connection to backend failed"},
                status_code=502,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


@app.post("/api/billing/transactions/{transaction_id}/cancel")
async def proxy_cancel_billing_transaction(transaction_id: str):
    """Proxy to cancel a billing transaction (when user cancels from wallet)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "X-API-Key": ORVION_API_KEY,
                "Content-Type": "application/json",
            }
            
            response = await client.post(
                f"{BACKEND_URL}/v1/billing/transactions/{transaction_id}/cancel",
                headers=headers,
            )
            
            try:
                response_data = response.json()
            except Exception:
                response_data = {"error": "Invalid JSON response from backend"}
            
            return JSONResponse(content=response_data, status_code=response.status_code)
            
        except httpx.ConnectError:
            return JSONResponse(
                content={"error": "backend_unreachable", "detail": "Connection to backend failed"},
                status_code=502,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


# ==========================================================================
# Static Files & Pages
# ==========================================================================

# Mount static files (must be after API routes)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    """Serve the main landing page"""
    return FileResponse("static/index.html")


def kill_port_process(port: int) -> None:
    """
    Kill any process running on the specified port.
    Works on macOS and Linux.
    """
    import subprocess
    import platform
    
    try:
        if platform.system() == "Windows":
            # Windows: find process using netstat and kill it
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True,
                text=True,
                check=False,
            )
            for line in result.stdout.split("\n"):
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    if len(parts) > 4:
                        pid = parts[-1]
                        subprocess.run(["taskkill", "/F", "/PID", pid], check=False)
        else:
            # macOS/Linux: use lsof to find and kill process
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.stdout.strip():
                pids = result.stdout.strip().split("\n")
                for pid in pids:
                    if pid:
                        subprocess.run(["kill", "-9", pid], check=False)
                        print(f"Killed process {pid} on port {port}")
    except Exception as e:
        print(f"Warning: Could not kill process on port {port}: {e}")


if __name__ == "__main__":
    import uvicorn
    
    # Kill any existing process on port 5001
    kill_port_process(5001)
    
    uvicorn.run(app, host="0.0.0.0", port=5001)
