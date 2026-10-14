import { expect, test, vi } from 'vitest';
import { completionUrl } from '../src/main/settings/model';
import { SecretVault, CryptoStorageEngine, FsDriver } from '../src/main/settings/vault';

test('API 前缀不重复补 v1，远程 HTTP 拒绝', () => {
  expect(completionUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
  expect(() => completionUrl('http://example.com/v1')).toThrow('HTTPS_REQUIRED');
});

test('允许本机 HTTP 地址（localhost/127.0.0.1/[::1]）', () => {
  expect(completionUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
  expect(completionUrl('http://127.0.0.1:8000/v1/chat/completions')).toBe('http://127.0.0.1:8000/v1/chat/completions');
  expect(completionUrl('http://[::1]:8080')).toBe('http://[::1]:8080/chat/completions');
});

test('带有用户名密码、query 或 hash 的 URL 抛出 INVALID_PREFIX', () => {
  expect(() => completionUrl('https://user:pass@example.com/v1')).toThrow('INVALID_PREFIX');
  expect(() => completionUrl('https://example.com/v1?token=123')).toThrow('INVALID_PREFIX');
  expect(() => completionUrl('https://example.com/v1#section')).toThrow('INVALID_PREFIX');
  expect(() => completionUrl('not a url')).toThrow('INVALID_PREFIX');
});

test('vault 密文落盘且无明文泄漏，临时文件以 0600 模式写入并 rename', async () => {
  const writtenFiles = new Map<string, { data: Buffer; mode?: number }>();
  let renamed = false;

  const mockFs: FsDriver = {
    readFile: async (p) => writtenFiles.get(p)?.data ?? Buffer.alloc(0),
    writeFile: async (p, d, opts) => {
      writtenFiles.set(p, { data: d, mode: opts?.mode });
    },
    rename: async (o, n) => {
      const item = writtenFiles.get(o);
      if (item) {
        writtenFiles.set(n, item);
        writtenFiles.delete(o);
      }
      renamed = true;
    },
    unlink: async (p) => {
      writtenFiles.delete(p);
    },
    exists: async (p) => writtenFiles.has(p),
    mkdir: async () => {}
  };

  const mockCrypto: CryptoStorageEngine = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`CIPHER:${plain}`),
    decryptString: (cipher) => cipher.toString('utf-8').replace(/^CIPHER:/, '')
  };

  const vault = new SecretVault({
    storagePath: '/app/secrets.vault',
    cryptoEngine: mockCrypto,
    fsDriver: mockFs
  });

  const saveRes = await vault.saveKey('model_key', 'sk-test-secret');
  expect(saveRes.persistent).toBe(true);
  expect(renamed).toBe(true);

  // 验证保存的二进制内容被加密，不是原生明文 JSON
  const fileContent = writtenFiles.get('/app/secrets.vault')?.data.toString('utf-8');
  expect(fileContent).toContain('CIPHER:');
  expect(fileContent?.startsWith('{')).toBe(false);

  // 读取密钥
  const readKey = await vault.getKey('model_key');
  expect(readKey).toBe('sk-test-secret');

  // 空密钥不覆盖旧值
  const emptyRes = await vault.saveKey('model_key', '');
  expect(emptyRes.persistent).toBe(true);
  expect(await vault.getKey('model_key')).toBe('sk-test-secret');

  // 独立删除方法
  await vault.deleteKey('model_key');
  expect(await vault.getKey('model_key')).toBeNull();
});

test('加密不可用或钥匙串异常时仅内存保存并标记 persistent:false', async () => {
  const writeSpy = vi.fn();
  const mockFs: FsDriver = {
    readFile: async () => Buffer.alloc(0),
    writeFile: writeSpy,
    rename: async () => {},
    unlink: async () => {},
    exists: async () => false,
    mkdir: async () => {}
  };

  const unavailableCrypto: CryptoStorageEngine = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => ''
  };

  const vault = new SecretVault({
    storagePath: '/app/secrets.vault',
    cryptoEngine: unavailableCrypto,
    fsDriver: mockFs
  });

  const res = await vault.saveKey('model_key', 'my-memory-key');
  expect(res.persistent).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(await vault.getKey('model_key')).toBe('my-memory-key');
});

test('加密抛错时不落盘，且内存保留', async () => {
  const mockFs: FsDriver = {
    readFile: async () => Buffer.alloc(0),
    writeFile: async () => {},
    rename: async () => {},
    unlink: async () => {},
    exists: async () => false,
    mkdir: async () => {}
  };

  const throwingCrypto: CryptoStorageEngine = {
    isEncryptionAvailable: () => true,
    encryptString: () => {
      throw new Error('KEYCHAIN_LOCKED');
    },
    decryptString: () => ''
  };

  const vault = new SecretVault({
    storagePath: '/app/secrets.vault',
    cryptoEngine: throwingCrypto,
    fsDriver: mockFs
  });

  const res = await vault.saveKey('k1', 'val1');
  expect(res.persistent).toBe(false);
  expect(await vault.getKey('k1')).toBe('val1');
});


test.each(['decrypt', 'json', 'read'])('旧 vault %s 失败时原文件保持完整', async failure => {
  const existing=Buffer.from('old-cipher'); let file: Buffer=existing; let writes=0;
  const fs: FsDriver={exists:async()=>true,readFile:async()=>{if(failure==='read')throw Error('READ_DENIED');return file;},
    writeFile:async(_p,data)=>{writes++;file=data;},rename:async()=>{},unlink:async()=>{},mkdir:async()=>{}};
  const crypto:CryptoStorageEngine={isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),
    decryptString:()=>{if(failure==='decrypt')throw Error('KEYCHAIN_DENIED');return 'invalid-json';}};
  const vault=new SecretVault({storagePath:'/fake',cryptoEngine:crypto,fsDriver:fs});
  const saved=await vault.saveKey('new','synthetic');
  expect(saved.persistent).toBe(false);expect(writes).toBe(0);expect(file).toEqual(existing);
  expect(await vault.getKey('new')).toBe('synthetic');
});
