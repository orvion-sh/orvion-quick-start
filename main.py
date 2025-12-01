"""
Meshpay Charges API Demo Playground

A standalone demo server that proxies requests to the Meshpay backend,
keeping API keys secure on the server side.
"""

import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Load environment variables
load_dotenv()

MESHPAY_API_KEY = os.getenv("MESHPAY_API_KEY", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

app = FastAPI(
    title="Meshpay Charges Playground",
    description="Demo playground for testing the Meshpay Charges API",
    version="1.0.0",
)


@app.get("/health")
async def health():
    """Demo server health check"""
    return {"status": "healthy", "service": "demo-playground"}


@app.get("/api/config")
async def get_config():
    """
    Returns public configuration (no secrets).
    Frontend uses this to display backend URL.
    """
    return {"backend_url": BACKEND_URL}


@app.get("/api/test-connection")
async def test_connection():
    """
    Full connectivity and API key test.
    
    1. Checks if backend /health is reachable
    2. Tests API key by sending an invalid charge request
       - 401 = API key invalid
       - 400 = API key valid (validation error expected)
    """
    result = {
        "demo_server": "ok",
        "backend": {
            "reachable": False,
            "health_status": None,
            "api_key_valid": None,
        }
    }
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Step 1: Check backend health
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
        
        # Step 2: Test API key with an invalid charge request
        # We intentionally send a request missing 'amount' to trigger a 400
        # If we get 401, the API key is invalid
        try:
            test_payload = {"currency": "USDC"}  # Missing required 'amount'
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
                "Content-Type": "application/json",
            }
            
            charge_response = await client.post(
                f"{BACKEND_URL}/v1/charges",
                json=test_payload,
                headers=headers,
            )
            
            if charge_response.status_code == 401:
                result["backend"]["api_key_valid"] = False
                result["backend"]["error"] = "401 Unauthorized - Check MESHPAY_API_KEY in .env"
            elif charge_response.status_code == 400:
                # 400 means API key is valid, we just got a validation error (expected)
                result["backend"]["api_key_valid"] = True
            elif charge_response.status_code == 422:
                # 422 Unprocessable Entity also means auth passed, validation failed
                result["backend"]["api_key_valid"] = True
            else:
                # Unexpected status, but auth likely passed
                result["backend"]["api_key_valid"] = True
                result["backend"]["note"] = f"Unexpected status {charge_response.status_code}"
                
        except Exception as e:
            result["backend"]["api_key_valid"] = None
            result["backend"]["api_key_error"] = f"Could not verify API key: {str(e)}"
    
    return JSONResponse(content=result, status_code=200)


@app.post("/api/charges")
async def proxy_charges(request: Request):
    """
    Proxies charge requests to the Meshpay backend.
    
    - Adds Authorization header with API key from environment
    - Forwards request body as-is
    - Returns backend response with same status code
    """
    try:
        # Get request body
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json", "detail": "Request body must be valid JSON"},
            status_code=400,
        )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
                "Content-Type": "application/json",
            }
            
            response = await client.post(
                f"{BACKEND_URL}/v1/charges",
                json=body,
                headers=headers,
            )
            
            # Return backend response 1:1
            try:
                response_data = response.json()
            except Exception:
                response_data = {"raw_response": response.text, "error": "Invalid JSON response from backend"}
            
            # If backend returned an error, log it for debugging
            if response.status_code >= 400:
                import structlog
                logger = structlog.get_logger()
                logger.error(
                    "Backend returned error",
                    status_code=response.status_code,
                    response=response_data,
                    request_body=body
                )
            
            # Always return the backend's response exactly as-is
            # This ensures ValidationError messages (400) are shown to users
            return JSONResponse(
                content=response_data,
                status_code=response.status_code,
            )
            
        except httpx.ConnectError:
            return JSONResponse(
                content={
                    "error": "backend_unreachable",
                    "detail": "Connection to Meshpay backend failed - Is it running?",
                },
                status_code=502,
            )
        except httpx.TimeoutException:
            return JSONResponse(
                content={
                    "error": "backend_timeout",
                    "detail": "Meshpay backend request timed out",
                },
                status_code=504,
            )
        except Exception as e:
            return JSONResponse(
                content={
                    "error": "proxy_error",
                    "detail": f"Proxy error: {str(e)}",
                },
                status_code=502,
            )


