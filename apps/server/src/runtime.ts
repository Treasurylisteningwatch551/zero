import { dirname } from 'node:path'

export function getBunExecutable() {
  return process.execPath
}

export function getRuntimeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const bunDir = dirname(getBunExecutable())
  const pathValue = env.PATH ? `${bunDir}:${env.PATH}` : bunDir

  return {
    ...env,
    PATH: pathValue,
  }
}
