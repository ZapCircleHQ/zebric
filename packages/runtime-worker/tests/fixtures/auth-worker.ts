import { createWorkerHandler } from '../../src/engine.js'

// The same engine the starters deploy: Better Auth runs inside it on D1, with
// one provider instance shared by every request in the isolate.
export default createWorkerHandler({
  blueprint: {
    version: '0.6.0',
    project: { name: 'Auth smoke', version: '1', runtime: { min_version: '0.6.0' } },
    auth: { providers: ['email'] },
    entities: [{
      name: 'Task',
      fields: [
        { name: 'id', type: 'Text', primary_key: true },
        { name: 'title', type: 'Text' },
        { name: 'userId', type: 'Text' },
      ],
    }],
    pages: [],
  } as any,
})
