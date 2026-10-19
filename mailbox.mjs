import { createHash, randomUUID } from 'node:crypto';
import {
  constants as C, lstatSync, mkdirSync, openSync, closeSync, writeFileSync,
  fsyncSync, unlinkSync, readdirSync, linkSync, readSync, fstatSync, rmdirSync,
} from 'node:fs';
import { resolve, join, parse, sep } from 'node:path';

export const MAIL_LIMIT = 32;
export const MAIL_BYTES = 8192;
const MAX_BOXES = 256;
const BODY_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function mailboxKey(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('INVALID_SESSION');
  return createHash('sha256').update(sessionId).digest('hex');
}
function directory(path, create = true) {
  const abs = resolve(path);
  const root = parse(abs).root;
  let current = root;
  for (const part of abs.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let st;
    try { st = lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw new Error('MAIL_PATH', { cause: error });
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (race) { if (race.code !== 'EEXIST') throw race; }
      st = lstatSync(current);
    }
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('MAIL_PATH');
  }
  const st = lstatSync(abs);
  if (st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('MAIL_PERMISSIONS');
  return abs;
}
function readPrivate(path) {
  const fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o077) || st.size > MAIL_BYTES) throw new Error('MAIL_FILE');
    // The file can grow after fstat. Never ask readFileSync for an unbounded read.
    const buffer = Buffer.alloc(MAIL_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > MAIL_BYTES) throw new Error('MAIL_FILE');
    return JSON.parse(buffer.subarray(0, used).toString('utf8'));
  } finally { closeSync(fd); }
}
function syncDirectory(path) {
  const fd = openSync(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function mutate(box, action) {
  const lock = join(box, '.mutation-lock');
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('MAIL_BUSY'); throw error; }
  const own = lstatSync(lock);
  const owner = join(lock, `${randomUUID()}.owner`);
  let ownerCreated = false;
  try {
    const fd = openSync(owner, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
    ownerCreated = true;
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); } finally { closeSync(fd); }
    return action();
  } finally {
    // A lock is never expired, stolen, or recursively removed. Only this owner
    // can remove its nonempty directory after all mutations have completed.
    const current = lstatSync(lock);
    if (current.ino !== own.ino || current.dev !== own.dev || !current.isDirectory()) throw new Error('MAIL_LOCK_CHANGED');
    if (ownerCreated) unlinkSync(owner);
    rmdirSync(lock);
  }
}
function safeMessage(message, target) {
  const keys = ['v', 'id', 'from', 'to', 'senderName', 'body', 'createdAt'];
  return message && typeof message === 'object' && !Array.isArray(message)
    && Object.keys(message).length === keys.length && keys.every(key => Object.hasOwn(message, key))
    && message.v === 1 && message.to === target && /^[a-f0-9-]{36}$/.test(message.id)
    && typeof message.from === 'string' && /^[a-f0-9]{64}$/.test(message.from)
    && typeof message.senderName === 'string' && message.senderName.length <= 100
    && typeof message.body === 'string' && message.body.length <= 4000 && !BODY_CONTROLS.test(message.body)
    && typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt));
}
export class Mailboxes {
  constructor(root) { this.root = resolve(root); }
  box(sessionId, create = false) {
    const key = mailboxKey(sessionId);
    if (!create) {
      try { directory(this.root, false); }
      catch (error) { if (error.cause?.code === 'ENOENT') return undefined; throw error; }
      const path = join(this.root, key);
      try { lstatSync(path); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      return directory(path, false);
    }
    directory(this.root);
    const path = join(this.root, key);
    try { lstatSync(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const claims = readdirSync(this.root).filter(name => /^box-\d{3}\.json$/.test(name));
      let claimed = claims.some(name => { try { return readPrivate(join(this.root, name)).key === key; } catch { return false; } });
      if (!claimed) for (let index = 0; index < MAX_BOXES; index++) {
        let fd;
        try { fd = openSync(join(this.root, `box-${String(index).padStart(3, '0')}.json`), C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        try { writeFileSync(fd, JSON.stringify({ key })); fsyncSync(fd); } finally { closeSync(fd); }
        claimed = true;
        break;
      }
      if (!claimed) throw new Error('MAIL_BOX_LIMIT');
    }
    return directory(path);
  }
  list(sessionId) {
    const box = this.box(sessionId);
    if (!box) return { messages: [], invalid: 0 };
    const target = mailboxKey(sessionId);
    const messages = [];
    let invalid = 0;
    for (const slot of readdirSync(box).filter(name => /^slot-\d{2}\.json$/.test(name)).slice(0, MAIL_LIMIT)) {
      try {
        const message = readPrivate(join(box, slot));
        if (!safeMessage(message, target)) throw new Error('MAIL_FORMAT');
        let read = false;
        try { const ack = readPrivate(join(box, `${message.id}.read`)); read = ack.id === message.id && ack.v === 1; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        messages.push({ ...message, slot, read });
      } catch { invalid++; }
    }
    return { messages: messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), invalid };
  }
  send(fromId, toId, senderName, body) {
    if (typeof body !== 'string' || !body.trim() || body.length > 4000 || BODY_CONTROLS.test(body)
      || typeof senderName !== 'string' || senderName.length > 100) throw new Error('MAIL_BODY');
    const message = { v: 1, id: randomUUID(), from: mailboxKey(fromId), to: mailboxKey(toId), senderName, body, createdAt: new Date().toISOString() };
    const text = JSON.stringify(message);
    if (Buffer.byteLength(text) > MAIL_BYTES) throw new Error('MAIL_BODY');
    const box = this.box(toId, true);
    let published = false;
    try { return mutate(box, () => {
      // Fixed staging filename + exclusive mutation lock bounds crash residue to
      // one file per box. Existing residue fails closed, never silently removed.
      const temp = join(box, '.pending-message.json');
      let created = false;
      try {
        let fd;
        try { fd = openSync(temp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600); }
        catch (error) { if (error.code === 'EEXIST') throw new Error('MAIL_PENDING'); throw error; }
        created = true;
        try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
        for (let index = 0; index < MAIL_LIMIT; index++) {
          try { linkSync(temp, join(box, `slot-${String(index).padStart(2, '0')}.json`)); published = true; break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (!published) throw new Error('MAIL_FULL');
      } finally {
        if (created) unlinkSync(temp);
      }
      try { syncDirectory(box); }
      catch { throw new Error('MAIL_OUTCOME_UNCERTAIN'); }
      return { id: message.id, createdAt: message.createdAt };
    }); } catch (error) {
      if (published) throw new Error('MAIL_OUTCOME_UNCERTAIN');
      throw error;
    }
  }
  markRead(sessionId, id) {
    const box = this.box(sessionId);
    if (!box) throw new Error('MAIL_MISSING');
    return mutate(box, () => {
      const message = this.list(sessionId).messages.find(value => value.id === id);
      if (!message) throw new Error('MAIL_MISSING');
      const path = join(box, `${message.id}.read`);
      let fd;
      try { fd = openSync(path, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code === 'EEXIST') return; throw error; }
      try { writeFileSync(fd, JSON.stringify({ v: 1, id: message.id, readAt: new Date().toISOString() })); fsyncSync(fd); }
      finally { closeSync(fd); }
      syncDirectory(box);
    });
  }
  clearRead(sessionId) {
    const box = this.box(sessionId);
    if (!box) return 0;
    return mutate(box, () => {
      // Snapshot and deletion share the same lock as send/markRead. Fixed slots
      // cannot be reused by another producer before this entire cleanup ends.
      const messages = this.list(sessionId).messages;
      let removed = 0;
      for (const message of messages.filter(value => value.read)) {
        unlinkSync(join(box, message.slot));
        unlinkSync(join(box, `${message.id}.read`));
        removed++;
      }
      syncDirectory(box);
      return removed;
    });
  }
}
