import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [revision, destination] = process.argv.slice(2)
if (!revision || !/^[0-9a-f]{40}$/.test(revision) || !destination) {
  throw new Error('Usage: bun scripts/package-fork.ts <full-commit-sha> <output-directory>')
}

const output = resolve(destination)
mkdirSync(output, { recursive: true })
const build = Bun.spawnSync([process.execPath, 'run', 'build'], { stdout: 'inherit', stderr: 'inherit' })
if (build.exitCode !== 0) process.exit(build.exitCode)

const staging = mkdtempSync(join(tmpdir(), 'vibe-notion-package-'))
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  pkg.version = `${pkg.version.split('-')[0]}-fork.${revision.slice(0, 12)}`
  pkg.repository = { type: 'git', url: 'git+https://github.com/ash-r1/vibe-notion.git' }
  pkg.gitHead = revision
  pkg.main = 'dist/src/platforms/notion/cli.js'
  pkg.module = pkg.main
  pkg.bin = Object.fromEntries(
    Object.entries(pkg.bin as Record<string, string>).map(([name, path]) => [
      name,
      path.replace(/^\.\/src\//, 'dist/src/').replace(/\.ts$/, '.js'),
    ]),
  )
  // Use the runtime dependency versions installed from the frozen Bun lockfile.
  for (const name of Object.keys(pkg.dependencies)) {
    pkg.dependencies[name] = JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8')).version
  }
  delete pkg.scripts
  delete pkg.devDependencies
  delete pkg.trustedDependencies
  pkg.files = ['dist', 'skills', 'README.md']
  cpSync('dist', join(staging, 'dist'), { recursive: true })
  cpSync('skills', join(staging, 'skills'), { recursive: true })
  cpSync('README.md', join(staging, 'README.md'))
  const metadata = `${JSON.stringify(pkg, null, 2)}\n`
  writeFileSync(join(staging, 'package.json'), metadata)
  // The compiled CLIs import dist/package.json for their version.
  writeFileSync(join(staging, 'dist', 'package.json'), metadata)
  const packed = Bun.spawnSync(
    [process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', join(output, 'vibe-notion.tgz')],
    { cwd: staging, stdout: 'inherit', stderr: 'inherit' },
  )
  if (packed.exitCode !== 0) process.exitCode = packed.exitCode
} finally {
  rmSync(staging, { recursive: true, force: true })
}
