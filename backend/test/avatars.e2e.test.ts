import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { before, after, test, mock } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { AVATAR_DIRECTORY, AvatarFiles } from '../src/avatars/avatar-files.service';

let app: INestApplication, prisma: PrismaService, directory: string, jpeg: Buffer, png: Buffer;
const accounts: { id: string; access: string; refresh: string; email: string; password: string }[] = [];
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'partymaker-avatar-test-'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AVATAR_DIRECTORY).useValue(directory).compile();
  app = module.createNestApplication(); app.useLogger(false); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#d95b31' } }).jpeg().withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Copyright: 'Private original' }, IFD3: { GPSLatitude: '42/1 0/1 0/1', GPSLatitudeRef: 'N' } }).toBuffer();
  png = await sharp({ create: { width: 600, height: 800, channels: 4, background: '#2288bb88' } }).png().toBuffer();
  for (let i = 0; i < 2; i++) {
    const tag = randomUUID().replaceAll('-', '').slice(0, 20), email = `av_${tag}@example.test`, password = 'Avatar-Fixture-Only!2026';
    const r = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password, handle: `av_${tag}`, displayName: 'Avatar fixture' }).expect(201);
    assert.equal(r.body.user.avatar, null);
    accounts.push({ id: r.body.user.id, access: r.body.accessToken, refresh: r.body.refreshToken, email, password });
  }
});
after(async () => {
  mock.restoreAll();
  if (prisma) await prisma.user.deleteMany({ where: { id: { in: accounts.map(a => a.id) } } });
  await app?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('partymaker-avatar-test-'));
    await rm(directory, { recursive: true, force: true }); // Exact validated mkdtemp fixture directory only.
  }
});
const upload = (who = 0) => request(app.getHttpServer()).post('/api/v1/users/me/avatar').auth(accounts[who]!.access, { type: 'bearer' });
const get = (path: string, who = 0) => request(app.getHttpServer()).get(`/api/v1/${path}`).auth(accounts[who]!.access, { type: 'bearer' });
const media = (id: string) => request(app.getHttpServer()).get(`/api/v1/media/avatars/${id}`);
const file = (req: ReturnType<typeof upload>, buffer = jpeg, contentType = 'image/jpeg') => req.attach('file', buffer, { filename: '../../original.secret', contentType });
const current = (who = 0) => prisma.user.findUniqueOrThrow({ where: { id: accounts[who]!.id }, include: { avatar: true } });

test('avatar upload requires Bearer and exactly one named multipart file, no body/query identity fields', async () => {
  await file(request(app.getHttpServer()).post('/api/v1/users/me/avatar')).expect(401);
  for (const req of [upload(), upload().send({ ownerId: 'x' }), upload().field('ownerId', accounts[1]!.id),
    upload().field('userId', accounts[1]!.id), upload().field('mediaId', randomUUID()), upload().field('storageKey', 'x'), upload().query({ ownerId: accounts[1]!.id })]) {
    assert.equal((await req.expect(400)).body.error.code, 'VALIDATION_FAILED');
  }
  await upload().attach('wrong', jpeg, 'x.jpg').expect(400);
  await file(upload()).attach('file', jpeg, 'y.jpg').expect(400);
  await upload().field('extra', 'x').attach('file', jpeg, 'x.jpg').expect(400);
  assert.equal((await current()).avatar, null);
});

