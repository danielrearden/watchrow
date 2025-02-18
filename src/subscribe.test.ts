import { subscribe } from './subscribe';
import { type Trigger, type WatchmanClient } from './types';
import { setTimeout } from 'node:timers';
import * as sinon from 'sinon';
import { expect, it } from 'vitest';

const defaultTrigger = {
  expression: ['match', 'foo', 'basename'],
  id: 'foo',
  interruptible: false,
  name: 'foo',
  onChange: async () => {},
  relativePath: 'foo',
  retry: {
    retries: 0,
  },
  watch: 'foo',
} as Trigger;

const wait = (time: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

it('rejects promise if Watchman "subscribe" command produces an error', async () => {
  const client = {
    command: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
  } as Trigger;

  const clientMock = sinon.mock(client);

  clientMock
    .expects('command')
    .once()
    .callsFake((args, callback) => {
      callback(new Error('foo'));
    });

  await expect(subscribe(client, trigger)).rejects.toThrowError('foo');

  expect(clientMock.verify());
});

it('evaluates onChange', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  const abortController = new AbortController();

  subscriptionMock
    .expects('onChange')
    .once()
    .callsFake(() => {
      abortController.abort();

      return Promise.resolve(null);
    });

  const clientMock = sinon.mock(client);

  clientMock
    .expects('on')
    .once()
    .callsFake((event, callback) => {
      callback({
        files: [],
        subscription: 'foo',
      });
    });

  await subscribe(client, trigger, abortController.signal);

  expect(clientMock.verify());
  expect(subscriptionMock.verify());
});

it('evaluates multiple onChange', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  const onChange = subscriptionMock.expects('onChange').thrice();

  const abortController = new AbortController();

  onChange.onFirstCall().resolves(null);

  onChange.onSecondCall().resolves(null);

  onChange.onThirdCall().callsFake(() => {
    abortController.abort();

    return Promise.resolve(null);
  });

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
    setTimeout(() => {
      callback({
        files: [],
        subscription: 'foo',
      });
      setTimeout(() => {
        callback({
          files: [],
          subscription: 'foo',
        });
      });
    });
  });

  await subscribe(client, trigger, abortController.signal);

  expect(onChange.callCount).toBe(3);
});

it('debounces onChange', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
    debounce: {
      wait: 100,
    },
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  const onChange = subscriptionMock.expects('onChange').thrice();

  const abortController = new AbortController();

  setTimeout(() => {
    abortController.abort();
  }, 200);

  onChange.onFirstCall().resolves(null);

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
    setTimeout(() => {
      callback({
        files: [],
        subscription: 'foo',
      });
      setTimeout(() => {
        callback({
          files: [],
          subscription: 'foo',
        });
      });
    });
  });

  await subscribe(client, trigger, abortController.signal);

  expect(onChange.callCount).toBe(1);
});

it('waits for onChange to complete when { interruptible: false }', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
    interruptible: false,
  } as Trigger;

  const abortController = new AbortController();

  const triggerMock = sinon.mock(trigger);

  const onChange = triggerMock.expects('onChange').twice();

  let completed = false;

  onChange.onFirstCall().callsFake(async () => {
    await wait(100);

    completed = true;
  });

  onChange.onSecondCall().callsFake(() => {
    expect(completed).toBe(true);

    abortController.abort();
  });

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
    callback({
      files: [],
      subscription: 'foo',
    });
  });

  await subscribe(client, trigger, abortController.signal);

  expect(onChange.callCount).toBe(2);
});

it('throws if onChange produces an error', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  subscriptionMock.expects('onChange').rejects(new Error('foo'));

  const abortController = new AbortController();

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
  });

  await expect(
    subscribe(client, trigger, abortController.signal),
  ).rejects.toThrowError('foo');

  await abortController.abort();
});

it('retries failing routines', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
    retry: {
      retries: 1,
    },
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  const onChange = subscriptionMock.expects('onChange').twice();

  const abortController = new AbortController();

  onChange.onFirstCall().rejects(new Error('foo'));
  onChange.onSecondCall().callsFake(() => {
    abortController.abort();

    return Promise.resolve(null);
  });

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
  });

  await subscribe(client, trigger, abortController.signal);
});

it('reports { first: true } only for the first event', async () => {
  const client = {
    command: () => {},
    on: () => {},
  } as unknown as WatchmanClient;
  const trigger = {
    ...defaultTrigger,
  } as Trigger;

  const subscriptionMock = sinon.mock(trigger);

  const onChange = subscriptionMock.expects('onChange').twice();

  onChange.onFirstCall().resolves(null);

  const abortController = new AbortController();

  onChange.onSecondCall().callsFake(() => {
    abortController.abort();

    return Promise.resolve(null);
  });

  const clientMock = sinon.mock(client);

  clientMock.expects('on').callsFake((event, callback) => {
    callback({
      files: [],
      subscription: 'foo',
    });
    callback({
      files: [],
      subscription: 'foo',
    });
  });

  await subscribe(client, trigger, abortController.signal);

  expect(onChange.args).toMatchObject([
    [
      {
        first: true,
      },
    ],
    [
      {
        first: false,
      },
    ],
  ]);

  expect(subscriptionMock.verify());
});
