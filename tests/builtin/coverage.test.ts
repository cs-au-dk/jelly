function testCoverage(moduleName: string, obj: any, mockObj: any) {
  for (const key of Object.keys(obj)) {
    // only focus on functions
    try {
      if (typeof obj[key] !== 'function') continue;
    } catch (e) {
      // ignore, cannot access to key since: [ERR_INVALID_THIS]
      continue;
    }

    try {
      expect(`${key}:${typeof mockObj[key]}`).toBe(`${key}:function`);
    } catch (e) {
      console.log(`Missing method '${key}' when mocking module '${moduleName}'.`);
      console.log(`mockObj:`, mockObj);
      console.log(`obj:`, obj);
      throw e;
    }
    // a function that starts with a capital letter is a constructor
    if (/^[A-Z]/.test(key)) {
      const proto = obj[key].prototype;
      const mockProto = mockObj[key].prototype;
      testCoverage(moduleName, proto, mockProto);
    }
  }
}

describe('all standard library modules', () => {
  test('implemented mock modules', async () => {
    const modules = [
      'buffer',
      'http',
      'https',
      'fs',
      'os',
      'net',
      'stream',
      'child_process',
      'fs/promises',
      'events',
      'vm',
      'crypto',
      '_http_agent',
      '_http_client',
      '_http_server',
      '_http_common',
      '_http_incoming',
      '_http_outgoing',
      'buffer',
    ];
    for (const module of modules) {
      const obj = require(module);
      const mocked = require(`../../src/natives/mocks/${module}`);
      testCoverage(module, obj, mocked);
    }
  });
});
