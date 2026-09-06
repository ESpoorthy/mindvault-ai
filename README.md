# MindVault AI

> **Your thoughts. Your AI. Your private space.**

MindVault AI is a privacy-first personal journal powered by Gemini. Authenticated users can turn multi-turn conversations into private reflections, insights, actions, goals, and a personal timeline.

## Highlights

- Google sign-in with Firebase Authentication
- Reflect, Brainstorm, Plan, and Free Chat modes
- Server-side multi-turn Gemini conversations
- Structured summaries, insights, actions, goals, mood, tags, and keywords
- Private journal search, dashboard metrics, goals, and timeline
- Data export and permanent journal deletion
- Responsive, accessible interface for an Ideathon demonstration

## Architecture

```text
Browser (Vite + Firebase Auth)
          │ Firebase ID token
          ▼
Cloud Run (Express API)
   ├── Firebase Admin verifies identity
   ├── Firestore: users/{uid}/journals/{journalId}
   └── Gemini API key from Secret Manager
```

The Gemini key never reaches the browser. The API uses only the verified Firebase UID as the user identity; it never trusts an ID supplied by the client.

## Security model

- Every private endpoint verifies a Firebase ID token.
- Journal reads, writes, exports, and deletes are scoped to the verified UID.
- `firestore.rules` enforces `request.auth.uid == userId` as defense in depth.
- Gemini runs only on the server with Secret Manager-injected credentials.
- Message count, message length, payload size, and model output are capped.
- Prototype protection includes a per-user limit of 20 requests/minute; use a distributed limiter for multi-instance production scale.
- Application instructions are kept separate from untrusted journal text, and secrets never appear in prompts or logs.

## Project structure

```text
src/               Frontend application and styles
server/            Express API, auth boundary, and API tests
firestore.rules    Firestore authorization rules
Dockerfile         Cloud Run production container build
.env.example       Local configuration template (no secret values)
```

## Run locally

### Prerequisites

- Node.js 22+
- Firebase project with Google Authentication and Firestore enabled
- Firebase web-app configuration
- Gemini API key for local server use
- Application Default Credentials: `gcloud auth application-default login`

### Setup and verification

```bash
cp .env.example .env
npm install
npm run dev

npm test
npm run lint
npm run build
```

Populate the Firebase values and `GEMINI_API_KEY` in `.env`. Firebase web configuration is public by design; the Gemini key must never be committed.

The test suite covers missing/invalid tokens, malformed Gemini requests and analysis, current-user export/deletion isolation, and a User A/User B cross-user journal denial.

## Deploy to Cloud Run

### Prerequisites

1. Attach an active **billing account** to the Google Cloud project. Cloud Run, Cloud Build, Artifact Registry, and Secret Manager cannot be enabled without billing.
2. Enable Google sign-in and add the final Cloud Run host to Firebase Authentication’s authorized domains.
3. Create Firestore and deploy the included rules:

   ```bash
   firebase deploy --only firestore:rules
   ```

### Store the Gemini key

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
printf %s "$GEMINI_API_KEY" | gcloud secrets create mindvault-gemini-key --data-file=- --replication-policy=automatic
```

Grant the Cloud Run runtime service account only:

- `roles/secretmanager.secretAccessor`
- `roles/datastore.user`

### Deploy

```bash
gcloud run deploy mindvault-ai \
  --source . \
  --region asia-south1 \
  --set-secrets GEMINI_API_KEY=mindvault-gemini-key:latest \
  --set-env-vars GEMINI_MODEL=gemini-2.0-flash,FIREBASE_API_KEY=...,FIREBASE_AUTH_DOMAIN=...,FIREBASE_PROJECT_ID=...,FIREBASE_STORAGE_BUCKET=...,FIREBASE_MESSAGING_SENDER_ID=...,FIREBASE_APP_ID=...
```

Cloud Run prints the HTTPS URL when deployment succeeds. Set `GEMINI_MODEL` to a model available to the deployed API key if `gemini-2.0-flash` is unavailable.

### Deployed URL
https://mindvault-ai-jf98.onrender.com

## Environment variables

| Variable | Where used | Secret? |
| --- | --- | --- |
| `VITE_FIREBASE_*` | Local browser build | No — Firebase web configuration |
| `FIREBASE_*` | Docker/Render runtime | No — served as public Firebase web configuration |
| `GEMINI_API_KEY` | Cloud Run server only | Yes — Secret Manager |
| `GEMINI_MODEL` | Cloud Run server | No |
| `PORT` | Cloud Run server | No |

## License

See [LICENSE](LICENSE).