test('JPEG/PNG become public metadata-free 512-square JPEG, safely bound only to the Bearer user', async () => {
  assert.ok((await sharp(jpeg).metadata()).exif);
  for (const [buffer, type] of [[jpeg, 'image/jpeg'], [png, 'image/png']] as const) {
    const before = (await current()).avatarMediaId;
    const { body } = await file(upload(), buffer, type).expect(200);
    assert.deepEqual(Object.keys(body), ['avatar']);
    assert.deepEqual(Object.keys(body.avatar).sort(), ['height', 'id', 'mimeType', 'width']);
    assert.deepEqual(body.avatar, { id: body.avatar.id, width: 512, height: 512, mimeType: 'image/jpeg' });
    const stored = await current(); assert.equal(stored.avatarMediaId, body.avatar.id); assert.equal(stored.avatar!.ownerId, accounts[0]!.id);
    assert.equal((await current(1)).avatarMediaId, null);
    const response = await media(body.avatar.id).expect(200).expect('Content-Type', /image\/jpeg/).expect('X-Content-Type-Options', 'nosniff');
    const meta = await sharp(response.body as Buffer).metadata();
    assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 512); assert.equal(meta.height, 512);
    assert.equal(meta.exif, undefined); assert.equal(meta.xmp, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.orientation, undefined);
    assert.equal(stored.avatar!.bytes, (response.body as Buffer).length);
    if (before) { await media(before).expect(404); assert.ok(await readFile(join(directory, `${before}.jpg`))); }
    assert.deepEqual((await get('users/me').expect(200)).body.avatar, body.avatar);
  }
  // Orientation is applied to pixels, not merely removed from metadata: EXIF 6 rotates clockwise.
  const split = Buffer.alloc(80 * 40 * 3);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) split[(y * 80 + x) * 3 + (x < 40 ? 0 : 2)] = 255;
  const oriented = await sharp(split, { raw: { width: 80, height: 40, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = (await file(upload(), oriented).expect(200)).body.avatar.id;
  const result = (await media(rotated).expect(200)).body as Buffer;
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  const top = (50 * info.width + 256) * info.channels, bottom = (460 * info.width + 256) * info.channels;
  assert.ok(data[top]! > 200 && data[top + 2]! < 30, 'Red left half rotates to top');
  assert.ok(data[bottom + 2]! > 200 && data[bottom]! < 30, 'Blue right half rotates to bottom');
});

test('reject MIME mismatch, unsupported/corrupt/animated images and byte/pixel excess before profile mutation', async () => {
  const before = await current();
  for (const [buffer, type, status, code] of [
    [jpeg, 'image/png', 415, 'AVATAR_UNSUPPORTED_FORMAT'], [png, 'text/plain', 415, 'AVATAR_UNSUPPORTED_FORMAT'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 415, 'AVATAR_UNSUPPORTED_FORMAT'],
    [jpeg.subarray(0, 80), 'image/jpeg', 400, 'AVATAR_INVALID_IMAGE'],
    [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/jpeg', 413, 'AVATAR_TOO_LARGE'],
  ] as const) assert.equal((await file(upload(), buffer, type).expect(status)).body.error.code, code);
  const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#000000' } }).png().toBuffer();
  assert.equal((await file(upload(), huge, 'image/png').expect(413)).body.error.code, 'AVATAR_PIXEL_LIMIT');
  // APNG control chunk, rejected even if the decoder would silently return just its first frame.
  const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write('acTL', 4); chunk.writeUInt32BE(2, 8);
  await file(upload(), Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]), 'image/png').expect(415);
  assert.deepEqual(await current(), before);
});

test('disk error and rolled-back DB transaction preserve old profile; prepared file is retained on DB uncertainty', async () => {
  const before = await current(), files = app.get(AvatarFiles);
  const disk = mock.method(files, 'prepare', async () => { throw new Error('fixture disk unavailable'); });
  assert.equal((await file(upload()).expect(503)).body.error.code, 'AVATAR_STORAGE_UNAVAILABLE'); disk.mock.restore();
  assert.deepEqual(await current(), before);
  const originalMethod = prisma.$transaction, original = originalMethod.bind(prisma);
  prisma.$transaction = (async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => original(async tx => {
    await work(tx); throw new Error('fixture rollback');
  })) as unknown as typeof prisma.$transaction;
  const count = (await readdir(directory)).length;
  try { await file(upload()).expect(500); } finally { prisma.$transaction = originalMethod; }
  assert.equal((await readdir(directory)).length, count + 1); assert.deepEqual(await current(), before);
  prisma.$transaction = (async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    await original(work); throw new Error('fixture commit acknowledgement lost');
  }) as unknown as typeof prisma.$transaction;
  try { await file(upload()).expect(500); } finally { prisma.$transaction = originalMethod; }
  const committed = await current(); assert.notEqual(committed.avatarMediaId, before.avatarMediaId);
  await media(committed.avatarMediaId!).expect(200); // Never unlink a potentially committed file.
});

