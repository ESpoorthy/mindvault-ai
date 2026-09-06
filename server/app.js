import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';

const messageSchema = z.object({ role: z.enum(['user', 'model']), text: z.string().trim().min(1).max(6000) });
const chatSchema = z.object({ mode: z.enum(['reflect', 'brainstorm', 'plan', 'free']).default('reflect'), messages: z.array(messageSchema).min(1).max(30) });
const journalSchema = chatSchema.extend({ title: z.string().trim().max(140).optional() });
const modes = {
  reflect: 'Help the user reflect thoughtfully. Do not diagnose, make clinical claims, or impersonate a therapist.',
  brainstorm: 'Help the user explore varied ideas, trade-offs, and useful questions.',
  plan: 'Help turn the user’s thoughts into small, practical, achievable next steps.',
  free: 'Be a warm, helpful thinking partner.'
};

const safeError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const parseJsonObject = (text) => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object returned');
  return JSON.parse(match[0]);
};
const analysisSchema = z.object({
  title: z.string().trim().min(1).max(140), summary: z.string().trim().min(1).max(1200),
  insights: z.array(z.string().trim().min(1).max(400)).max(8), goals: z.array(z.string().trim().min(1).max(300)).max(8),
  actions: z.array(z.string().trim().min(1).max(300)).max(8), mood: z.string().trim().max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(10), keywords: z.array(z.string().trim().min(1).max(60)).max(15)
});

export function createApp({ auth, store, gemini, clientConfig = {}, clock = () => new Date().toISOString() }) {
  const app = express();
  const hits = new Map();
  app.disable('x-powered-by'); app.use(helmet({ contentSecurityPolicy: false })); app.use(express.json({ limit: '180kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) => res.json(clientConfig));
  app.use('/api', async (req, res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) return safeError(res, 401, 'UNAUTHORIZED', 'Authentication is required.');
    try { req.user = await auth.verifyIdToken(header.slice(7)); } catch { return safeError(res, 401, 'UNAUTHORIZED', 'Your session is invalid or expired.'); }
    const uid = req.user.uid; const now = Date.now(); const prior = (hits.get(uid) || []).filter((t) => now - t < 60_000);
    if (prior.length >= 20) return safeError(res, 429, 'RATE_LIMITED', 'Please wait a moment before trying again.');
    prior.push(now); hits.set(uid, prior); next();
  });
  const body = (schema, req, res) => { const result = schema.safeParse(req.body); if (!result.success) { safeError(res, 400, 'INVALID_REQUEST', 'Please check your request and try again.'); return null; } return result.data; };
  const get = async (uid, id) => { const journal = await store.get(uid, id); return journal || null; };

  app.post('/api/chat', async (req, res) => {
    const data = body(chatSchema, req, res); if (!data) return;
    try { const reply = await gemini.chat({ instruction: modes[data.mode], messages: data.messages }); res.json({ message: { role: 'model', text: String(reply).slice(0, 8000) } }); }
    catch { safeError(res, 502, 'AI_UNAVAILABLE', 'MindVault could not respond right now. Please retry.'); }
  });
  app.post('/api/journals/analyze', async (req, res) => {
    const data = body(journalSchema, req, res); if (!data) return;
    try {
      const raw = await gemini.analyze({ messages: data.messages });
      const analysis = analysisSchema.safeParse(parseJsonObject(raw));
      if (!analysis.success) return safeError(res, 502, 'ANALYSIS_INVALID', 'Could not safely structure this reflection. Please try again.');
      const now = clock(); const journal = { ...analysis.data, messages: data.messages, mode: data.mode, createdAt: now, updatedAt: now };
      if (data.title) journal.title = data.title;
      const id = await store.create(req.user.uid, journal); res.status(201).json({ id, journal: { id, ...journal } });
    } catch { safeError(res, 502, 'ANALYSIS_FAILED', 'Could not save this reflection. Please try again.'); }
  });
  app.get('/api/journals', async (req, res) => { try { res.json({ journals: await store.list(req.user.uid) }); } catch { safeError(res, 500, 'STORAGE_ERROR', 'Could not load reflections.'); } });
  app.get('/api/journals/:id', async (req, res) => { const journal = await get(req.user.uid, req.params.id); if (!journal) return safeError(res, 404, 'NOT_FOUND', 'Reflection not found.'); res.json({ journal }); });
  app.delete('/api/journals/:id', async (req, res) => { const journal = await get(req.user.uid, req.params.id); if (!journal) return safeError(res, 404, 'NOT_FOUND', 'Reflection not found.'); await store.delete(req.user.uid, req.params.id); res.status(204).end(); });
  app.get('/api/export', async (req, res) => { const journals = await store.list(req.user.uid); res.set({ 'Content-Disposition': 'attachment; filename="mindvault-export.json"', 'Content-Type': 'application/json' }).json({ exportedAt: clock(), journals }); });
  app.delete('/api/journals', async (req, res) => { await store.deleteAll(req.user.uid); res.status(204).end(); });
  return app;
}
