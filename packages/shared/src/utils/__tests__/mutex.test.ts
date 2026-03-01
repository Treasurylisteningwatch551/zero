import { describe, test, expect } from 'bun:test'
import { Mutex } from '../mutex'

describe('Mutex', () => {
  test('acquire and release', async () => {
    const mutex = new Mutex()

    expect(mutex.isLocked()).toBe(false)
    expect(mutex.getOwner()).toBeNull()

    await mutex.acquire('session_1')
    expect(mutex.isLocked()).toBe(true)
    expect(mutex.getOwner()).toBe('session_1')

    mutex.release('session_1')
    expect(mutex.isLocked()).toBe(false)
    expect(mutex.getOwner()).toBeNull()
  })

  test('queues second acquirer until release', async () => {
    const mutex = new Mutex()
    const order: string[] = []

    await mutex.acquire('session_1')
    order.push('1_acquired')

    // session_2 tries to acquire — should wait
    const p2 = mutex.acquire('session_2').then(() => {
      order.push('2_acquired')
    })

    // Give p2 a tick to ensure it's waiting
    await new Promise((r) => setTimeout(r, 10))
    expect(mutex.getOwner()).toBe('session_1')

    // Release session_1 — session_2 should acquire
    mutex.release('session_1')
    await p2

    expect(mutex.getOwner()).toBe('session_2')
    expect(order).toEqual(['1_acquired', '2_acquired'])

    mutex.release('session_2')
    expect(mutex.isLocked()).toBe(false)
  })

  test('release with wrong owner throws', async () => {
    const mutex = new Mutex()
    await mutex.acquire('session_1')

    expect(() => mutex.release('session_2')).toThrow('Mutex release denied')
  })

  test('multiple waiters are served in FIFO order', async () => {
    const mutex = new Mutex()
    const order: string[] = []

    await mutex.acquire('A')

    const pB = mutex.acquire('B').then(() => order.push('B'))
    const pC = mutex.acquire('C').then(() => order.push('C'))

    await new Promise((r) => setTimeout(r, 10))

    mutex.release('A')
    await pB

    mutex.release('B')
    await pC

    mutex.release('C')

    expect(order).toEqual(['B', 'C'])
    expect(mutex.isLocked()).toBe(false)
  })
})
