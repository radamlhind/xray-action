import * as core from '@actions/core'
import * as path from 'path'
import * as fs from 'fs'
import FormData from 'form-data'
import {tmpdir} from 'os'
import {randomBytes} from 'crypto'
import {join} from 'path'
import * as glob from '@actions/glob'
import {mergeFiles} from 'junit-report-merger'

/**
 * Constructs a temporary file, with the given extension
 */
export function tmpFile(ext: string): string {
  return join(
    tmpdir(),
    `tmp.${randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`
  )
}

/**
 * Resolves the repository path, relatively to the GITHUB_WORKSPACE
 */
export function retrieveRepositoryPath(providedPath: string): string {
  let githubWorkspacePath = process.env['GITHUB_WORKSPACE']
  if (!githubWorkspacePath) {
    throw new Error('GITHUB_WORKSPACE not defined')
  }
  githubWorkspacePath = path.resolve(githubWorkspacePath)
  core.debug(`GITHUB_WORKSPACE = '${githubWorkspacePath}'`)

  let repositoryPath = providedPath || '.'
  repositoryPath = path.resolve(githubWorkspacePath, repositoryPath)
  core.debug(`repositoryPath = '${repositoryPath}'`)
  return repositoryPath
}

/**
 * Retrieves the json configuration specified
 */
export function resolveJson(
  githubWorkspacePath: string,
  file: string
): Object | undefined {
  if (file) {
    try {
      if (fs.existsSync(path.resolve(file))) {
        return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
      } else {
        return JSON.parse(
          fs.readFileSync(path.resolve(githubWorkspacePath, file), 'utf8')
        )
      }
    } catch (error: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
      core.error(
        `🔥 The provided json file (${file}) could not be parsed: ${error.message}`
      )
      return undefined
    }
  } else {
    return undefined
  }
}

/**
 * Do a request with options provided.
 *
 * @param {Object} options
 * @param {Object} data
 * @return {Promise} a promise of request
 */
export async function doFormDataRequest(
  formData: FormData,
  params: string | FormData.SubmitOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return new Promise((resolve, reject) => {
    formData.submit(params, (err, res) => {
      if (err) {
        reject(err)
      } else {
        res.setEncoding('utf8')
        let responseBody = ''

        res.on('data', chunk => {
          responseBody += chunk
        })

        res.on('end', () => {
          try {
            core.debug(`Server response: ${responseBody}`)
            resolve(JSON.parse(responseBody))
          } catch (error: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
            core.warning(
              `🔥 Server responded with error (${error.message}): ${responseBody}`
            )
            reject(error)
          }
        })
      }
    })
  })
}

/**
 * Retrieves the test result files given the provided globber.
 * Automatically merges supported test result formats into a single file.
 */
export async function retrieveTestFiles(
  testMerge: boolean,
  testFormat: string,
  testPaths: string
): Promise<string[]> {
  // match find the test files via the globber
  const globber = await glob.create(testPaths, {
    followSymbolicLinks: false
  })
  const files = await globber.glob()

  // merge together the test result files if requested, and more than 1 file is found
  if (files.length > 1 && testMerge) {
    // supported for junit
    if (testFormat === 'junit') {
      try {
        const tmp = tmpFile('xml')
        await mergeFiles(tmp, [testPaths])
        core.info(
          `ℹ️ Merged ${files.length} junit test reports into a single file: ${tmp}`
        )
        return [tmp]
      } catch (error: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
        core.warning(
          `🔥 Failed to merge junit test report files: ${error.message}`
        )
      }
    } else if (testFormat === 'cucumber') {
      try {
        const tmp = tmpFile('json')
        fs.writeFileSync(tmp, mergeJsonFiles(files))
        core.info(
          `ℹ️ Merged ${files.length} cucumber test reports into a single file: ${tmp}`
        )
        return [tmp]
      } catch (error: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
        core.warning(
          `🔥 Failed to merge cucumber test report files: ${error.message}`
        )
      }
    } else {
      core.info(
        `ℹ️ ${testFormat} does currently not support test result merging`
      )
    }
  }

  return files
}

/**
 * Merges multiple json report files together.
 * This works for `cucumber` test reports.
 *
 * Credits to:
 * https://github.com/bitcoder/cucumber-json-merge/blob/master/lib/index.js#L41-L57
 *
 * Licensed as: Apache 2.0
 * https://github.com/bitcoder/cucumber-json-merge/blob/master/LICENSE
 */
function mergeJsonFiles(files: string[]): string {
  const mergedResults: string[] = []
  for (const file of files) {
    try {
      const rawdata: string = fs.readFileSync(file, 'utf8')
      const partialResults = JSON.parse(rawdata)
      mergedResults.push(partialResults)
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error('Invalid JSON content')
      } else {
        throw err
      }
    }
  }
  return JSON.stringify(mergedResults.concat.apply([], mergedResults))
}
