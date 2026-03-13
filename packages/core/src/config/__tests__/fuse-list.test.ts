import { describe, expect, test } from 'bun:test'
import type { FuseRule } from '@zero-os/shared'
import { checkFuseList } from '../fuse-list'

const rule = (pattern: string): FuseRule => ({ pattern, description: `Block ${pattern}` })

describe('checkFuseList', () => {
  describe('rm -rf / pattern', () => {
    const rules = [rule('rm -rf /')]

    test('blocks exact match', () => {
      expect(checkFuseList('rm -rf /', rules)).toBeDefined()
    })

    test('blocks with trailing flags', () => {
      expect(checkFuseList('rm -rf / --no-preserve-root', rules)).toBeDefined()
    })

    test('blocks in command chain', () => {
      expect(checkFuseList(';rm -rf /', rules)).toBeDefined()
      expect(checkFuseList('echo hi && rm -rf /', rules)).toBeDefined()
    })

    test('does NOT block /tmp', () => {
      expect(checkFuseList('rm -rf /tmp/123213', rules)).toBeUndefined()
    })

    test('does NOT block /home/user', () => {
      expect(checkFuseList('rm -rf /home/user', rules)).toBeUndefined()
    })

    test('does NOT block /var', () => {
      expect(checkFuseList('rm -rf /var', rules)).toBeUndefined()
    })
  })

  describe('mkfs pattern', () => {
    const rules = [rule('mkfs')]

    test('blocks mkfs alone', () => {
      expect(checkFuseList('mkfs', rules)).toBeDefined()
    })

    test('blocks mkfs.ext4', () => {
      expect(checkFuseList('mkfs.ext4 /dev/sda1', rules)).toBeDefined()
    })

    test('blocks mkfs with flags', () => {
      expect(checkFuseList('mkfs -t ext4 /dev/sda', rules)).toBeDefined()
    })

    test('does NOT match inside another word', () => {
      expect(checkFuseList('unmkfs_tool', rules)).toBeUndefined()
    })
  })

  describe('shutdown pattern', () => {
    const rules = [rule('shutdown')]

    test('blocks shutdown with flags', () => {
      expect(checkFuseList('shutdown -h now', rules)).toBeDefined()
    })

    test('does NOT match is_shutdown variable', () => {
      expect(checkFuseList('is_shutdown=true', rules)).toBeUndefined()
    })

    test('does NOT match inside longer word', () => {
      expect(checkFuseList('preshutdown_hook', rules)).toBeUndefined()
    })
  })

  describe('dd if=/dev/zero pattern', () => {
    const rules = [rule('dd if=/dev/zero')]

    test('blocks with output target', () => {
      expect(checkFuseList('dd if=/dev/zero of=/dev/sda bs=1M', rules)).toBeDefined()
    })

    test('blocks exact match', () => {
      expect(checkFuseList('dd if=/dev/zero', rules)).toBeDefined()
    })

    test('does NOT match dd if=/dev/zero123', () => {
      expect(checkFuseList('dd if=/dev/zero123', rules)).toBeUndefined()
    })
  })

  describe('chmod -R 777 / pattern', () => {
    const rules = [rule('chmod -R 777 /')]

    test('blocks exact match', () => {
      expect(checkFuseList('chmod -R 777 /', rules)).toBeDefined()
    })

    test('does NOT block chmod -R 777 /tmp', () => {
      expect(checkFuseList('chmod -R 777 /tmp', rules)).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    test('returns undefined for empty rules', () => {
      expect(checkFuseList('rm -rf /', [])).toBeUndefined()
    })

    test('returns undefined for empty command', () => {
      expect(checkFuseList('', [rule('rm')])).toBeUndefined()
    })
  })
})
