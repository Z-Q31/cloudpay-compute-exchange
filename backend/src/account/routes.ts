import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RuntimeConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { AccountService } from './service.js';

const phone = z.string().trim().min(11).max(20);
const purpose = z.enum(['register', 'login', 'delete_account']);
const device = z.object({
  deviceId: z.string().trim().min(8).max(200),
  appVersion: z.string().trim().min(1).max(40),
  platform: z.enum(['android', 'ios']),
});
const consent = z.object({ kind: z.enum(['terms', 'privacy']), version: z.string().trim().min(1).max(40) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 400, '提交的信息不完整或格式不正确。', {
      fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    });
  }
  return result.data;
}

function context(request: FastifyRequest) {
  return {
    requestId: request.id,
    ip: request.ip,
    userAgent: String(request.headers['user-agent'] ?? 'unknown').slice(0, 500),
  };
}

export async function registerAccountRoutes(app: FastifyInstance, service: AccountService, config: RuntimeConfig) {
  app.get('/mobile/v1/legal', async () => ({ ok: true, documents: service.legalDocuments(config) }));

  app.post('/mobile/v1/auth/otp/request', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const body = parse(z.object({ phone, purpose }), request.body);
    const result = await service.requestOtp(body, context(request));
    return reply.status(202).send({ ok: true, challenge: result });
  });

  app.post('/mobile/v1/auth/otp/verify', {
    config: { rateLimit: { max: 12, timeWindow: '10 minutes' } },
  }, async (request) => {
    const body = parse(z.object({
      phone,
      challengeId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/u),
      purpose,
      displayName: z.string().trim().min(1).max(80).optional(),
      consents: z.array(consent).max(4).optional(),
      device: device.optional(),
    }), request.body);
    const verification = {
      phone: body.phone,
      challengeId: body.challengeId,
      code: body.code,
      purpose: body.purpose,
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.consents === undefined ? {} : { consents: body.consents }),
      ...(body.device === undefined ? {} : { device: body.device }),
    };
    return { ok: true, result: await service.verifyOtp(verification, context(request)) };
  });

  app.post('/mobile/v1/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request) => {
    const body = parse(z.object({
      refreshToken: z.string().min(40).max(500),
      deviceId: z.string().trim().min(8).max(200),
    }), request.body);
    return { ok: true, session: await service.refresh(body.refreshToken, body.deviceId, context(request)) };
  });

  app.get('/mobile/v1/me', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    return { ok: true, user: await service.profile(principal) };
  });

  app.get('/mobile/v1/auth/sessions', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    return { ok: true, sessions: await service.sessions(principal) };
  });

  app.delete('/mobile/v1/auth/sessions/:sessionId', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    const parameters = parse(z.object({ sessionId: z.string().uuid() }), request.params);
    return { ok: true, ...(await service.logout(principal, parameters.sessionId, context(request))) };
  });

  app.post('/mobile/v1/auth/logout', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    return { ok: true, ...(await service.logout(principal, undefined, context(request))) };
  });

  app.get('/mobile/v1/account/deletion', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    return { ok: true, request: await service.deletionStatus(principal) };
  });

  app.post('/mobile/v1/account/deletion', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    const body = parse(z.object({
      reauthenticationToken: z.string().min(40).max(2_000),
      reason: z.string().trim().max(1_000).optional(),
    }), request.body);
    const deletion = await service.requestDeletion(principal, body.reauthenticationToken, body.reason, context(request));
    return reply.status(202).send({ ok: true, request: deletion });
  });

  app.post('/mobile/v1/account/deletion/public', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = parse(z.object({
      reauthenticationToken: z.string().min(40).max(2_000),
      reason: z.string().trim().max(1_000).optional(),
    }), request.body);
    const deletion = await service.requestDeletionFromWeb(
      body.reauthenticationToken, body.reason, context(request),
    );
    return reply.status(202).send({ ok: true, request: deletion });
  });

  app.delete('/mobile/v1/account/deletion', async (request) => {
    const { principal } = await service.authenticate(request.headers.authorization);
    return { ok: true, ...(await service.cancelDeletion(principal, context(request))) };
  });
}
