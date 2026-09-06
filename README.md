# MindVault AI

MindVault is a privacy-first Gemini journal: Google-authenticated users can chat in Reflect, Brainstorm, Plan, and Free Chat modes; save structured reflections; browse their timeline; search their own data; export it; and permanently delete it.

## Architecture and security

The Vite client authenticates with Firebase Authentication and sends an ID token to the Express API. The API verifies it with Firebase Admin before every private operation and derives the UID solely from that verified token. Journal documents live beneath `users/{uid}/journals/{journalId}`. Gemini is called only by the server; the browser never receives its key. The server caps payloads, message count/length, output size, and per-user requests (20/minute, intentionally documented as in-memory prototype protection). It avoids logging journal contents or credentials.

`firestore.rules` provides direct-client defense in depth. The API additionally enforces ownership through the UID-scoped Firestore path. Requests for another user's known document ID resolve as not found rather than revealing it exists.

## Local setup

1. Create a Firebase project, enable Google Authentication, create Firestore, and add a web app.
2. Copy `.env.example` to `.env` and populate the `VITE_FIREBASE_*` values. Set `GEMINI_API_KEY` only locally; never commit it.
3. Authenticate Application Default Credentials for server-side Firebase Admin locally (`gcloud auth application-default login`), then run `npm install`, `npm run dev`.
4. Run `npm test`, `npm run lint`, and `npm run build` before deploying.

## Deploy to Cloud Run

1. Enable Cloud Run, Artifact Registry, Firebase/Firestore, and Secret Manager APIs. Deploy the rules with `firebase deploy --only firestore:rules`.
2. Store the Gemini key: `printf %s "$GEMINI_API_KEY" | gcloud secrets create mindvault-gemini-key --data-file=-`.
3. Give the Cloud Run runtime service account `roles/secretmanager.secretAccessor` and Firestore access appropriate to its project (normally `roles/datastore.user`). Do not use owner/editor roles.
4. Build/deploy: `gcloud run deploy mindvault-ai --source . --region REGION --set-secrets GEMINI_API_KEY=mindvault-gemini-key:latest --set-env-vars GEMINI_MODEL=gemini-2.0-flash`.
5. Add the Cloud Run URL to the Firebase authorized domains if needed. Cloud Run supplies HTTPS and injects the secret as the server-only environment variable.

The model can be changed through `GEMINI_MODEL` without altering source. Ensure the selected model is available to the API key/project in use.

## Test coverage

The API suite verifies missing/invalid token rejection, malformed chat rejection, authenticated journal creation, a concrete User A/User B cross-user read/delete denial, export isolation, and scoped bulk deletion. Gemini analysis uses a strict Zod schema; malformed model output returns an error before any Firestore write.
