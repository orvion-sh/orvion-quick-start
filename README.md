# Meshpay Charges Playground

A standalone demo playground for testing the Meshpay `/v1/charges` API endpoint. Perfect for development testing, demos, and sales calls.

## Features

- **Preset Scenarios** - One-click test cases (small charge, high value, error cases)
- **Request Inspector** - Real-time view of the request being sent
- **Copy as cURL** - Generate ready-to-paste terminal commands
- **Response Inspector** - Color-coded status badges and JSON highlighting
- **Transaction Log** - Chronological history with latency tracking
- **Connection Test** - Verify backend connectivity and API key validity

## Architecture

```
Browser (localhost:5001)
    │
    ▼
FastAPI Demo Server (port 5001)
    │  - Serves static files
    │  - Proxies API calls (API key stays server-side)
    ▼
Meshpay Backend (port 8000)
    │  - /health
    │  - /v1/charges
```

The demo server acts as a proxy, keeping your API key secure on the server side.

## Quick Start

### 1. Start the Backend First

The demo requires the Meshpay backend to be running on port 8000:

```bash
# From the project root
cd backend
uvicorn app.main:app --reload --port 8000
```

Keep this terminal running. The backend must be running before starting the demo.

### 2. Install Dependencies

In a new terminal:

```bash
cd demo
pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your Meshpay API key:

```env
MESHPAY_API_KEY=your_api_key_here
BACKEND_URL=http://localhost:8000
```

**Important:** Get your API key from the Meshpay dashboard: Settings → API Keys

### 4. Start the Demo Server

```bash
cd demo
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --reload --port 5001
```

The demo server will start on port 5001.

### 5. Open the Playground

Navigate to [http://localhost:5001](http://localhost:5001)

You should see:
- ✅ Test Connection button to verify backend connectivity and API key
- Preset scenarios for quick testing
- Charge form for manual charge creation
- Request/Response inspectors showing exactly what's being sent/received
- Transaction log with request history

## How to Start (Quick Reference)

**Prerequisites:**
1. Backend running on port 8000
2. `.env` file configured with `MESHPAY_API_KEY`

**Start command:**
```bash
cd demo
python main.py
```

**Access:**
- Demo playground: http://localhost:5001
- Backend API: http://localhost:8000

## Usage

### Testing Connection

Click **Test Connection** to verify:
- Demo server is running
- Backend is reachable
- API key is valid

### Using Presets

Click any preset button to pre-fill the form:

| Preset | Purpose |
|--------|---------|
| Small $1 | Quick sanity check |
| Medium $50 | Typical use case |
| High $1000 | Large transaction test |
| With Metadata | Full payload with customer_ref, reference, metadata |
| ❌ Missing Amount | 400 error demo |
| ❌ Bad Currency | Validation error demo |
| ❌ Zero Amount | amount > 0 error demo |

### Creating Charges

1. Fill in the form (or use a preset)
2. Click **Create Charge**
3. View the response in the Response panel
4. Check the Transaction Log for history

### Copying as cURL

Click **Copy as cURL** to get a ready-to-paste command:

```bash
curl -X POST "http://localhost:8000/v1/charges" \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"amount":10,"currency":"USD"}'
```

## API Endpoints (Demo Server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve playground UI |
| `/health` | GET | Demo server health check |
| `/api/config` | GET | Get backend URL (no secrets) |
| `/api/test-connection` | GET | Test backend + API key |
| `/api/charges` | POST | Proxy to `/v1/charges` |

## Development

### Project Structure

```
demo/
├── main.py              # FastAPI server
├── requirements.txt     # Python dependencies
├── .env.example         # Environment template
├── .env                 # Your configuration (git-ignored)
├── static/
│   ├── index.html       # Playground UI
│   ├── style.css        # Dark theme styling
│   └── script.js        # Frontend logic
└── README.md            # This file
```

### Running with Hot Reload

```bash
uvicorn main:app --reload --port 5001
```

## Troubleshooting

### "Backend unreachable"

- Ensure the Meshpay backend is running on the configured port
- Check `BACKEND_URL` in your `.env` file

### "API key invalid"

- Verify `MESHPAY_API_KEY` in your `.env` file
- Ensure the API key has permissions for the `/v1/charges` endpoint

### "Demo server error"

- Check if port 5001 is available
- Verify all dependencies are installed

## License

Internal tool - Meshpay

