/**
 * More information about our build process lives inside of the
 * CONTRIBUTING.md
 *
 * @summary Build pipeline for all new commands
 * @docs https://gulpjs.com
 * @usage `yarn gulp myTaskName` from the workspace root directory
 */

import gulp from 'gulp'
import { autobarrelWatcher } from './tasks/gulpAutobarrel'
import { startCypressWatch, openCypressLaunchpad, openCypressApp, runCypressLaunchpad, wrapRunWithExit, runCypressApp, killExistingCypress } from './tasks/gulpCypress'
import { graphqlCodegen, graphqlCodegenWatch, nexusCodegen, nexusCodegenWatch, generateFrontendSchema, syncRemoteGraphQL } from './tasks/gulpGraphql'
import { viteApp, viteCleanApp, viteCleanLaunchpad, viteLaunchpad, viteBuildApp, viteBuildAndWatchApp, viteBuildLaunchpad, viteBuildAndWatchLaunchpad } from './tasks/gulpVite'
import { checkTs } from './tasks/gulpTsc'
import { makePathMap } from './utils/makePathMap'
import { makePackage } from './tasks/gulpMakePackage'
import { setGulpGlobal } from './gulpConstants'
import { exitAfterAll } from './tasks/gulpRegistry'
import { execSync } from 'child_process'
import { webpackRunner } from './tasks/gulpWebpack'

/**------------------------------------------------------------------------
 *                      Local Development Workflow
 *  * `yarn dev` is your primary command for getting work done
 *------------------------------------------------------------------------**/

gulp.task('viteClean', gulp.parallel(
  viteCleanApp,
  viteCleanLaunchpad,
))

gulp.task(
  'codegen',
  gulp.series(
    // Autobarrel watcher
    autobarrelWatcher,

    // Codegen for our GraphQL Server so we have the latest schema to build
    // the frontend codegen correctly
    // Fetch the latest "remote" schema from the Cypress cloud
    syncRemoteGraphQL,

    // Codegen for our GraphQL Server so we have the latest schema to build the frontend codegen correctly
    nexusCodegenWatch,

    // ... and generate the correct GraphQL types for the frontend
    graphqlCodegenWatch,
  ),
)

gulp.task(
  'commonSetup',
  gulp.series(
    'codegen',
    killExistingCypress,
  ),
)

gulp.task(
  'dev',
  gulp.series(
    'codegen',

    killExistingCypress,

    // Now that we have the codegen, we can start the frontend(s)
    gulp.parallel(
      viteApp,
      viteLaunchpad,
      webpackRunner,
    ),

    // And we're finally ready for electron, watching for changes in
    // /graphql to auto-restart the server
    startCypressWatch,
  ),
)

gulp.task(
  'dev:no-watch',
  gulp.series(
    async function setNoWatch () {
      setGulpGlobal('shouldWatch', false)
    },
    'dev',
  ),
)

gulp.task('dev:clean', gulp.series(
  // Clean any vite assets
  'viteClean',
  'dev',
))

gulp.task(
  'debug',
  gulp.series(
    async function setupDebug () {
      setGulpGlobal('debug', '--inspect')
    },
    'dev',
  ),
)

gulp.task(
  'debugBrk',
  gulp.series(
    async function setupDebugBrk () {
      setGulpGlobal('debug', '--inspect-brk')
    },
    'dev',
  ),
)

/**------------------------------------------------------------------------
 *                            Static Builds
 *  Tasks that aren't watched. Usually composed together with other tasks.
 *------------------------------------------------------------------------**/

gulp.task('buildProd',
  gulp.series(
    'viteClean',

    syncRemoteGraphQL,
    nexusCodegen,
    graphqlCodegen,

    // Build the frontend(s) for production.
    gulp.parallel(
      viteBuildApp,
      viteBuildLaunchpad,
    ),
  ))

gulp.task(
  'postinstall',
  gulp.series(
    'buildProd',
    exitAfterAll,
  ),
)

/**------------------------------------------------------------------------
 *                         Launchpad Testing
 * This task builds and hosts the launchpad as if it was a static website.
 * In production, this app would be served over the file:// protocol via
 * the Electron app. However, when e2e testing the launchpad, we'll want to
 * visit it using cy.visit within our integration suites.
 *
 * * cyOpenLaunchpadE2E is for local dev and watches.
 * * cyRunLaunchpadE2E is meant to be run in CI and does not watch.
 * * cyOpenAppE2E is for local dev and watches.
 * * cyRunAppE2E is meant to be run in CI and does not watch.
*------------------------------------------------------------------------**/

