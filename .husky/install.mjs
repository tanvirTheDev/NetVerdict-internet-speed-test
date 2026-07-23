/**
 * Git hooks are a local developer convenience, and installing them is
 * meaningless anywhere there is no working copy to commit from. Vercel
 * runs `npm install` on a build machine that has no dev dependencies on
 * PATH, so an unguarded `prepare: husky` fails the whole install with
 * `husky: command not found` — the build breaks over a hook it was never
 * going to use.
 *
 * This is husky's documented workaround for CI. Exiting 0 is the point:
 * "hooks not installed" is a success on a build machine.
 */
const isCi = Boolean(process.env.CI) || Boolean(process.env.VERCEL);

if (isCi || process.env.NODE_ENV === 'production') {
  process.exit(0);
}

try {
  const husky = (await import('husky')).default;
  console.log(husky());
} catch (error) {
  // A missing husky outside CI is still not worth failing an install
  // over — the hooks simply will not fire, which is visible immediately
  // on the next commit.
  console.warn(`husky: skipping hook install (${String(error)})`);
}