test('concurrent replacement holds the User row lock; last successful commit alone determines assignment', async () => {
  let release!: () => void, held!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { held = r; });
  const before = await current();
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${accounts[0]!.id}::uuid FOR UPDATE`; held(); await gate;
  }, { timeout: 15000 });
  await ready;
  const pending: Promise<request.Response>[] = [];
  try {
    for (const [buffer, type] of [[jpeg, 'image/jpeg'], [png, 'image/png']] as const) {
      pending.push(file(upload(), buffer, type).then(r => r));
      const deadline = Date.now() + 4000; let count = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "User"%FOR UPDATE%'`;
        count = rows[0]!.count; if (count >= pending.length) break; await setImmediate();
      }
      assert.ok(count >= pending.length, 'Requests actually overlap waiting on PostgreSQL, not a JS mutex');
    }
    assert.equal((await current()).avatarMediaId, before.avatarMediaId);
  } finally { release(); await blocker; }
  const responses = await Promise.all(pending); assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const [a, b] = responses.map(r => r.body.avatar.id as string);
  assert.equal((await current()).avatarMediaId, b); await media(a!).expect(404); await media(b!).expect(200);
  assert.ok(await prisma.mediaAsset.findUnique({ where: { id: a! } }));
});

test('public route refuses originals, orphan/former/demo media, unsafe keys, missing files and arbitrary types', async () => {
  const before = await current();
  await media('invalid').expect(400); await media(randomUUID()).expect(404);
  await request(app.getHttpServer()).get('/uploads/avatars/original.jpg').expect(404);
  for (const shape of [{ storageKey: `demo/${randomUUID()}.jpg` }, { mimeType: 'image/png' }, { width: 1024 }, { storageKey: '../../private.jpg' }, { ownerId: accounts[1]!.id }]) {
    const id = randomUUID();
    await prisma.mediaAsset.create({ data: { id, ownerId: accounts[0]!.id, storageKey: `avatars/${id}.jpg`, mimeType: 'image/jpeg', width: 512, height: 512, bytes: 100, ...shape } });
    await writeFile(join(directory, `${id}.jpg`), jpeg);
    await prisma.user.update({ where: { id: accounts[0]!.id }, data: { avatarMediaId: id } });
    await media(id).expect(404); assert.equal((await get('users/me')).body.avatar, null);
  }
  await prisma.user.update({ where: { id: accounts[0]!.id }, data: { avatarMediaId: before.avatarMediaId } });
  const id = randomUUID(); await writeFile(join(directory, `${id}.jpg`), jpeg); await media(id).expect(404);
  await unlink(join(directory, `${before.avatarMediaId}.jpg`)); await media(before.avatarMediaId!).expect(404);
  await file(upload()).expect(200);
});

test('avatar survives login/refresh/profile/extroversion responses with only safe nullable metadata', async () => {
  const avatar = (await get('users/me')).body.avatar;
  const account = accounts[0]!;
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: account.email, password: account.password }).expect(200);
  const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
  const patch = await request(app.getHttpServer()).patch('/api/v1/users/me').auth(account.access, { type: 'bearer' }).send({ displayName: 'Updated text' }).expect(200);
  const level = await request(app.getHttpServer()).put('/api/v1/users/me/extroversion').auth(account.access, { type: 'bearer' }).send({ level: 7 }).expect(200);
  for (const user of [login.body.user, refresh.body.user, patch.body, level.body]) {
    assert.deepEqual(user.avatar, avatar); assert.doesNotMatch(JSON.stringify(user), /storageKey|passwordHash|tokenHash|originalname|uploads/);
  }
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  assert.ok(docs.paths['/api/v1/users/me/avatar'].post.security);
  assert.ok(docs.components.schemas.UserResponseDto.properties.avatar.nullable);
});