gulp.task('cyRunLaunchpadE2E', gulp.series(
  // 1. Build the Cypress App itself
  'buildProd',

  // Ensure we have no existing cypress processes running
  killExistingCypress,

  // 5. Start the REAL Cypress App, which will execute the integration specs.
  async function _runCypressLaunchpad () {
    wrapRunWithExit(await runCypressLaunchpad())
  },
))

gulp.task('cyRunAppE2E', gulp.series(
  // 1. Build the Cypress App itself
  'buildProd',

  killExistingCypress,

  // 5. Start the REAL Cypress App, which will execute the integration specs.
  async function _runCypressApp () {
    wrapRunWithExit(await runCypressApp())
  },
))

const cyOpenLaunchpad = gulp.series(
  // 1. Build + watch Launchpad under test.
  //    This watches for changes and is not the same things as statically
  //    building the app for production.
  gulp.parallel(
    viteBuildApp,
    viteBuildAndWatchLaunchpad,
  ),

  // 2. Start the REAL (dev) Cypress App, which will launch in open mode.
  openCypressLaunchpad,
)

const cyOpenApp = gulp.series(
  // 1. Build + watch Launchpad under test.
  //    This watches for changes and is not the same things as statically
  //    building the app for production.
  gulp.parallel(
    gulp.series(
      viteBuildAndWatchLaunchpad,
      viteBuildAndWatchApp,
    ),
    webpackRunner,
  ),

  // 2. Start the REAL (dev) Cypress App, which will launch in open mode.
  openCypressApp,
)

// Open Cypress in production mode.
// Rebuild the Launchpad app between changes.
gulp.task('cyOpenLaunchpadE2E', gulp.series(
  'viteClean',

  // 1. Build the Cypress App itself
  'commonSetup',

  // 2. Open the "app"
  cyOpenLaunchpad,
))

// Open Cypress in production mode.
// Rebuild the Launchpad app between changes.
gulp.task('cyOpenAppE2E', gulp.series(
  'viteClean',

  // 1. Build the Cypress App itself
  'commonSetup',

  // 2. Open the launchpad app
  cyOpenApp,
))

/**------------------------------------------------------------------------
 *                             Utilities
 * checkTs: Runs `check-ts` in each of the packages & prints errors when
 *          all are completed
 *
 * makePackage: Scaffolds a new package in the packages/ directory
 *------------------------------------------------------------------------**/

gulp.task(checkTs)
gulp.task(makePackage)

/**------------------------------------------------------------------------
 *                             Internal / Test / Debug
 *
 * Tasks that are typically composed into other workflows, but are exposed
 * here for debugging, e.g. `yarn gulp syncRemoteGraphQL`
 *------------------------------------------------------------------------**/

gulp.task(syncRemoteGraphQL)
gulp.task(generateFrontendSchema)
gulp.task(makePathMap)
gulp.task(nexusCodegen)
gulp.task(nexusCodegenWatch)
gulp.task(graphqlCodegen)
gulp.task(graphqlCodegenWatch)

gulp.task(viteCleanApp)
gulp.task(viteCleanLaunchpad)

gulp.task(viteBuildApp)
gulp.task(viteBuildLaunchpad)
gulp.task(viteBuildAndWatchApp)
gulp.task(viteBuildAndWatchLaunchpad)

gulp.task('debugCypressLaunchpad', gulp.series(
  async function setupDebugBrk () {
    setGulpGlobal('debug', '--inspect-brk')
  },
  openCypressLaunchpad,
))

gulp.task(startCypressWatch)
gulp.task(openCypressApp)
gulp.task(openCypressLaunchpad)

// If we want to run individually, for debugging/testing
gulp.task('cyOpenLaunchpadOnly', cyOpenLaunchpad)
gulp.task('cyOpenAppOnly', cyOpenApp)

// Tapping into:
// https://github.com/gulpjs/gulp-cli/blob/da8241ecbacd59158deaa5471ff8a7f43901a94b/lib/versioned/%5E4.0.0/log/sync-task.js#L21-L27
const gulplog = require('gulplog')

let didntExitCorrectly = false
const warn = gulplog.warn

gulplog.warn = function (...args: string[]) {
  if (args.some((a) => String(a).includes('forget to signal async completion'))) {
    didntExitCorrectly = true
  }

  return warn.apply(this, arguments)
}

process.on('exit', () => {
  if (didntExitCorrectly) {
    execSync('killall Cypress')
    execSync('killall node')
    process.exitCode = 1
  }
})
