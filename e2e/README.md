# Sociva E2E Testing Framework

Production-grade Playwright testing with Phone+OTP auth, DB-aware assertions, and chaos testing.

## Setup

```bash
# Install Playwright browsers
npx playwright install --with-deps chromium

# Copy env
cp e2e/.env.example e2e/.env
# Edit e2e/.env with your values
```

## Run Tests

```bash
# All tests (desktop Chrome)
npm run test:e2e

# Smoke tests only (~2 min)
npm run test:e2e:smoke

# Critical tests
npm run test:e2e -- --grep @critical

# Regression suite
npm run test:e2e -- --grep @regression

# Interactive debug mode
npm run test:e2e:debug

# Specific suite
npm run test:e2e -- --grep "buyer"

# Mobile tests
npm run test:e2e -- --project=mobile-chrome
```

## View Reports

```bash
npx playwright show-report e2e/playwright-report
```

## Architecture

```
e2e/
├── fixtures/       # Test fixtures (db, auth, user pages)
├── pages/          # Page Object Models
├── utils/          # Helpers (db, mocks, test data)
├── tests/
│   ├── buyer/      # Buyer journey tests
│   ├── seller/     # Seller journey tests
│   ├── payments/   # Razorpay tests
│   ├── notifications/ # Push notification tests
│   ├── delivery/   # Delivery tracking tests
│   ├── cross-user/ # Multi-user flows
│   └── edge-cases/ # Chaos & edge case tests
└── .auth/          # Cached auth state (gitignored)
```

## Auth

Uses Phone+OTP bypass (0123456789 / 1234) for deterministic, instant login.
Auth state is cached in `.auth/` directory to avoid re-login per test.

## Tags

- `@smoke` — Fast critical-path tests (~2 min)
- `@critical` — Must-pass tests for deployment
- `@regression` — Full suite including edge cases
- `@mobile` — Mobile-specific viewport tests