# ==========================================================================
# Facilitator Endpoints (for payment monitoring)
# ==========================================================================

@app.post("/api/facilitator/monitor")
async def proxy_facilitator_monitor(request: Request):
    """
    Proxy to register a payment monitor with the facilitator.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json", "detail": "Request body must be valid JSON"},
            status_code=400,
        )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
                "Content-Type": "application/json",
            }
            
            response = await client.post(
                f"{BACKEND_URL}/v1/facilitator/monitor",
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
        except httpx.TimeoutException:
            return JSONResponse(
                content={"error": "backend_timeout", "detail": "Backend request timed out"},
                status_code=504,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


@app.get("/api/facilitator/monitor/{monitor_id}")
async def proxy_facilitator_status(monitor_id: str):
    """
    Proxy to check payment monitor status.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
            }
            
            response = await client.get(
                f"{BACKEND_URL}/v1/facilitator/monitor/{monitor_id}",
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


@app.post("/api/facilitator/confirm")
async def proxy_facilitator_confirm(request: Request):
    """
    Proxy to manually confirm a payment (for testing/demo).
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json", "detail": "Request body must be valid JSON"},
            status_code=400,
        )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
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


# ==========================================================================
# Demo UI State Endpoint (for automatic payment verification UI)
# ==========================================================================

@app.get("/api/demo/charges/{transaction_id}/ui-state")
async def proxy_demo_ui_state(transaction_id: str):
    """
    Proxy to get UI state for a charge transaction.
    
    This endpoint is for the demo UI to poll for automatic updates.
    It aggregates transaction status and verification into a single response.
    
    Response:
    {
        "transaction_id": "txn_abc123",
        "status": "pending",           // pending | succeeded | failed
        "verified": false,             // result of verify_charge() if succeeded
        "verified_at": null,
        "content_unlocked": false,     // status=succeeded && verified=true
        "amount": "1.00",
        "currency": "USDC",
        "raw": {
            "meshpay_status": "pending",
            "meshpay_verified_reason": null
        }
    }
    
    Poll every 2-3 seconds while status is "pending".
    Stop polling when status is "succeeded" or "failed".
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
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
        except httpx.TimeoutException:
            return JSONResponse(
                content={"error": "backend_timeout", "detail": "Backend request timed out"},
                status_code=504,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


# ==========================================================================
# Charge Verification Endpoint (for seller-side verification)
# ==========================================================================

@app.post("/api/charges/verify")
async def proxy_charges_verify(request: Request):
    """
    Proxy to verify a charge payment.
    
    This endpoint allows sellers to verify that a payment has been completed
    before showing paid content to users.
    
    Request body:
    {
        "transaction_id": "txn_abc123",
        "customer_ref": "user_123",      // optional
        "resource_ref": "article:42"     // optional
    }
    
    Response codes:
    - 200: Payment verified (verified: true)
    - 404: Transaction not found
    - 409: Verification failed (mismatch or not succeeded)
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"error": "invalid_json", "detail": "Request body must be valid JSON"},
            status_code=400,
        )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {
                "Authorization": f"Bearer {MESHPAY_API_KEY}",
                "Content-Type": "application/json",
            }
            
            response = await client.post(
                f"{BACKEND_URL}/v1/charges/verify",
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
        except httpx.TimeoutException:
            return JSONResponse(
                content={"error": "backend_timeout", "detail": "Backend request timed out"},
                status_code=504,
            )
        except Exception as e:
            return JSONResponse(
                content={"error": "proxy_error", "detail": str(e)},
                status_code=502,
            )


# Mount static files (must be after API routes)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def serve_index():
    """Serve the main playground HTML page"""
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)

